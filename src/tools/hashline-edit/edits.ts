/**
 * 多编辑批量应用：去重 → 排序 → 批量校验 → 按序执行。
 *
 * 排序策略：按锚点行号从大到小执行，使前面的编辑不影响后续锚点行号
 * （倒序从文件尾部向头部改写）。同锚点时按 replace → append → prepend 优先。
 */
import { dedupeEdits, detectOverlappingRanges, getEditLineNumber, collectLineRefs } from "./ordering"
import type { HashlineEdit } from "./types"
import {
  applyAppend,
  applyInsertAfter,
  applyInsertBefore,
  applyPrepend,
  applyReplaceLines,
  applySetLine,
} from "./operations"
import { validateLineRefs } from "./refs"

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export interface HashlineApplyReport {
  content: string
  noopEdits: number
  deduplicatedEdits: number
}

/** 应用一组编辑，返回新内容与统计信息。 */
export function applyHashlineEditsWithReport(
  content: string,
  edits: HashlineEdit[]
): HashlineApplyReport {
  if (edits.length === 0) {
    return {
      content,
      noopEdits: 0,
      deduplicatedEdits: 0,
    }
  }

  const dedupeResult = dedupeEdits(edits)
  const EDIT_PRECEDENCE: Record<string, number> = { replace: 0, append: 1, prepend: 2 }
  const sortedEdits = [...dedupeResult.edits].sort((a, b) => {
    const lineA = getEditLineNumber(a)
    const lineB = getEditLineNumber(b)
    if (lineB !== lineA) return lineB - lineA
    return (EDIT_PRECEDENCE[a.op] ?? 3) - (EDIT_PRECEDENCE[b.op] ?? 3)
  })

  let noopEdits = 0

  let lines = content.length === 0 ? [] : content.split("\n")

  const refs = collectLineRefs(sortedEdits)
  validateLineRefs(lines, refs)

  const overlapError = detectOverlappingRanges(sortedEdits)
  if (overlapError) throw new Error(overlapError)

  for (const edit of sortedEdits) {
    switch (edit.op) {
      case "replace": {
        const next = edit.end
          ? applyReplaceLines(lines, edit.pos, edit.end, edit.lines, { skipValidation: true })
          : applySetLine(lines, edit.pos, edit.lines, { skipValidation: true })
        if (arraysEqual(next, lines)) {
          noopEdits += 1
          break
        }
        lines = next
        break
      }
      case "append": {
        const next = edit.pos
          ? applyInsertAfter(lines, edit.pos, edit.lines, { skipValidation: true })
          : applyAppend(lines, edit.lines)
        if (arraysEqual(next, lines)) {
          noopEdits += 1
          break
        }
        lines = next
        break
      }
      case "prepend": {
        const next = edit.pos
          ? applyInsertBefore(lines, edit.pos, edit.lines, { skipValidation: true })
          : applyPrepend(lines, edit.lines)
        if (arraysEqual(next, lines)) {
          noopEdits += 1
          break
        }
        lines = next
        break
      }
    }
  }

  return {
    content: lines.join("\n"),
    noopEdits,
    deduplicatedEdits: dedupeResult.deduplicatedEdits,
  }
}

/** 便捷版：仅返回新内容。 */
export function applyHashlineEdits(content: string, edits: HashlineEdit[]): string {
  return applyHashlineEditsWithReport(content, edits).content
}
