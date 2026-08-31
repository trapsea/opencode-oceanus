import { computeLineHash, formatHashLine } from '../tools/hashline-edit/hash'
import { HASHLINE_OUTPUT_PATTERN } from '../tools/hashline-edit/constants'

type ReadEvent = {
  tool?: string
  status?: string
  input?: { offset?: number; limit?: number }
  result?: { content?: unknown; output?: unknown; [key: string]: unknown }
}

/** 宿主 read 行前缀：`N: content` / `N| content`（分隔符后至多一个空格，行号可补零）。 */
const HOST_LINE_PATTERN = /^([0-9]+)[:|] ?(.*)$/
/** 宿主单行截断标记：被截断的行无法给出可信 hash，整行保留原样。 */
const HOST_TRUNCATED_PATTERN = /\(line truncated to [0-9]+ chars\)$/
/** 宿主正文内的括号注记行（如 `(End of file - total N lines)`），保留原样。 */
const HOST_ANNOTATION_PATTERN = /^\([^()]*\)$/
/** 宿主正文开标签行：`<content>` / `<file …>`，须位于行首，可与首个内容行同行。 */
const HOST_OPEN_PATTERN = /^<(content|file)((?:[ \t][^<>]*)?)>(.*)$/
/** 宿主前导元信息行，如 `<path>…</path>`、`<type>file</type>`。 */
const HOST_META_PATTERN = /^<[a-z]+(?:[ \t][^<>]*)?>[^<>]*<\/[a-z]+>$/
/** 宿主类型行：非 `file`（如 directory）时整体 fail-open。 */
const HOST_TYPE_PATTERN = /^<type>([^<>]*)<\/type>$/
/** 真实宿主 execute.after 数组文本首行：`Read file <path>, lines A-B`，其余为编号正文。 */
const HOST_READ_SUMMARY_PATTERN = /^Read file .+, lines [0-9]+-[0-9]+$/
/** 真实宿主正文末尾输出截断提示行，保留原样。 */
const HOST_OUTPUT_TRUNCATED_PATTERN = /^\[Output truncated\. Continue reading with offset: [0-9]+\]$/

/**
 * 处理单行宿主正文：
 * - `N:`/`N|` 行转为 hashline（行号取宿主真实值）；带截断标记的行保留原样。
 * - 括号注记行（如 `(End of file …)`）保留原样。
 * - 首行内容开头的文件 BOM 不参与 hash（与 hashline_edit 封套一致）。
 * 返回 null 表示无法识别该行，调用方应整体 fail-open。
 */
function enhanceHostBodyLine(line: string, isFirstBodyLine: boolean): { line: string; enhanced: boolean } | null {
  const match = HOST_LINE_PATTERN.exec(line)
  if (match) {
    let content = match[2]
    if (isFirstBodyLine && content.startsWith('\uFEFF')) content = content.slice(1)
    if (HOST_TRUNCATED_PATTERN.test(content)) return { line, enhanced: false }
    return { line: formatHashLine(Number(match[1]), content), enhanced: true }
  }
  if (HOST_ANNOTATION_PATTERN.test(line)) return { line, enhanced: false }
  return null
}

/** 裸 `N:`/`N|` 行序列：所有行都必须可识别（容忍结尾单个空行），否则返回 null（不改写）。 */
function enhanceHostBareText(lines: string[]): string | null {
  const working = lines.length > 1 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
  const out: string[] = []
  let enhancedAny = false
  for (let i = 0; i < working.length; i++) {
    const processed = enhanceHostBodyLine(working[i], i === 0)
    if (processed === null) return null
    if (processed.enhanced) enhancedAny = true
    out.push(processed.line)
  }
  return enhancedAny ? out.join('\n') : null
}

/**
 * 处理真实宿主 `Read file …` 摘要首行之后的正文行：
 * - `N:`/`N|` 行转为 hashline（行号取宿主真实值，不用 input.offset）。
 * - 单行截断行、括号注记行与 `[Output truncated. Continue reading with offset: N]` 保留原样。
 * - 任一行无法识别（含空文件等无正文场景无可增强行）返回 null，调用方 fail-open。
 */
function enhanceHostReadSummaryBody(lines: string[]): string | null {
  const working = lines.length > 1 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
  const out: string[] = []
  let enhancedAny = false
  for (let i = 0; i < working.length; i++) {
    const line = working[i]
    if (HOST_OUTPUT_TRUNCATED_PATTERN.test(line)) {
      out.push(line)
      continue
    }
    const processed = enhanceHostBodyLine(line, i === 0)
    if (processed === null) return null
    if (processed.enhanced) enhancedAny = true
    out.push(processed.line)
  }
  return enhancedAny ? out.join('\n') : null
}

/**
 * 真实宿主 execute.after 的 result.content 为 parts 数组：
 * 仅当恰好一个 `{type:'text'}` part 且文本为 `Read file …, lines A-B` 摘要 + 编号正文时，
 * 返回替换式新 part（保留其余字段）；目录、图片、多 part、空文件、异常格式返回 null（fail-open）。
 */
function enhanceHostTextPart(content: unknown[]): Record<string, unknown> | null {
  if (content.length !== 1) return null
  const part = content[0]
  if (part === null || typeof part !== 'object' || Array.isArray(part)) return null
  const record = part as Record<string, unknown>
  if (record.type !== 'text' || typeof record.text !== 'string') return null
  const lines = record.text.split(/\r?\n/)
  if (!HOST_READ_SUMMARY_PATTERN.test(lines[0])) return null
  const body = enhanceHostReadSummaryBody(lines.slice(1))
  if (body === null) return null
  return { ...record, text: `${lines[0]}\n${body}` }
}

/**
 * 识别并增强宿主 read 文本：`<path>/<type>` 前导 + `<content>`/`<file>` 包装 +
 * `N:`/`N|` 行号（开/闭标签可与首/末内容行同行），或裸行号序列。
 * 行号一律取宿主真实值，不使用 input.offset 推导；目录输出、非文本、
 * 截断行、解析失败等情况 fail-open 返回 null，调用方不得改写原文。
 * 重复调用时正文已是 hashline（`N#hash|` 不匹配行前缀），自然保持不变。
 */
function enhanceHostText(text: string): string | null {
  const lines = text.split(/\r?\n/)
  let openIndex = -1
  let open: RegExpExecArray | null = null
  for (let i = 0; i < lines.length; i++) {
    const match = HOST_OPEN_PATTERN.exec(lines[i])
    if (match) {
      openIndex = i
      open = match
      break
    }
  }
  if (openIndex < 0 || !open) return enhanceHostBareText(lines)
  const tag = open[1]
  const closeTag = `</${tag}>`
  let last = lines.length - 1
  while (last >= 0 && lines[last] === '') last--
  // 闭标签必须位于最后一个非空行行尾；残缺包装 fail-open。
  if (last <= openIndex || !lines[last].endsWith(closeTag)) return null
  for (let i = 0; i < openIndex; i++) {
    if (!HOST_META_PATTERN.test(lines[i])) return null
    const type = HOST_TYPE_PATTERN.exec(lines[i])
    if (type && type[1] !== 'file') return null
  }
  const closeLine = lines[last]
  const closePrefix = closeLine.slice(0, closeLine.length - closeTag.length)
  const bodySegments: string[] = []
  if (open[3] !== '') bodySegments.push(open[3])
  bodySegments.push(...lines.slice(openIndex + 1, last))
  if (closePrefix !== '') bodySegments.push(closePrefix)
  const processed: string[] = []
  let enhancedAny = false
  for (let i = 0; i < bodySegments.length; i++) {
    const result = enhanceHostBodyLine(bodySegments[i], i === 0)
    if (result === null) return null
    if (result.enhanced) enhancedAny = true
    processed.push(result.line)
  }
  if (!enhancedAny) return null
  // 按原布局还原：前导行、开/闭标签与内容的同行关系、结尾空行均保持原位。
  const openerRest = open[3] === '' ? '' : (processed.shift() ?? '')
  const closerRest = closePrefix === '' ? '' : (processed.pop() ?? '')
  const rebuilt = [
    ...lines.slice(0, openIndex),
    `<${tag}${open[2]}>${openerRest}`,
    ...processed,
    `${closerRest}${closeTag}`,
    ...lines.slice(last + 1),
  ]
  return rebuilt.join('\n')
}

/**
 * 将 read 的宿主输出按原文件行号转换为 hashline；重复调用不会再次包装。
 * 真实宿主文本位于 result.output（带包装与行号）或 result.content parts 数组
 * （`Read file …` 摘要 + 编号正文），旧路径兼容 result.content 纯文本。
 */
export function createHashlineReadEnhancer() {
  return (event: ReadEvent): void => {
    if (event?.tool !== 'read' || event.status !== 'completed' || !event.result) return
    if (typeof event.result.output === 'string') {
      const enhancedOutput = enhanceHostText(event.result.output)
      if (enhancedOutput !== null) event.result.output = enhancedOutput
    }
    if (Array.isArray(event.result.content)) {
      const enhancedPart = enhanceHostTextPart(event.result.content)
      if (enhancedPart !== null) event.result.content = [enhancedPart]
      return
    }
    if (typeof event.result.content !== 'string') return
    const hostEnhanced = enhanceHostText(event.result.content)
    if (hostEnhanced !== null) {
      event.result.content = hostEnhanced
      return
    }
    const content = event.result.content
    const hasBom = content.startsWith('\uFEFF')
    const source = hasBom ? content.slice(1) : content
    const sourceLines = source.split(/\r?\n/)
    const offsetValue = event.input?.offset
    const offset = typeof offsetValue === 'number' && Number.isFinite(offsetValue) &&
      Number.isInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0
    const limitValue = event.input?.limit
    const validLimit = typeof limitValue === 'number' && Number.isFinite(limitValue) &&
      Number.isInteger(limitValue) && limitValue >= 0
    if (validLimit && limitValue === 0) {
      event.result.content = ''
      return
    }
    const fullyEnhanced = sourceLines.some((line) => line !== '') && sourceLines.every((line) => {
      if (line === '') return false
      const match = HASHLINE_OUTPUT_PATTERN.exec(line.replace(/\r$/, ''))
      return !!match && computeLineHash(Number(match[1]), match[3]) === match[2]
    })
    if (source === '' || fullyEnhanced) return
    const lines = sourceLines.map((line) => line.replace(/\r$/, ''))
    const selected = lines.slice(0, validLimit ? limitValue : lines.length)
    const enhanced = selected.map((line, index) => formatHashLine(offset + index + 1, line)).join('\n')
    event.result.content = hasBom ? `\uFEFF${enhanced}` : enhanced
  }
}
