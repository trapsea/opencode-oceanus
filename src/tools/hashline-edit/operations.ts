/**
 * 编辑操作原语：在行数组上执行单条替换 / 追加 / 前置。
 *
 * 每条操作都基于行引用锚点（{line}#{hash}），先做 hash 校验，
 * 再定位到实际行号执行。skipValidation 用于多编辑批量应用时
 * 跳过重复校验（已在入口统一校验）。
 */
import {
  autocorrectReplacementLines,
  restoreLeadingIndent,
  stripInsertAnchorEcho,
  stripInsertBeforeEcho,
  stripRangeBoundaryEcho,
  toNewLines,
} from "./text"
import { parseLineRef, validateLineRef } from "./refs"

interface EditApplyOptions {
  skipValidation?: boolean
}

function shouldValidate(options?: EditApplyOptions): boolean {
  return options?.skipValidation !== true
}

/** 单行替换（replace, 无 end）。 */
export function applySetLine(
  lines: string[],
  anchor: string,
  newText: string | string[],
  options?: EditApplyOptions
): string[] {
  if (shouldValidate(options)) validateLineRef(lines, anchor)
  const { line } = parseLineRef(anchor)
  const result = [...lines]
  const originalLine = lines[line - 1] ?? ""
  const corrected = autocorrectReplacementLines([originalLine], toNewLines(newText))
  const replacement = corrected.map((entry, idx) => {
    if (idx !== 0) return entry
    return restoreLeadingIndent(originalLine, entry)
  })
  result.splice(line - 1, 1, ...replacement)
  return result
}

/** 范围替换（replace, 带 end）。 */
export function applyReplaceLines(
  lines: string[],
  startAnchor: string,
  endAnchor: string,
  newText: string | string[],
  options?: EditApplyOptions
): string[] {
  if (shouldValidate(options)) {
    validateLineRef(lines, startAnchor)
    validateLineRef(lines, endAnchor)
  }

  const { line: startLine } = parseLineRef(startAnchor)
  const { line: endLine } = parseLineRef(endAnchor)

  if (startLine > endLine) {
    throw new Error(
      `Invalid range: start line ${startLine} cannot be greater than end line ${endLine}`
    )
  }

  const result = [...lines]
  const originalRange = lines.slice(startLine - 1, endLine)
  const stripped = stripRangeBoundaryEcho(lines, startLine, endLine, toNewLines(newText))
  const corrected = autocorrectReplacementLines(originalRange, stripped)
  const restored = corrected.map((entry, idx) => {
    if (idx !== 0) return entry
    return restoreLeadingIndent(lines[startLine - 1] ?? "", entry)
  })
  result.splice(startLine - 1, endLine - startLine + 1, ...restored)
  return result
}

/** 在锚点行之后插入（append with pos）。 */
export function applyInsertAfter(
  lines: string[],
  anchor: string,
  text: string | string[],
  options?: EditApplyOptions
): string[] {
  if (shouldValidate(options)) validateLineRef(lines, anchor)
  const { line } = parseLineRef(anchor)
  const result = [...lines]
  const newLines = stripInsertAnchorEcho(lines[line - 1], toNewLines(text))
  if (newLines.length === 0) {
    throw new Error(`append (anchored) requires non-empty text for ${anchor}`)
  }
  result.splice(line, 0, ...newLines)
  return result
}

/** 在锚点行之前插入（prepend with pos）。 */
export function applyInsertBefore(
  lines: string[],
  anchor: string,
  text: string | string[],
  options?: EditApplyOptions
): string[] {
  if (shouldValidate(options)) validateLineRef(lines, anchor)
  const { line } = parseLineRef(anchor)
  const result = [...lines]
  const newLines = stripInsertBeforeEcho(lines[line - 1], toNewLines(text))
  if (newLines.length === 0) {
    throw new Error(`prepend (anchored) requires non-empty text for ${anchor}`)
  }
  result.splice(line - 1, 0, ...newLines)
  return result
}

/** 追加到文件末尾（append, 无 pos）。 */
export function applyAppend(lines: string[], text: string | string[]): string[] {
  const normalized = toNewLines(text)
  if (normalized.length === 0) {
    throw new Error("append requires non-empty text")
  }
  if (lines.length === 1 && lines[0] === "") {
    return [...normalized]
  }
  // 尾换行文件经 split("\n") 后末尾是幻影空行（代表结尾换行，写回依赖它还原）。
  // 把新行插到幻影行之前：既不产生多余空行，也不丢失结尾换行；
  // 若追加文本自带结尾换行（归一化后末位为空串），直接复用，不再补幻影行。
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    return normalized[normalized.length - 1] === ""
      ? [...lines.slice(0, -1), ...normalized]
      : [...lines.slice(0, -1), ...normalized, ""]
  }
  return [...lines, ...normalized]
}

/** 前置到文件开头（prepend, 无 pos）。 */
export function applyPrepend(lines: string[], text: string | string[]): string[] {
  const normalized = toNewLines(text)
  if (normalized.length === 0) {
    throw new Error("prepend requires non-empty text")
  }
  if (lines.length === 1 && lines[0] === "") {
    return [...normalized]
  }
  return [...normalized, ...lines]
}
