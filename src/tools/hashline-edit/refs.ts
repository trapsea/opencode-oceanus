/**
 * 范围锚点解析与 hash mismatch 校验。
 *
 * - 解析 `{行号}#{hash}` 引用，容忍 `>>>` / `+` / `-` 前缀、`#` 周围空白、
 *   从 hashline 行尾（`|...`）截取等输入形式。
 * - 校验引用 hash 与文件当前内容是否一致；不一致抛出 HashlineMismatchError，
 *   附带更新后的行引用提示。
 */
import { HASHLINE_REF_PATTERN } from "./constants"
import { computeLegacyLineHash, computeLineHash } from "./hash"
import type { LineRef } from "./types"

interface HashMismatch {
  line: number
  expected: string
}

const MISMATCH_CONTEXT = 2

/** 从任意文本中提取形如 `N#XX` 的片段。 */
const LINE_REF_EXTRACT_PATTERN = /([0-9]+#[ZPMQVRWSNKTXJBYH]{2})/

function isCompatibleLineHash(line: number, content: string, hash: string): boolean {
  return computeLineHash(line, content) === hash || computeLegacyLineHash(line, content) === hash
}

/** 归一化引用：去前缀、去空白、去掉尾部 hashline 内容。 */
export function normalizeLineRef(ref: string): string {
  const originalTrimmed = ref.trim()
  let trimmed = originalTrimmed
  trimmed = trimmed.replace(/^(?:>>>|[+-])\s*/, "")
  trimmed = trimmed.replace(/\s*#\s*/, "#")
  trimmed = trimmed.replace(/\|.*$/, "")
  trimmed = trimmed.trim()

  if (HASHLINE_REF_PATTERN.test(trimmed)) {
    return trimmed
  }

  const extracted = trimmed.match(LINE_REF_EXTRACT_PATTERN)
  if (extracted) {
    return extracted[1]
  }

  return originalTrimmed
}

/** 将引用解析为 { line, hash }。格式非法时抛错。 */
export function parseLineRef(ref: string): LineRef {
  const normalized = normalizeLineRef(ref)
  const match = normalized.match(HASHLINE_REF_PATTERN)
  if (match) {
    return {
      line: Number.parseInt(match[1], 10),
      hash: match[2],
    }
  }
  const hashIdx = normalized.indexOf("#")
  if (hashIdx > 0) {
    const prefix = normalized.slice(0, hashIdx)
    const suffix = normalized.slice(hashIdx + 1)
    if (!/^\d+$/.test(prefix) && /^[ZPMQVRWSNKTXJBYH]{2}$/.test(suffix)) {
      throw new Error(
        `Invalid line reference: "${ref}". "${prefix}" is not a line number. ` +
          `Use the actual line number from the read output.`
      )
    }
  }
  throw new Error(
    `Invalid line reference format: "${ref}". Expected format: "{line_number}#{hash_id}"`
  )
}

function suggestLineForHash(ref: string, lines: string[]): string | null {
  const hashMatch = ref.trim().match(/#([ZPMQVRWSNKTXJBYH]{2})$/)
  if (!hashMatch) return null
  const hash = hashMatch[1]
  for (let i = 0; i < lines.length; i++) {
    if (isCompatibleLineHash(i + 1, lines[i], hash)) {
      return `Did you mean "${i + 1}#${computeLineHash(i + 1, lines[i])}"?`
    }
  }
  return null
}

function parseLineRefWithHint(ref: string, lines: string[]): LineRef {
  try {
    return parseLineRef(ref)
  } catch (parseError) {
    const hint = suggestLineForHash(ref, lines)
    if (hint && parseError instanceof Error) {
      throw new Error(`${parseError.message} ${hint}`)
    }
    throw parseError
  }
}

/** 校验单条引用：行号越界或 hash 不一致均抛错。 */
export function validateLineRef(lines: string[], ref: string): void {
  const { line, hash } = parseLineRefWithHint(ref, lines)

  if (line < 1 || line > lines.length) {
    throw new Error(`Line number ${line} out of bounds. File has ${lines.length} lines.`)
  }

  const content = lines[line - 1]
  if (!isCompatibleLineHash(line, content, hash)) {
    throw new HashlineMismatchError([{ line, expected: hash }], lines)
  }
}

/** 批量校验引用，汇总所有 mismatch。 */
export function validateLineRefs(lines: string[], refs: string[]): void {
  const mismatches: HashMismatch[] = []

  for (const ref of refs) {
    const { line, hash } = parseLineRefWithHint(ref, lines)

    if (line < 1 || line > lines.length) {
      throw new Error(`Line number ${line} out of bounds (file has ${lines.length} lines)`)
    }

    const content = lines[line - 1]
    if (!isCompatibleLineHash(line, content, hash)) {
      mismatches.push({ line, expected: hash })
    }
  }

  if (mismatches.length > 0) {
    throw new HashlineMismatchError(mismatches, lines)
  }
}

/** 文件内容在读取后发生变化导致的 hash 不匹配错误。 */
export class HashlineMismatchError extends Error {
  readonly remaps: ReadonlyMap<string, string>

  constructor(
    private readonly mismatches: HashMismatch[],
    private readonly fileLines: string[]
  ) {
    super(HashlineMismatchError.formatMessage(mismatches, fileLines))
    this.name = "HashlineMismatchError"
    const remaps = new Map<string, string>()
    for (const mismatch of mismatches) {
      const actual = computeLineHash(mismatch.line, fileLines[mismatch.line - 1] ?? "")
      remaps.set(`${mismatch.line}#${mismatch.expected}`, `${mismatch.line}#${actual}`)
    }
    this.remaps = remaps
  }

  static formatMessage(mismatches: HashMismatch[], fileLines: string[]): string {
    const mismatchByLine = new Map<number, HashMismatch>()
    for (const mismatch of mismatches) mismatchByLine.set(mismatch.line, mismatch)

    const displayLines = new Set<number>()
    for (const mismatch of mismatches) {
      const low = Math.max(1, mismatch.line - MISMATCH_CONTEXT)
      const high = Math.min(fileLines.length, mismatch.line + MISMATCH_CONTEXT)
      for (let line = low; line <= high; line++) displayLines.add(line)
    }

    const sortedLines = [...displayLines].sort((a, b) => a - b)
    const output: string[] = []
    output.push(
      `${mismatches.length} line${mismatches.length > 1 ? "s have" : " has"} changed since last read. ` +
        "Use updated {line_number}#{hash_id} references below (>>> marks changed lines)."
    )
    output.push("")

    let previousLine = -1
    for (const line of sortedLines) {
      if (previousLine !== -1 && line > previousLine + 1) {
        output.push("    ...")
      }
      previousLine = line

      const content = fileLines[line - 1] ?? ""
      const hash = computeLineHash(line, content)
      const prefix = `${line}#${hash}|${content}`
      if (mismatchByLine.has(line)) {
        output.push(`>>> ${prefix}`)
      } else {
        output.push(`    ${prefix}`)
      }
    }

    return output.join("\n")
  }
}
