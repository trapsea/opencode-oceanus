/**
 * hashline_edit 成功结果的展示层。
 *
 * 宿主 TUI 对插件工具没有专属渲染器（按工具名精确匹配内置注册表，
 * 未注册回落 GenericTool 原样文本展示），因此成功结果直接以可读文本
 * 作为 `Tool.Result.output` / `content`，让 TUI 与模型看到同一份
 * unified diff 前后对比；同时在 `metadata.filediff` 携带
 * `{ file, patch }`，与宿主 `edit` 渲染器消费的字段约定对齐，
 * 上游一旦通用化 diff 渲染即可直接生效。
 */
import type { HashlineFileResult } from "./executor"

export interface HashlinePresentation {
  /** 可读文本：结果头 + unified diff + hashlineDiff 锚点段。 */
  readonly text: string
  /** 附加到 Tool.Result.metadata 的字段（filediff 与摘要统计）。 */
  readonly metadata: Readonly<Record<string, unknown>>
}

/** 生成成功结果的可读展示文本与 metadata。 */
export function presentHashlineSuccess(result: HashlineFileResult): HashlinePresentation {
  const path = result.path ?? "(unknown path)"
  const header = resultHeader(result, path)

  const sections: string[] = [header]
  if (result.diff) {
    sections.push(result.diff)
  }
  if (result.hashlineDiff) {
    sections.push("hashlineDiff:")
    sections.push(result.hashlineDiff.trimEnd())
  }

  const text = sections.join("\n")

  const metadata: Record<string, unknown> = {
    ok: true,
    path: result.path,
    created: result.created,
    changed: result.changed,
    additions: result.additions,
    deletions: result.deletions,
  }
  if (result.deleted) metadata.deleted = true
  if (result.renamed) {
    metadata.renamed = true
    metadata.from = result.from
    metadata.to = result.to
  }
  // 与宿主 edit 渲染器的 metadata.filediff 约定对齐。注意：不提供 patch 字段——
  // 宿主 resolveFileDiff 优先解析 patch 且格式要求严（tab/Index 头），我们的 unified
  // diff 格式会被解析为空；只给 before/after 全文走 fileDiffFromContent 确定性渲染。
  if (result.diff) {
    metadata.filediff = {
      file: result.path,
      before: result.before,
      after: result.after,
      additions: result.additions,
      deletions: result.deletions,
    };
  }

  return { text, metadata }
}

function resultHeader(result: HashlineFileResult, path: string): string {
  if (result.deleted) return `Deleted ${path}`
  if (result.renamed) return `Renamed ${result.from ?? path} -> ${result.to ?? path}`
  const stats = `(+${result.additions} -${result.deletions})`
  if (result.created) return `Created ${path} ${stats}`
  return `Edited ${path} ${stats}`
}
