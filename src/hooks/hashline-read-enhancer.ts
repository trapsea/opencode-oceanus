import { computeLineHash, formatHashLine } from '../tools/hashline-edit/hash'
import { HASHLINE_OUTPUT_PATTERN } from '../tools/hashline-edit/constants'

type ReadEvent = {
  tool?: string
  status?: string
  input?: { offset?: number; limit?: number }
  result?: { content?: unknown; [key: string]: unknown }
}

/** 将 read 的文本按原文件行号转换为 hashline；重复调用不会再次包装。 */
export function createHashlineReadEnhancer() {
  return (event: ReadEvent): void => {
    if (event?.tool !== 'read' || event.status !== 'completed' || typeof event.result?.content !== 'string') return
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
