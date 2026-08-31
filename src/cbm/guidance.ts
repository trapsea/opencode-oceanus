import type { IndexerOutcome } from './indexer';

/**
 * codebase-memory-mcp（CBM）索引生命周期引导提示。
 *
 * CBM-06：把索引器结果（indexer.ts）翻译成对 agent / 用户的简明引导文案与
 * 回退建议。核心语义：
 *   - 已索引 → 可直接使用结构化查询，不回退；
 *   - 索引启动中 → 返回 `starting`，超时标记 `stale` 并 fail-open 回退原生工具；
 *   - 未索引且自动索引关闭 → 指向已注册的 cbm_index 工具并允许 fallback；
 *   - 失败降级 → 回退原生工具，绝不伪造“完整索引结果”。
 *
 * 本模块刻意只依赖 indexer 类型，保持纯函数，供 hook / 工具接线复用。
 */

/** 引导提示的分类。 */
export type CbmGuidanceKind =
  | 'ready'
  | 'indexing_in_progress'
  | 'auto_index_disabled'
  | 'no_project'
  | 'degraded';

/** 面向调用方的一条引导提示。 */
export interface CbmGuidance {
  kind: CbmGuidanceKind;
  message: string;
  /** 是否建议回退到 grep/glob/read 等原生工具。 */
  fallbackRecommended: boolean;
}

/** 查询期间索引进行中的标准文案。 */
export const INDEXING_IN_PROGRESS_MESSAGE =
  'CBM 正在为项目建立索引（starting）；若状态变为 stale 则 fail-open 回退，建议稍后重试或先用 grep/read 兜底。';

/** 未索引且自动索引关闭时的操作性提示（允许 fallback）。 */
export const AUTO_INDEX_DISABLED_MESSAGE =
  '项目尚未建立 CBM 索引，且自动索引已关闭（autoIndex=false）。' +
  '可调用已注册的 cbm_index 工具手动建索引；当前已允许回退到原生工具（grep/glob/read）。';

/** 无有效项目路径时的提示。 */
export const NO_PROJECT_MESSAGE =
  '未提供有效项目路径，无法为 CBM 建立索引；已回退到原生工具。';

/**
 * 根据索引器结果生成引导提示。
 *
 * @param outcome  索引器 ensureIndexed 的归一化结果。
 * @param projectPath 项目路径（可选，仅用于文案）。
 */
export function buildIndexingGuidance(
  outcome: IndexerOutcome,
  projectPath?: string,
): CbmGuidance {
  const scope = projectPath ? `项目 ${projectPath}` : '当前项目';
  switch (outcome.kind) {
    case 'indexed':
      return {
        kind: 'ready',
        message: `CBM 已索引${scope}，可直接使用 search_graph/trace_path 等结构化查询。`,
        fallbackRecommended: false,
      };
    case 'index_started':
      return {
        kind: 'indexing_in_progress',
        message: `已为${scope}触发自动索引，但尚未确认完成；建议稍后重试，或先用 grep/read 兜底。`,
        fallbackRecommended: true,
      };
    case 'starting':
      return {
        kind: 'indexing_in_progress',
        message: INDEXING_IN_PROGRESS_MESSAGE,
        fallbackRecommended: true,
      };
    case 'indexing':
      return {
        kind: 'indexing_in_progress',
        message: INDEXING_IN_PROGRESS_MESSAGE,
        fallbackRecommended: true,
      };
    case 'skipped_auto_index_disabled':
      return {
        kind: 'auto_index_disabled',
        message: AUTO_INDEX_DISABLED_MESSAGE,
        fallbackRecommended: true,
      };
    case 'skipped_no_project':
      return { kind: 'no_project', message: NO_PROJECT_MESSAGE, fallbackRecommended: true };
    case 'degraded': {
      const detail = outcome.message ? `（${outcome.message}）` : '';
      return {
        kind: 'degraded',
        message: `CBM 索引不可用：${outcome.reason}${detail}。已回退到原生工具，本次不会伪造完整索引结果。`,
        fallbackRecommended: true,
      };
    }
  }
}
