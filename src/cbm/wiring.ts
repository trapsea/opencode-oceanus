import { getCodebaseMemoryConfig, type CodebaseMemoryResolvedConfig } from '../config/utils';
import type { PluginConfig } from '../config/schema';
import { existsSync } from 'node:fs';
import { getCacheRoot } from './paths';
import { resolveExpectedBinaryPath } from './mcp';
import { ensurePermanentDaemon, type EnsurePermanentDaemonOptions } from './daemon';
import { buildCbmEnv } from '../tools/cbm/args';
import {
  ensureInstalled as provisionEnsureInstalled,
  repair as provisionRepair,
  startBackgroundInstall as provisionStartBackgroundInstall,
  type ProvisionOptions,
} from './provision';
import {
  createIndexer as createIndexerImpl,
  type IndexerHandle,
  type IndexerOptions,
} from './indexer';
import type { CbmRunDeps } from '../tools/cbm/types';

/**
 * codebase-memory-mcp（CBM）入口接线共享依赖（CBM-13）。
 *
 * 本模块负责把「缓存根、安装、索引器、CLI 依赖、UI 安装」收敛为一份共享依赖，
 * 供 `src/index.ts` 的 setup 依次接线给后台安装、MCP、CLI 工具、guidance hook
 * 与 `/cbm` 命令，确保显式 `codebaseMemory.cacheDir` 同时用于 provision / MCP /
 * CLI / UI / commands。
 *
 * 可注入依赖（`CbmWiringInjections`）供测试替换网络/进程实现，缺省走真实
 * provision / indexer。任一构建步骤独立 fail-open（索引器失败回落 fallback，
 * 不抛异常，不阻塞插件启动）。
 */

/** 后台安装函数签名（与 provision 的 `startBackgroundInstall` 一致，测试可注入）。 */
export type BackgroundInstallFn = (options?: ProvisionOptions) => Promise<string | null>;
/** 前台安装函数签名（与 provision 的 `ensureInstalled` 一致，测试可注入）。 */
export type EnsureInstalledFn = (options?: ProvisionOptions) => Promise<string | null>;
/** 修复函数签名（与 provision 的 `repair` 一致，测试可注入）。 */
export type RepairFn = (options?: ProvisionOptions) => Promise<string | null>;
/** 索引器工厂签名（测试可注入）。 */
export type IndexerFactory = (options?: IndexerOptions) => IndexerHandle;

/** CBM 接线可注入依赖（测试替换网络/进程；缺省走真实实现）。 */
export interface CbmWiringInjections {
  startBackgroundInstall?: BackgroundInstallFn;
  ensureInstalled?: EnsureInstalledFn;
  repair?: RepairFn;
  createIndexer?: IndexerFactory;
  /** daemon 预热等待实现（runSetup 的 cbm-daemon 阶段注入；测试用）。 */
  prewarm?: DaemonEnsureFn;
  logger?: (message: string, meta?: Record<string, unknown>) => void;
}

/** daemon 预热等待函数签名（与 daemon.ensurePermanentDaemon 一致，测试可注入）。 */
export type DaemonEnsureFn = (
  options: EnsurePermanentDaemonOptions,
) => Promise<import('./daemon').DaemonWaitResult>;

/** 入口接线共用的 CBM 共享依赖。 */
export interface CbmSharedDeps {
  /** 解析后的 codebaseMemory 配置。 */
  cm: CodebaseMemoryResolvedConfig;
  /** 共享缓存根：显式 `codebaseMemory.cacheDir` 优先，否则默认 {@link getCacheRoot}。 */
  cacheRoot: string;
  /** 绑定 cacheRoot 的安装参数。 */
  installOptions: ProvisionOptions;
  /** 共享前台安装（返回共享 Promise；失败 null；调用方不 await 即非阻塞）。 */
  ensureInstalled: EnsureInstalledFn;
  /** 共享后台安装（setup 只触发不 await）。 */
  startBackground: BackgroundInstallFn;
  /** 共享修复（强制重新安装，等待完成）。 */
  repair: RepairFn;
  /** CLI 执行依赖：共享 ensureInstalled + indexer，供 tools/hooks 复用。 */
  runDeps: CbmRunDeps;
  /** 共享索引器（tools/hooks/commands 复用同一实例）。 */
  indexer: IndexerHandle;
  /** UI 启动用 ensureInstalled（绑定共享 cacheRoot）。 */
  uiEnsureInstalled: EnsureInstalledFn;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 索引器构建失败时的 fail-open 兜底（可回退原生工具，不伪造“已索引”）。 */
export function createFallbackIndexer(): IndexerHandle {
  return {
    ensureIndexed: async () => ({
      kind: 'degraded',
      reason: 'exception',
      message: 'CBM indexer unavailable（构建失败，fail-open）',
    }),
    isIndexed: () => false,
    isIndexing: () => false,
    getLastOutcome: () => undefined,
    runExclusive: (_projectPath, _workspaceRoot, fn) => fn(),
    reset: () => {},
  };
}

/** {@link startDaemonPrewarm} 的可注入依赖（测试用）。 */
export interface DaemonPrewarmInjections {
  prewarm?: DaemonEnsureFn;
  exists?: (path: string) => boolean;
  /** 就绪等待超时上限（默认 daemon.DAEMON_READY_TIMEOUT_MS = 15s）。 */
  timeoutMs?: number;
}

/** 构造与 CLI/MCP 通道一致的 daemon 环境（白名单基础 + CBM_CACHE_DIR 覆盖）。 */
function buildDaemonEnv(cacheRoot: string): Record<string, string> {
  return {
    ...buildCbmEnv({}, process.env),
    CBM_CACHE_DIR: cacheRoot,
  } as Record<string, string>;
}

/**
 * 对已知二进制执行一次前台等待式 daemon 预热；失败/超时 fail-open 记录。
 * 供 startDaemonPrewarm 与 mcp 安装完成路径复用。
 */
export async function waitForDaemonReady(
  cacheRoot: string,
  binaryPath: string,
  log?: (message: string, meta?: Record<string, unknown>) => void,
  ensure?: DaemonEnsureFn,
  timeoutMs?: number,
): Promise<void> {
  const fn = ensure ?? ensurePermanentDaemon;
  const result = await fn({
    binaryPath,
    cacheRoot,
    env: buildDaemonEnv(cacheRoot),
    log,
    timeoutMs,
  });
  if (result.status !== 'ready') {
    log?.('[oceanus] CBM daemon 预热未就绪(fail-open)', {
      status: result.status,
      elapsedMs: result.elapsedMs,
      detail: result.detail,
    });
  } else {
    log?.('[oceanus] CBM daemon 预热就绪', {
      mode: result.mode,
      elapsedMs: result.elapsedMs,
    });
  }
}

/**
 * CBM daemon 前台等待式预热编排（setup 'cbm-daemon' 阶段调用，async）。
 *
 * 门控语义（与 MCP 通道及自动下载配置对齐）：
 * - `cm.binaryPath` 显式配置时直接等待它就绪，绝不触发 provision 下载；
 * - `autoDownload=false` 时仅当缓存中的期望二进制已存在才等待（离线/禁下载
 *   场景不得因预热发起网络下载）；
 * - 其余情况（autoDownload=true）：
 *   - 缓存已存在期望二进制：直接等待就绪（service 冷启动主竞态场景）；
 *   - 缓存缺失（首次安装/下载中）：fire-and-forget 后台预热，不阻塞 setup
 *     （MCP 注册走 disabled 占位，安装完成由 mcp 通道再次确保 daemon 就绪）。
 *
 * 调用方必须在宿主 MCP reload（spawn stdio MCP server）前 await 本函数：
 * daemon 就绪后所有 stdio 连接变为 connect-to-warm，消除首个连接在 daemon
 * 冷启动窗口内失败（Connection closed / 30s 超时）并防止 session-managed
 * 抢先拉起导致 permanent 无法建立。任何失败均 fail-open，不抛异常。
 */
export async function startDaemonPrewarm(
  shared: CbmSharedDeps,
  log?: (message: string, extra?: Record<string, unknown>) => void,
  injections: DaemonPrewarmInjections = {},
): Promise<void> {
  if (!shared.cm.enabled) return;
  const exists = injections.exists ?? existsSync;
  const warm = (binaryPath: string | null | undefined) => {
    if (!binaryPath) return;
    return waitForDaemonReady(
      shared.cacheRoot,
      binaryPath,
      log,
      injections.prewarm,
      injections.timeoutMs,
    );
  };

  if (shared.cm.binaryPath) {
    await warm(shared.cm.binaryPath);
    return;
  }
  if (!shared.cm.autoDownload) {
    // 关闭自动下载：仅当缓存二进制已存在时等待，避免预热触发下载。
    const expected = resolveExpectedBinaryPath(shared.cm, shared.cacheRoot);
    if (exists(expected)) await warm(expected);
    return;
  }
  // 自动下载：缓存已有二进制 → 阻塞等待就绪（主场景）；缓存缺失 → 后台预热。
  const expected = resolveExpectedBinaryPath(shared.cm, shared.cacheRoot);
  if (exists(expected)) {
    await warm(expected);
    return;
  }
  void shared
    .ensureInstalled()
    .then((bin) => warm(bin))
    .catch(() => {
      // 预热失败不影响功能：CLI 调用时仍会 connect-or-start。
    });
}

/**
 * 构造 CBM 入口接线所需的共享依赖。
 *
 * - `cacheRoot = 显式 codebaseMemory.cacheDir ?? 默认 getCacheRoot()`；
 * - provision / MCP / CLI / UI / commands 复用同一 cacheRoot 与同一安装 Promise；
 * - tools / hooks / commands 复用同一 indexer 与同一 runDeps；
 * - 索引器构建失败独立 fail-open（回落 fallback indexer，不抛异常）。
 */
export function buildCbmSharedDeps(
  config: PluginConfig | undefined,
  injections: CbmWiringInjections = {},
): CbmSharedDeps {
  const log = injections.logger ?? (() => {});
  const cm = getCodebaseMemoryConfig(config);
  const cacheRoot = cm.cacheDir ?? process.env.CBM_CACHE_DIR ?? getCacheRoot();
  const installOptions: ProvisionOptions = { cacheRoot, version: cm.version };

  const startBackgroundInstall = injections.startBackgroundInstall ?? provisionStartBackgroundInstall;
  const ensureInstalled = injections.ensureInstalled ?? provisionEnsureInstalled;
  const repair = injections.repair ?? provisionRepair;
  const createIndexer = injections.createIndexer ?? createIndexerImpl;

  const doInstall: EnsureInstalledFn = (opts = {}) =>
    ensureInstalled({ ...opts, ...installOptions });
  const doStart: BackgroundInstallFn = (opts = {}) =>
    startBackgroundInstall({ ...opts, ...installOptions });
  const doRepair: RepairFn = (opts = {}) => repair({ ...opts, ...installOptions });

  // 共享 CLI runDeps：ensureInstalled 绑定同一 cacheRoot。
  const runDeps: CbmRunDeps = { ensureInstalled: () => doInstall() };

  // 共享索引器：runDeps / env（CBM_CACHE_DIR）/ binaryPath 与 CLI 一致。
  let indexer: IndexerHandle;
  try {
    indexer = createIndexer({
      autoIndex: cm.autoIndex,
      binaryPath: cm.binaryPath,
      env: { CBM_CACHE_DIR: cacheRoot },
      cacheRoot,
      runDeps,
    });
  } catch (e) {
    log('[oceanus] CBM indexer 构建失败(fail-open)', { error: messageOf(e) });
    indexer = createFallbackIndexer();
  }
  runDeps.indexer = indexer;

  return {
    cm,
    cacheRoot,
    installOptions,
    ensureInstalled: doInstall,
    startBackground: doStart,
    repair: doRepair,
    runDeps,
    indexer,
    uiEnsureInstalled: doInstall,
  };
}
