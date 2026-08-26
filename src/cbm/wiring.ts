import { getCodebaseMemoryConfig, type CodebaseMemoryResolvedConfig } from '../config/utils';
import type { PluginConfig } from '../config/schema';
import { getCacheRoot } from './paths';
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
  logger?: (message: string, meta?: Record<string, unknown>) => void;
}

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
    reset: () => {},
  };
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
  const cacheRoot = cm.cacheDir ?? getCacheRoot();
  const installOptions: ProvisionOptions = { cacheRoot };

  const startBackgroundInstall = injections.startBackgroundInstall ?? provisionStartBackgroundInstall;
  const ensureInstalled = injections.ensureInstalled ?? provisionEnsureInstalled;
  const repair = injections.repair ?? provisionRepair;
  const createIndexer = injections.createIndexer ?? createIndexerImpl;

  const doInstall: EnsureInstalledFn = (opts = {}) =>
    ensureInstalled({ ...installOptions, ...opts });
  const doStart: BackgroundInstallFn = (opts = {}) =>
    startBackgroundInstall({ ...installOptions, ...opts });
  const doRepair: RepairFn = (opts = {}) => repair({ ...installOptions, ...opts });

  // 共享 CLI runDeps：ensureInstalled 绑定同一 cacheRoot。
  const runDeps: CbmRunDeps = { ensureInstalled: () => doInstall() };

  // 共享索引器：runDeps / env（CBM_CACHE_DIR）/ binaryPath 与 CLI 一致。
  let indexer: IndexerHandle;
  try {
    indexer = createIndexer({
      autoIndex: cm.autoIndex,
      binaryPath: cm.binaryPath,
      env: cm.cacheDir ? { CBM_CACHE_DIR: cm.cacheDir } : undefined,
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
