import path from 'node:path';
import { runCbmCli } from '../tools/cbm/cli';
import {
  INDEX_REPOSITORY_TOOL,
  INDEX_STATUS_TOOL,
  type CbmCliErrorCode,
  type CbmCliResult,
  type CbmExecOptions,
  type CbmRunDeps,
} from '../tools/cbm/types';

/**
 * codebase-memory-mcp（CBM）索引生命周期与自动首次索引。
 *
 * CBM-06：在首次结构化查询前检查项目状态并按配置自动初始化索引。
 *   - `list_projects` / `index_status` 结构化结果归一化；
 *   - 按 workspace root 做 session 级状态缓存（已索引项目集合）；
 *   - `autoIndex=true` 时只对首次需要 CBM 的项目调用一次 `index_repository`；
 *   - 并发首次查询共享同一个 indexing Promise，绝不重复建图；
 *   - 未索引且自动索引关闭时返回操作性提示并允许 fallback；
 *   - 索引失败一律降级（不抛异常、不伪造“已索引”），允许回退原生工具；
 *   - 项目间状态严格隔离（按项目路径独立缓存）。
 *
 * 执行通过 CBM-03 的 `runCbmCli` / `CbmRunDeps` 注入接口，测试可注入 fake
 * `runCli`，不依赖真实二进制 / 网络 / 缓存。
 */

/** 归一化后的项目索引状态。 */
export type IndexStatusKind = 'indexed' | 'unindexed' | 'starting' | 'stale' | 'degraded' | 'unknown';

/** 状态检查失败的错误码（含归一化失败情形）。 */
export type IndexStatusErrorCode =
  | CbmCliErrorCode
  | 'empty_result'
  | 'unparsed_status'
  | 'invalid_shape'
  | 'unknown';

/** `index_status` 结构化结果归一化。 */
export interface IndexStatusInfo {
  kind: IndexStatusKind;
  /** CBM daemon 启动中的观测序号与经过时间。 */
  attempt?: 1 | 2;
  elapsedMs?: number;
  errorCode?: IndexStatusErrorCode;
  errorMessage?: string;
}

/** `list_projects` 结构化结果归一化。 */
export interface NormalizedListProjects {
  ok: boolean;
  projects: string[];
  errorCode?: IndexStatusErrorCode;
  errorMessage?: string;
}

/** 可注入的 CLI 执行函数（默认 `runCbmCli`）。 */
export type IndexerRunCli = (
  options: CbmExecOptions,
  runDeps?: CbmRunDeps,
) => Promise<CbmCliResult>;

/** 创建索引器时可注入的依赖与默认配置。 */
export interface IndexerOptions {
  /** 默认自动索引开关（可在单次 ensureIndexed 覆盖）。 */
  autoIndex?: boolean;
  /** 显式二进制路径，透传给内部 CLI 调用。 */
  binaryPath?: string;
  /** 额外环境变量白名单覆盖。 */
  env?: Record<string, string | undefined>;
  /** CBM 缓存根目录；设置后不可被单次调用的 env 覆盖。 */
  cacheRoot?: string;
  /** 实际执行 CLI 的函数；默认 runCbmCli，测试注入 fake。 */
  runCli?: IndexerRunCli;
  /** CBM-03 注入接口：spawn / resolveBinary / ensureInstalled 等。 */
  runDeps?: CbmRunDeps;
}

/** 单次 ensureIndexed 的可选覆盖项（须兼容 CbmIndexer.ensureIndexed）。 */
export interface EnsureIndexedOptions {
  workspaceRoot: string;
  timeoutMs: number;
  /** 覆盖工厂默认的自动索引开关。 */
  autoIndex?: boolean;
  /** 覆盖工厂默认的二进制路径。 */
  binaryPath?: string;
  /** 覆盖工厂默认的环境覆盖。 */
  env?: Record<string, string | undefined>;
}

/** ensureIndexed 的归一化结果，驱动后续查询与引导提示。 */
export type IndexerOutcome =
  /** 已确认索引（会话缓存或状态检查命中）。 */
  | { kind: 'indexed' }
  /** 首次自动索引已触发并成功。 */
  | { kind: 'index_started' }
  /** CBM 自身报告正在索引（查询期间返回 indexing in progress）。 */
  | { kind: 'starting'; attempt: 1 | 2; elapsedMs: number }
  /** @deprecated 兼容旧调用方；新状态统一为 starting。 */
  | { kind: 'indexing' }
  /** 未索引且自动索引关闭 → 允许 fallback。 */
  | { kind: 'skipped_auto_index_disabled' }
  /** 无有效项目路径 → 允许 fallback。 */
  | { kind: 'skipped_no_project' }
  /** 索引/状态检查失败 → 降级，允许 fallback。 */
  | {
      kind: 'degraded';
      reason: 'index_failed' | 'index_status_failed' | 'stale' | 'exception';
      errorCode?: IndexStatusErrorCode;
      message?: string;
    };

/** 有状态索引器句柄（ensureIndexed 兼容 {@link CbmIndexer}）。 */
export interface IndexerHandle {
  /**
   * 确保项目已索引：已索引命中缓存；未索引且 autoIndex 时触发一次
   * index_repository；并发调用共享同一个 indexing Promise。
   */
  ensureIndexed(
    projectPath: string | undefined,
    opts: EnsureIndexedOptions,
  ): Promise<IndexerOutcome>;
  /** 会话缓存：该项目是否已确认索引。 */
  isIndexed(projectPath: string | undefined, workspaceRoot: string): boolean;
  /** 是否有该项目的索引正在进行中。 */
  isIndexing(projectPath: string | undefined, workspaceRoot: string): boolean;
  /** 该项目最近一次 ensureIndexed 结果。 */
  getLastOutcome(
    projectPath: string | undefined,
    workspaceRoot: string,
  ): IndexerOutcome | undefined;
  /**
   * 同一项目的并发调用共享同一个 Promise（跨工具去重）；
   * 不缓存已完成结果——完成后的再次调用会重新执行 fn（保留显式刷新语义）。
   */
  runExclusive<T>(
    projectPath: string | undefined,
    workspaceRoot: string,
    fn: () => Promise<T>,
  ): Promise<T>;
  /** 清空会话状态（新 session 复用同一句柄时）。 */
  reset(): void;
}

/** 将 projectPath 规范化为会话缓存键（绝对路径）。 */
function projectKey(
  projectPath: string | undefined,
  workspaceRoot: string,
): string | undefined {
  if (!projectPath) return undefined;
  return path.isAbsolute(projectPath)
    ? path.resolve(projectPath)
    : path.resolve(workspaceRoot, projectPath);
}

/** `index_status` 结构化错误归一化，绝不在不确定时误报“已索引”。 */
export function normalizeIndexStatus(result: CbmCliResult): IndexStatusInfo {
  if (!result.ok) {
    return {
      kind: 'unknown',
      errorCode: result.error?.code ?? 'unknown',
      errorMessage: result.error?.message,
    };
  }
  const data = result.data;
  if (typeof data !== 'object' || data === null) {
    return { kind: 'unknown', errorCode: 'empty_result' };
  }
  const d = data as Record<string, unknown>;
  const status = typeof d.status === 'string' ? d.status.toLowerCase() : undefined;
  if (d.in_progress === true || d.indexing === true || status === 'indexing' || status === 'starting') {
    return { kind: 'starting' };
  }
  if (status === 'stale') return { kind: 'stale' };
  if (status === 'degraded') return { kind: 'degraded' };
  if (status === 'indexed' || status === 'ready' || d.indexed === true) return { kind: 'indexed' };
  if (
    status === 'unindexed' ||
    status === 'not_indexed' ||
    status === 'not_initialized' ||
    status === 'uninitialized' ||
    d.indexed === false
  ) {
    return { kind: 'unindexed' };
  }
  return {
    kind: 'unknown',
    errorCode: 'unparsed_status',
    errorMessage: status !== undefined ? `unrecognized index status: ${JSON.stringify(status)}` : undefined,
  };
}

/** `list_projects` 结构化错误归一化。 */
export function normalizeListProjects(result: CbmCliResult): NormalizedListProjects {
  if (!result.ok) {
    return {
      ok: false,
      projects: [],
      errorCode: result.error?.code ?? 'unknown',
      errorMessage: result.error?.message,
    };
  }
  const data = result.data;
  if (Array.isArray(data)) {
    return { ok: true, projects: data.filter((x): x is string => typeof x === 'string') };
  }
  if (typeof data === 'object' && data !== null) {
    const projects = (data as Record<string, unknown>).projects;
    if (Array.isArray(projects)) {
      return {
        ok: true,
        projects: projects.filter((x): x is string => typeof x === 'string'),
      };
    }
  }
  return { ok: false, projects: [], errorCode: 'invalid_shape' };
}

/**
 * 创建有状态的索引器。
 *
 * session 状态（已索引集合、进行中的 indexing Promise、最近结果）在返回的
 * 句柄内维护，按项目路径隔离；多个并发/后续调用复用同一次索引。
 */
export function createIndexer(options: IndexerOptions = {}): IndexerHandle {
  const run: IndexerRunCli = options.runCli ?? runCbmCli;
  const indexedProjects = new Set<string>();
  const inFlight = new Map<string, Promise<IndexerOutcome>>();
  const exclusiveInFlight = new Map<string, Promise<unknown>>();
  const lastOutcomes = new Map<string, IndexerOutcome>();
  const startingState = new Map<string, { attempt: 1 | 2; startedAt: number }>();
  const buildEnv = (env?: Record<string, string | undefined>) => ({
    ...options.env,
    ...env,
    ...(options.cacheRoot !== undefined ? { CBM_CACHE_DIR: options.cacheRoot } : {}),
  });

  async function checkStatus(
    projectPath: string,
    opts: EnsureIndexedOptions,
  ): Promise<IndexStatusInfo> {
    const result = await run(
      {
        tool: INDEX_STATUS_TOOL,
        args: { project: projectPath },
        workspaceRoot: opts.workspaceRoot,
        binaryPath: opts.binaryPath ?? options.binaryPath,
         timeoutMs: opts.timeoutMs,
        env: buildEnv(opts.env),
        cacheRoot: options.cacheRoot,
      },
      options.runDeps,
    );
    return normalizeIndexStatus(result);
  }

  async function runIndexRepository(
    projectPath: string,
    opts: EnsureIndexedOptions,
  ): Promise<Extract<IndexerOutcome, { kind: 'index_started' | 'degraded' }>> {
    const result = await run(
      {
        tool: INDEX_REPOSITORY_TOOL,
        args: { repo_path: projectPath },
        workspaceRoot: opts.workspaceRoot,
        binaryPath: opts.binaryPath ?? options.binaryPath,
         timeoutMs: opts.timeoutMs,
        env: buildEnv(opts.env),
        cacheRoot: options.cacheRoot,
      },
      options.runDeps,
    );
    if (result.ok) return { kind: 'index_started' };
    return {
      kind: 'degraded',
      reason: 'index_failed',
      errorCode: result.error?.code,
      message: result.error?.message,
    };
  }

  async function ensureCore(
    projectPath: string,
    opts: EnsureIndexedOptions,
    key: string,
  ): Promise<IndexerOutcome> {
    const autoIndex = opts.autoIndex ?? options.autoIndex ?? true;

    // autoIndex 关闭 → 允许 fallback，不做任何 CLI 调用
    if (!autoIndex) {
      const outcome: IndexerOutcome = { kind: 'skipped_auto_index_disabled' };
      lastOutcomes.set(key, outcome);
      return outcome;
    }

    const state = startingState.get(key);
    const startedAt = state?.startedAt ?? Date.now();
    const boundedOpts = (): EnsureIndexedOptions => ({
      ...opts,
      timeoutMs: Math.min(opts.timeoutMs, Math.max(0, 90_000 - (Date.now() - startedAt))),
    });
    const check = await checkStatus(projectPath, boundedOpts());
    if (check.kind === 'indexed') {
      indexedProjects.add(key);
      startingState.delete(key);
      const outcome: IndexerOutcome = { kind: 'indexed' };
      lastOutcomes.set(key, outcome);
      return outcome;
    }
    if (check.kind === 'starting') {
      if (state?.attempt === 2) {
        const outcome: IndexerOutcome = {
          kind: 'degraded', reason: 'stale',
          message: `CBM daemon remains starting after 2 attempts (${Date.now() - startedAt}ms)`,
        };
        startingState.delete(key);
        lastOutcomes.set(key, outcome);
        return outcome;
      }
      const attempt: 1 | 2 = state?.attempt === 1 ? 2 : 1;
      const outcome: IndexerOutcome = { kind: 'starting', attempt, elapsedMs: Date.now() - startedAt };
      startingState.set(key, { attempt, startedAt });
      lastOutcomes.set(key, outcome);
      return outcome;
    }
    if (check.kind === 'unknown' || check.kind === 'stale' || check.kind === 'degraded') {
      const outcome: IndexerOutcome = {
        kind: 'degraded',
        reason: check.kind === 'stale' ? 'stale' : 'index_status_failed',
        errorCode: check.errorCode,
        message: check.errorMessage,
      };
      lastOutcomes.set(key, outcome);
      return outcome;
    }

    // unindexed → 触发首次索引
    startingState.delete(key);
    const outcome = await runIndexRepository(projectPath, boundedOpts());
    lastOutcomes.set(key, outcome);
    return outcome;
  }

  return {
    async ensureIndexed(projectPath, opts) {
      const key = projectKey(projectPath, opts.workspaceRoot);
      if (!key) return { kind: 'skipped_no_project' };

      // 已索引命中（会话缓存）
      if (indexedProjects.has(key)) return { kind: 'indexed' };

      // 并发首次查询共享同一个 indexing Promise
      const existing = inFlight.get(key);
      if (existing) return existing;

      const runPromise = (async () => {
        try {
          return await ensureCore(projectPath as string, opts, key);
        } catch (e) {
          const outcome: IndexerOutcome = {
            kind: 'degraded',
            reason: 'exception',
            message: e instanceof Error ? e.message : String(e),
          };
          lastOutcomes.set(key, outcome);
          return outcome;
        }
      })();

      inFlight.set(key, runPromise);
      try {
        return await runPromise;
      } finally {
        if (inFlight.get(key) === runPromise) inFlight.delete(key);
      }
    },

    async runExclusive<T>(
      projectPath: string | undefined,
      workspaceRoot: string,
      fn: () => Promise<T>,
    ) {
      const key = projectKey(projectPath, workspaceRoot);
      // 无法定位项目键时不做跨调用合并，直接执行（fail-open）。
      if (!key) return fn();

      const existing = exclusiveInFlight.get(key) as Promise<T> | undefined;
      if (existing) return existing;

      const runPromise = fn().finally(() => {
        if (exclusiveInFlight.get(key) === runPromise) exclusiveInFlight.delete(key);
      });
      exclusiveInFlight.set(key, runPromise);
      return runPromise;
    },

    isIndexed(projectPath, workspaceRoot) {
      const key = projectKey(projectPath, workspaceRoot);
      return key ? indexedProjects.has(key) : false;
    },

    isIndexing(projectPath, workspaceRoot) {
      const key = projectKey(projectPath, workspaceRoot);
      return key ? inFlight.has(key) : false;
    },

    getLastOutcome(projectPath, workspaceRoot) {
      const key = projectKey(projectPath, workspaceRoot);
      return key ? lastOutcomes.get(key) : undefined;
    },

    reset() {
      indexedProjects.clear();
      inFlight.clear();
      exclusiveInFlight.clear();
      lastOutcomes.clear();
      startingState.clear();
    },
  };
}
