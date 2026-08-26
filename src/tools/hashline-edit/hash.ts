/**
 * 稳定行 hash 与 hashline 格式化。
 *
 * 稳定性约定：
 * - 行尾 `\r` 会被剥离；行尾空白会被裁剪，因此 hash 对行尾空白不敏感。
 * - 对于"无意义"（仅空白 / 无字母数字）的行，seed 使用行号本身，
 *   使得空行 / 空白行的 hash 与行号绑定，避免多行同 hash。
 * - 其余行以 0 为 seed。这样同一行内容在文件中位置变化时 hash 不变
 *   （仅对含有效字符的行成立），形成稳定的内容指纹。
 */
import { HASHLINE_DICT } from "./constants"
import { hashXxh32 } from "./xxhash32"

/** 含字母或数字才视为"有意义"行。 */
const RE_SIGNIFICANT = /[\p{L}\p{N}]/u

function computeNormalizedLineHash(lineNumber: number, normalizedContent: string): string {
  const seed = RE_SIGNIFICANT.test(normalizedContent) ? 0 : lineNumber
  const hash = hashXxh32(normalizedContent, seed)
  const index = hash % 256
  return HASHLINE_DICT[index]
}

/** 计算当前规范 hash（去掉 `\r` 与行尾空白后）。 */
export function computeLineHash(lineNumber: number, content: string): string {
  return computeNormalizedLineHash(lineNumber, content.replace(/\r/g, "").trimEnd())
}

/** 兼容旧 hash：去全部空白后再计算。用于容忍旧引用。 */
export function computeLegacyLineHash(lineNumber: number, content: string): string {
  return computeNormalizedLineHash(lineNumber, content.replace(/\r/g, "").replace(/\s+/g, ""))
}

/** 生成单行 hashline：`{行号}#{hash}|{内容}`。 */
export function formatHashLine(lineNumber: number, content: string): string {
  const hash = computeLineHash(lineNumber, content)
  return `${lineNumber}#${hash}|${content}`
}

/** 将整段文本转为 hashline 输出。 */
export function formatHashLines(content: string): string {
  if (!content) return ""
  return content
    .split("\n")
    .map((line, index) => formatHashLine(index + 1, line))
    .join("\n")
}
