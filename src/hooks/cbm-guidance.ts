/**
 * CBM guidance / index health advisory hook（CBM-11）。
 *
 * 在既有 hook 注册（src/hooks/index.ts）基础上追加一个独立、fail-open 的
 * CBM 引导/索引健康咨询 hook，**绝不拦截合法工具**：
 *
 * before（execute.before）：
 *   - 首次结构化查询（cbm_search_graph / cbm_trace / cbm_code / cbm_query）前
 *     调用 indexer.ensureIndexed 确保索引就绪（同一 session 去重）；
 *   - 索引未就绪（进行中 / autoIndex 关闭 / 失败）时不阻断，仅在结构化查询
 *     结果上追加一条引导文案供 agent 回退原生工具。
 *
 * after（execute.after）：
 *   - 已索引项目对**重复** grep/read 追加 advisory hint，建议改用结构化查询；
 *   - grep 的 text/comment/ast 模式、glob、ast_grep_* 一律不提示（避免误伤）；
 *   - 同一 session 只提示一次（去重）；
 *   - 尊重 codebaseMemory.guidance：guidanceEnabled=false 时全部静默。
 *
 * 任何异常一律 fail-open（记日志、不抛错），保证不拦截合法工具、不伪造索引
 * 状态。错误归一化复用 `buildIndexingGuidance` / IndexerOutcome。
 */
import { buildIndexingGuidance } from '../cbm/guidance';
import type { IndexerHandle } from '../cbm/indexer';

/** 触发首次索引检查的 CBM 结构化查询工具。 */
export const CBM_STRUCTURED_QUERY_TOOLS = [
  'cbm_search_graph',
  'cbm_trace',
  'cbm_code',
  'cbm_query',
] as const;

/** grep 的这些 mode 表示"文本/注释/结构搜索"，均不提示。 */
const EXCLUDED_GREP_MODES = new Set(['text', 'comment', 'ast']);

/** 重复 grep/read 提示的默认阈值（达到该次数才提示一次）。 */
export const DEFAULT_CBM_GREP_READ_MIN_CALLS = 3;

/** 重复 grep/read 提示的标记前缀。 */
export const CBM_GREP_READ_HINT_MARKER = '[oceanus:cbm]';

/** 结构化查询引导追加的标记前缀。 */
export const CBM_GUIDANCE_MARKER = '[oceanus:cbm-guidance]';

/** 默认索引检查/状态查询超时（毫秒）。 */
const DEFAULT_CBM_GUIDANCE_TIMEOUT_MS = 30_000;

/** 组装重复 grep/read 的 advisory hint 文案。 */
export function buildGrepReadHint(projectPath?: string): string {
  const scope = projectPath ? `项目 ${projectPath}` : '当前项目';
  return (
    `${CBM_GREP_READ_HINT_MARKER} 已索引${scope}，反复 grep/read 定位代码较慢；` +
    '可改用 cbm_search_graph / cbm_trace / cbm_code 结构化查询，效率更高。'
  );
}

export interface CbmGuidanceHookOptions {
  /** 共享/自建索引器（ensureIndexed / isIndexed）。 */
  indexer: IndexerHandle;
  /** 是否尊重 codebaseMemory.guidance；false 时全部静默。 */
  guidanceEnabled: boolean;
  /** 重复 grep/read 提示阈值（默认 {@link DEFAULT_CBM_GREP_READ_MIN_CALLS}）。 */
  minGrepReadCalls?: number;
  /** ensureIndexed 超时（毫秒）。 */
  timeoutMs?: number;
  /** 解析 sessionID 对应的工作区根目录；无法解析返回 null。 */
  resolveRoot: (sessionID: string) => Promise<string | null>;
  /** 日志注入（可选）。 */
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

/** 是否属于"可提示"的 grep/read 调用（排除 text/comment/ast 与其它工具）。 */
function isGrepReadEligible(tool: unknown, input: unknown): boolean {
  if (tool === 'read') return true;
  if (tool === 'grep') {
    const mode = (input as Record<string, unknown> | undefined)?.mode;
    if (typeof mode === 'string' && EXCLUDED_GREP_MODES.has(mode)) return false;
    return true;
  }
  return false;
}

/** 向事件结果追加一条 advisory 文本；结果形状不匹配时静默（fail-open）。 */
function appendContent(event: any, text: string): void {
  const result = event?.result;
  if (result && typeof result === 'object' && typeof result.content === 'string') {
    result.content += '\n\n' + text;
  }
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * 创建 CBM guidance hook（before + after 一对）。
 */
export function createCbmGuidanceHook(opts: CbmGuidanceHookOptions) {
  const log = opts.log ?? (() => {});
  const minCalls = opts.minGrepReadCalls ?? DEFAULT_CBM_GREP_READ_MIN_CALLS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CBM_GUIDANCE_TIMEOUT_MS;

  /** 已做过首次索引检查的 (session,project) 键。 */
  const checkedIndex = new Map<string, number>();
  /** 待追加到结构化查询结果上的引导文案 (session,project) → message。 */
  const pendingGuidance = new Map<string, string>();
  /** 每个 session 累计的合格 grep/read 调用数。 */
  const grepReadCount = new Map<string, number>();
  /** 已提示过的 session（同一 session 只提示一次）。 */
  const hintEmitted = new Set<string>();
  /** 已确认索引状态的 project（避免对未索引项目反复状态查询）。 */
  const indexStateKnown = new Set<string>();

  const key = (sessionID: string, projectPath: string) =>
    projectPath ? `${sessionID}::${projectPath}` : sessionID;

  return {
    /** execute.before：首次结构化查询前检查索引（fail-open）。 */
    async before(event: any): Promise<void> {
      if (!event) return;
      if (!CBM_STRUCTURED_QUERY_TOOLS.includes(event.tool)) return;
      try {
        const root = await opts.resolveRoot(event.sessionID);
        if (!root) return;
        const k = key(event.sessionID, root);
        const previousAttempt = checkedIndex.get(k);
        // 终态永久去重；starting 只允许再做一次 attempt 2 检查。
        if (previousAttempt === 2 || previousAttempt === -1) return;
        const outcome = await opts.indexer.ensureIndexed(root, {
          workspaceRoot: root,
          timeoutMs,
        });
        if (outcome.kind === 'indexed') {
          checkedIndex.set(k, -1);
          return;
        }
        if (outcome.kind === 'index_started') {
          checkedIndex.set(k, 1);
        }
        if (outcome.kind === 'starting') {
          checkedIndex.set(k, outcome.attempt);
        } else if (outcome.kind === 'degraded' && outcome.reason === 'stale') {
          checkedIndex.set(k, -1);
        } else if (outcome.kind !== 'index_started') {
          checkedIndex.set(k, previousAttempt ?? 0);
        }
        const guidance = buildIndexingGuidance(outcome, root);
        if (guidance.fallbackRecommended) pendingGuidance.set(k, guidance.message);
      } catch (e) {
        log('cbm-guidance.before 失败(fail-open)', { error: messageOf(e) });
      }
    },

    /** execute.after：结构化查询引导 + 重复 grep/read 提示（均 fail-open）。 */
    async after(event: any): Promise<void> {
      if (!event) return;
      try {
        const tool = event.tool;

        // 结构化查询：把未就绪引导追加到结果上（不拦截）。
        if (CBM_STRUCTURED_QUERY_TOOLS.includes(tool)) {
          const root = await opts.resolveRoot(event.sessionID);
          const k = key(event.sessionID, root ?? '');
          const msg = pendingGuidance.get(k);
          if (msg) {
            pendingGuidance.delete(k);
            appendContent(event, `${CBM_GUIDANCE_MARKER} ${msg}`);
          }
          return;
        }

        if (!opts.guidanceEnabled) return;
        if (!isGrepReadEligible(tool, event.input)) return;

        const sid = event.sessionID;
        if (hintEmitted.has(sid)) return;
        const root = await opts.resolveRoot(sid);
        if (!root) return;

        const n = (grepReadCount.get(sid) ?? 0) + 1;
        grepReadCount.set(sid, n);
        if (n < minCalls) return;

        // 已索引才提示；未索引项目用 check-only（autoIndex:false）确认一次，
        // 避免因为"反复 grep" 触发建索引的副作用。
        if (!indexStateKnown.has(root)) {
          indexStateKnown.add(root);
          const outcome = await opts.indexer.ensureIndexed(root, {
            workspaceRoot: root,
            timeoutMs,
            autoIndex: false,
          });
          if (outcome.kind !== 'indexed') return;
        } else if (!opts.indexer.isIndexed(root, root)) {
          return;
        }

        appendContent(event, buildGrepReadHint(root));
        hintEmitted.add(sid);
      } catch (e) {
        log('cbm-guidance.after 失败(fail-open)', { error: messageOf(e) });
      }
    },
  };
}
