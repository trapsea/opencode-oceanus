/**
 * 文件文本封套（envelope）：在编辑前规范化、编辑后恢复。
 *
 * 负责换行保留：
 * - 检测并记录 BOM（\uFEFF），恢复时原样还原。
 * - 检测行尾风格（LF 或 CRLF），内部统一用 LF 处理，写回时还原。
 * - 编辑只改变内容，不改变整体换行风格与 BOM。
 */
export interface FileTextEnvelope {
  content: string
  hadBom: boolean
  lineEnding: "\n" | "\r\n"
}

function detectLineEnding(content: string): "\n" | "\r\n" {
  const crlfIndex = content.indexOf("\r\n")
  const lfIndex = content.indexOf("\n")
  if (lfIndex === -1) return "\n"
  if (crlfIndex === -1) return "\n"
  return crlfIndex < lfIndex ? "\r\n" : "\n"
}

function stripBom(content: string): { content: string; hadBom: boolean } {
  if (!content.startsWith("\uFEFF")) {
    return { content, hadBom: false }
  }
  return { content: content.slice(1), hadBom: true }
}

function normalizeToLf(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

function restoreLineEndings(content: string, lineEnding: "\n" | "\r\n"): string {
  if (lineEnding === "\n") return content
  return content.replace(/\n/g, "\r\n")
}

/** 读入的原始文本 → 规范 LF 内容 + 封套元信息。 */
export function canonicalizeFileText(content: string): FileTextEnvelope {
  const stripped = stripBom(content)
  return {
    content: normalizeToLf(stripped.content),
    hadBom: stripped.hadBom,
    lineEnding: detectLineEnding(stripped.content),
  }
}

/** 规范 LF 内容 → 按封套恢复换行与 BOM 的最终文本。 */
export function restoreFileText(content: string, envelope: FileTextEnvelope): string {
  const withLineEnding = restoreLineEndings(content, envelope.lineEnding)
  if (!envelope.hadBom) return withLineEnding
  return `\uFEFF${withLineEnding}`
}
