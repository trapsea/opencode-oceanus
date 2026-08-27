/**
 * 文本归一化与替换内容修正工具。
 *
 * 作用：
 * - 从用户提供的 lines 中剥离 hashline / diff 前缀，得到真正要写入的内容。
 * - 处理"回显"（echo）：用户在替换中重复了锚点行或边界行时自动去重。
 * - 恢复前导缩进，避免替换破坏缩进结构。
 */

/** 匹配 hashline 前缀，如 `  12#AB|...` 或 `>>> 3#XY|...`。 */
const HASHLINE_PREFIX_RE = /^\s*(?:>>>|>>)?\s*\d+\s*#\s*[ZPMQVRWSNKTXJBYH]{2}\|/
/** 匹配单个 diff 的 `+` 前缀（但不匹配 `+++`）。 */
const DIFF_PLUS_RE = /^[+](?![+])/

function equalsIgnoringWhitespace(a: string, b: string): boolean {
  if (a === b) return true
  return a.replace(/\s+/g, "") === b.replace(/\s+/g, "")
}

function leadingWhitespace(text: string): string {
  if (!text) return ""
  const match = text.match(/^\s*/)
  return match ? match[0] : ""
}

/**
 * 当多数行都带同一种前缀（hashline 或 `+`）时，统一剥离。
 * 使用多数决（>50% 非空行）避免误伤真实内容。
 */
export function stripLinePrefixes(lines: string[]): string[] {
  let hashPrefixCount = 0
  let diffPlusCount = 0
  let nonEmpty = 0

  for (const line of lines) {
    if (line.length === 0) continue
    nonEmpty += 1
    if (HASHLINE_PREFIX_RE.test(line)) hashPrefixCount += 1
    if (DIFF_PLUS_RE.test(line)) diffPlusCount += 1
  }

  if (nonEmpty === 0) {
    return lines
  }

  const stripHash = hashPrefixCount > 0 && hashPrefixCount >= nonEmpty * 0.5
  const stripPlus = !stripHash && diffPlusCount > 0 && diffPlusCount >= nonEmpty * 0.5

  if (!stripHash && !stripPlus) {
    return lines
  }

  return lines.map((line) => {
    if (stripHash) return line.replace(HASHLINE_PREFIX_RE, "")
    if (stripPlus) return line.replace(DIFF_PLUS_RE, "")
    return line
  })
}

/** 将 string 或 string[] 输入统一转为待写入的行数组，并剥离前缀。 */
export function toNewLines(input: string | string[]): string[] {
  // payload 中的 CRLF 只属于输入换行，不应与封套的 CRLF 再次叠加。
  const lines = Array.isArray(input) ? input : input.split("\n")
  return stripLinePrefixes(lines.map((line) => line.endsWith("\r") ? line.slice(0, -1) : line))
}

/** 若目标行无缩进而模板行有缩进，则补上模板缩进。 */
export function restoreLeadingIndent(templateLine: string, line: string): string {
  if (line.length === 0) return line
  const templateIndent = leadingWhitespace(templateLine)
  if (templateIndent.length === 0) return line
  if (leadingWhitespace(line).length > 0) return line
  if (templateLine.trim() === line.trim()) return line
  return `${templateIndent}${line}`
}

/** 若替换首行是锚点行的回显（append 场景），去掉它。 */
export function stripInsertAnchorEcho(anchorLine: string, newLines: string[]): string[] {
  if (newLines.length === 0) return newLines
  if (equalsIgnoringWhitespace(newLines[0], anchorLine)) {
    return newLines.slice(1)
  }
  return newLines
}

/** 若替换末行是锚点行的回显（prepend 场景），去掉它。 */
export function stripInsertBeforeEcho(anchorLine: string, newLines: string[]): string[] {
  if (newLines.length <= 1) return newLines
  if (equalsIgnoringWhitespace(newLines[newLines.length - 1], anchorLine)) {
    return newLines.slice(0, -1)
  }
  return newLines
}

/**
 * 范围替换（replace with end）：若替换内容首/末行恰好重复了
 * 范围外的相邻边界行，则去掉，避免意外复制边界行。
 */
export function stripRangeBoundaryEcho(
  lines: string[],
  startLine: number,
  endLine: number,
  newLines: string[]
): string[] {
  const replacedCount = endLine - startLine + 1
  if (newLines.length <= 1 || newLines.length <= replacedCount) {
    return newLines
  }

  let out = newLines
  const beforeIdx = startLine - 2
  if (beforeIdx >= 0 && out[0] === lines[beforeIdx]) {
    out = out.slice(1)
  }

  const afterIdx = endLine
  if (afterIdx < lines.length && out.length > 0 && out[out.length - 1] === lines[afterIdx]) {
    out = out.slice(0, -1)
  }

  return out
}

/**
 * 修正替换行：成对替换时逐行恢复原缩进（长度一致时）。
 * 这是核心缩进保护；更激进的跨行合并/展开不在此实现。
 */
export function restoreIndentForPairedReplacement(
  originalLines: string[],
  replacementLines: string[]
): string[] {
  if (originalLines.length !== replacementLines.length) {
    return replacementLines
  }

  return replacementLines.map((line, idx) => {
    if (line.length === 0) return line
    if (leadingWhitespace(line).length > 0) return line
    const indent = leadingWhitespace(originalLines[idx])
    if (indent.length === 0) return line
    if (originalLines[idx].trim() === line.trim()) return line
    return `${indent}${line}`
  })
}

/** 替换行自动修正的入口：先做回显剥离，再做缩进恢复。 */
export function autocorrectReplacementLines(
  originalLines: string[],
  replacementLines: string[]
): string[] {
  return restoreIndentForPairedReplacement(originalLines, replacementLines)
}
