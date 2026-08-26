/**
 * 编辑去重与排序辅助。
 *
 * - dedupeEdits：按规范 key 去重完全相同（含锚点归一化与 payload 归一化）的编辑。
 * - getEditLineNumber / collectLineRefs / detectOverlappingRanges：
 *   用于为多编辑应用做排序、引用收集与重叠范围检测。
 */
import { toNewLines } from "./text"
import { parseLineRef, normalizeLineRef } from "./refs"
import type { HashlineEdit } from "./types"

function normalizeEditPayload(payload: string | string[]): string {
  return toNewLines(payload).join("\n")
}

function canonicalAnchor(anchor: string | undefined): string {
  if (!anchor) return ""
  return normalizeLineRef(anchor)
}

function buildDedupeKey(edit: HashlineEdit): string {
  switch (edit.op) {
    case "replace":
      return `replace|${canonicalAnchor(edit.pos)}|${edit.end ? canonicalAnchor(edit.end) : ""}|${normalizeEditPayload(edit.lines)}`
    case "append":
      return `append|${canonicalAnchor(edit.pos)}|${normalizeEditPayload(edit.lines)}`
    case "prepend":
      return `prepend|${canonicalAnchor(edit.pos)}|${normalizeEditPayload(edit.lines)}`
    default:
      return JSON.stringify(edit)
  }
}

/** 去除完全重复的编辑，返回剩余编辑与去重数量。 */
export function dedupeEdits(edits: HashlineEdit[]): { edits: HashlineEdit[]; deduplicatedEdits: number } {
  const seen = new Set<string>()
  const deduped: HashlineEdit[] = []
  let deduplicatedEdits = 0

  for (const edit of edits) {
    const key = buildDedupeKey(edit)
    if (seen.has(key)) {
      deduplicatedEdits += 1
      continue
    }
    seen.add(key)
    deduped.push(edit)
  }

  return { edits: deduped, deduplicatedEdits }
}

/** 编辑的排序锚点行号（范围替换取末行，无锚 append/prepend 为 -Infinity）。 */
export function getEditLineNumber(edit: HashlineEdit): number {
  switch (edit.op) {
    case "replace":
      return parseLineRef(edit.end ?? edit.pos).line
    case "append":
      return edit.pos ? parseLineRef(edit.pos).line : Number.NEGATIVE_INFINITY
    case "prepend":
      return edit.pos ? parseLineRef(edit.pos).line : Number.NEGATIVE_INFINITY
    default:
      return Number.POSITIVE_INFINITY
  }
}

/** 收集编辑引用的全部行引用（用于批量校验 hash）。 */
export function collectLineRefs(edits: HashlineEdit[]): string[] {
  return edits.flatMap((edit) => {
    switch (edit.op) {
      case "replace":
        return edit.end ? [edit.pos, edit.end] : [edit.pos]
      case "append":
      case "prepend":
        return edit.pos ? [edit.pos] : []
      default:
        return []
    }
  })
}

/** 检测多个范围替换是否重叠；返回错误信息或 null。 */
export function detectOverlappingRanges(edits: HashlineEdit[]): string | null {
  const ranges: { start: number; end: number; idx: number }[] = []
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]
    if (edit.op !== "replace" || !edit.end) continue
    const start = parseLineRef(edit.pos).line
    const end = parseLineRef(edit.end).line
    ranges.push({ start, end, idx: i })
  }
  if (ranges.length < 2) return null

  ranges.sort((a, b) => a.start - b.start || a.end - b.end)
  for (let i = 1; i < ranges.length; i++) {
    const prev = ranges[i - 1]
    const curr = ranges[i]
    if (curr.start <= prev.end) {
      return (
        `Overlapping range edits detected: ` +
        `edit ${prev.idx + 1} (lines ${prev.start}-${prev.end}) overlaps with ` +
        `edit ${curr.idx + 1} (lines ${curr.start}-${curr.end}). ` +
        `Use pos-only replace for single-line edits.`
      )
    }
  }
  return null
}
