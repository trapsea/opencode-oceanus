/**
 * 稳定 diff 生成。
 *
 * 不依赖第三方 diff 库，保证输出确定、可复现：
 * - generateHashlineDiff：逐行对比，输出 hashline 风格 diff（`-` / `+`）。
 * - generateUnifiedDiff：基于 LCS 的 unified diff，带 3 行上下文。
 * - countLineDiffs：基于多集差的增删统计（确定性）。
 * - toHashlineContent：将内容转成 hashline 输出。
 */
import { computeLineHash, formatHashLine } from "./hash"

/** 将内容转成 hashline 输出（保留结尾换行语义）。 */
export function toHashlineContent(content: string): string {
  if (!content) return content
  const lines = content.split("\n")
  const lastLine = lines[lines.length - 1]
  const hasTrailingNewline = lastLine === ""
  const contentLines = hasTrailingNewline ? lines.slice(0, -1) : lines
  const hashlined = contentLines.map((line, i) => formatHashLine(i + 1, line))
  return hasTrailingNewline ? hashlined.join("\n") + "\n" : hashlined.join("\n")
}

/**
 * 逐行 hashline diff：只在行变化处输出 `-`/`+`，完全确定。
 * 用于 hashline 编辑前后的快速可视化。
 */
export function generateHashlineDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split("\n")
  const newLines = newContent.split("\n")

  const parts: string[] = [`--- ${filePath}\n+++ ${filePath}\n`]
  const maxLines = Math.max(oldLines.length, newLines.length)

  for (let i = 0; i < maxLines; i += 1) {
    const oldLine = oldLines[i] ?? ""
    const newLine = newLines[i] ?? ""
    const lineNum = i + 1
    const hash = computeLineHash(lineNum, newLine)

    if (i >= oldLines.length) {
      parts.push(`+ ${lineNum}#${hash}|${newLine}\n`)
      continue
    }
    if (i >= newLines.length) {
      parts.push(`- ${lineNum}#  |${oldLine}\n`)
      continue
    }
    if (oldLine !== newLine) {
      parts.push(`- ${lineNum}#  |${oldLine}\n`)
      parts.push(`+ ${lineNum}#${hash}|${newLine}\n`)
    }
  }

  return parts.join("")
}

/** 基于 LCS 计算两序列差异（返回指向 new 序列的增删段）。 */
interface DiffOp {
  type: "equal" | "change"
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
}

function computeDiffOps(oldLines: string[], newLines: string[]): DiffOp[] {
  const n = oldLines.length
  const m = newLines.length

  // 前向 DP：dp[i][j] = old 前 i 与 new 前 j 的 LCS 长度。
  // 为节省内存仅保留前一行。
  const dp = new Array<number[]>(n + 1)
  for (let i = 0; i <= n; i++) dp[i] = new Array<number>(m + 1).fill(0)

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const ops: DiffOp[] = []
  let i = n
  let j = m
  // 反向回溯，把删除/插入聚合成连续段。
  // 回溯从高索引向低索引推进，因此每次累加都要把 start 更新为当前 i-1 / j-1，
  // 最终 start 落在段的最低索引。
  let delStart = -1
  let delCount = 0
  let insStart = -1
  let insCount = 0

  const flushRun = (): void => {
    if (delCount > 0 || insCount > 0) {
      ops.push({
        type: "change",
        oldStart: delStart,
        oldCount: delCount,
        newStart: insStart,
        newCount: insCount,
      })
      delStart = -1
      delCount = 0
      insStart = -1
      insCount = 0
    }
  }

  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      flushRun()
      ops.push({ type: "equal", oldStart: i - 1, oldCount: 1, newStart: j - 1, newCount: 1 })
      i -= 1
      j -= 1
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      delStart = i - 1
      delCount += 1
      i -= 1
    } else {
      insStart = j - 1
      insCount += 1
      j -= 1
    }
  }
  while (i > 0) {
    delStart = i - 1
    delCount += 1
    i -= 1
  }
  while (j > 0) {
    insStart = j - 1
    insCount += 1
    j -= 1
  }
  flushRun()

  return ops.reverse()
}

/**
 * 生成带 3 行上下文的 unified diff（确定性 LCS）。
 */
export function generateUnifiedDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split("\n")
  const newLines = newContent.split("\n")
  const context = 3
  const ops = computeDiffOps(oldLines, newLines)

  // 找出 change 操作下标。
  const changeOps: number[] = []
  for (let idx = 0; idx < ops.length; idx++) {
    if (ops[idx].type === "change") changeOps.push(idx)
  }
  if (changeOps.length === 0) {
    return `--- ${filePath}\n+++ ${filePath}`
  }

  // 将相邻（含 context 以内 equal 间隔）的 change 聚合成 hunk。
  const hunks: { start: number; end: number }[] = []
  let hunkStart = changeOps[0]
  let hunkEnd = changeOps[0]
  for (const ci of changeOps.slice(1)) {
    // 两 change 之间的 equal 行数 <= 2*context 则并入同一 hunk。
    let gapLines = 0
    for (let idx = hunkEnd + 1; idx < ci; idx++) {
      gapLines += ops[idx].oldCount
    }
    if (gapLines <= 2 * context) {
      hunkEnd = ci
    } else {
      hunks.push({ start: hunkStart, end: hunkEnd })
      hunkStart = ci
      hunkEnd = ci
    }
  }
  hunks.push({ start: hunkStart, end: hunkEnd })

  const lines: string[] = [`--- ${filePath}`, `+++ ${filePath}`]

  for (const hunk of hunks) {
    // 向前扩展 context：从 hunk.start 前一个 op 开始向头部累加 equal 行。
    let firstOp = hunk.start
    let ctxBefore = 0
    for (let idx = hunk.start - 1; idx >= 0 && ctxBefore < context; idx--) {
      const op = ops[idx]
      if (op.type !== "equal") break
      const take = Math.min(context - ctxBefore, op.oldCount)
      ctxBefore += take
      if (take < op.oldCount) break
      firstOp = idx
    }
    // 向后扩展 context。
    let lastOp = hunk.end
    let ctxAfter = 0
    for (let idx = hunk.end + 1; idx < ops.length && ctxAfter < context; idx++) {
      const op = ops[idx]
      if (op.type !== "equal") break
      const take = Math.min(context - ctxAfter, op.oldCount)
      ctxAfter += take
      if (take < op.oldCount) break
      lastOp = idx
    }

    // 计算 hunk 覆盖的 old/new 行范围（仅取实际渲染的部分）。
    let oldStart = Infinity
    let oldEnd = -1
    let newStart = Infinity
    let newEnd = -1
    for (let opIdx = firstOp; opIdx <= lastOp; opIdx++) {
      const op = ops[opIdx]
      oldStart = Math.min(oldStart, op.oldStart)
      oldEnd = Math.max(oldEnd, op.oldStart + op.oldCount - 1)
      newStart = Math.min(newStart, op.newStart)
      newEnd = Math.max(newEnd, op.newStart + op.newCount - 1)
    }

    const oldCount = oldEnd - oldStart + 1
    const newCount = newEnd - newStart + 1
    lines.push(`@@ -${oldStart + 1},${oldCount} +${newStart + 1},${newCount} @@`)

    for (let opIdx = firstOp; opIdx <= lastOp; opIdx++) {
      const op = ops[opIdx]
      if (op.type === "equal") {
        for (let k = op.oldStart; k < op.oldStart + op.oldCount; k++) {
          lines.push(` ${oldLines[k] ?? ""}`)
        }
      } else {
        for (let k = op.oldStart; k < op.oldStart + op.oldCount; k++) {
          lines.push(`-${oldLines[k] ?? ""}`)
        }
        for (let k = op.newStart; k < op.newStart + op.newCount; k++) {
          lines.push(`+${newLines[k] ?? ""}`)
        }
      }
    }
  }

  return lines.join("\n")
}

/** 基于多集差的确定性增删统计。 */
export function countLineDiffs(
  oldContent: string,
  newContent: string
): { additions: number; deletions: number } {
  const oldLines = oldContent.split("\n")
  const newLines = newContent.split("\n")

  const oldSet = new Map<string, number>()
  for (const line of oldLines) {
    oldSet.set(line, (oldSet.get(line) ?? 0) + 1)
  }

  const newSet = new Map<string, number>()
  for (const line of newLines) {
    newSet.set(line, (newSet.get(line) ?? 0) + 1)
  }

  let deletions = 0
  for (const [line, count] of oldSet) {
    const newCount = newSet.get(line) ?? 0
    if (count > newCount) {
      deletions += count - newCount
    }
  }

  let additions = 0
  for (const [line, count] of newSet) {
    const oldCount = oldSet.get(line) ?? 0
    if (count > oldCount) {
      additions += count - oldCount
    }
  }

  return { additions, deletions }
}
