import { createIndexer, type IndexerHandle, type IndexerRunCli } from '../../cbm/indexer';
import { getCodebaseMemoryConfig, isToolEnabled } from '../../config/utils';
import type { PluginConfig } from '../../config/schema';
import type { ToolDefinition, ToolingContext } from '../../runtime/types';
import { runCbmCli } from './cli';
import type { CbmRunDeps } from './types';
import { getCacheRoot } from '../../cbm/paths';
import {
  buildCbmCodeTool,
  buildCbmDetectChangesTool,
  buildCbmIndexTool,
  buildCbmQueryTool,
  buildCbmSearchGraphTool,
  buildCbmStatusTool,
  buildCbmTraceTool,
  type CbmToolEnv,
} from './builders';

/**
 * codebase-memory-mcp（CBM）CLI 兜底工具注册入口（CBM-09）。
 *
 * `buildCbmTools` 负责：
 * - 尊重 `codebaseMemory.enabled` 与 `codebaseMemory.cliFallback`（都关闭则不注册）；
 * - 构建共享的 CLI 执行函数（默认 runCbmCli，测试注入 fake）与共享索引器；
 * - 按 `isToolEnabled` 过滤单个 cbm_* 工具；
 * - 每个 builder 独立构建，注册期错误由上层（tools/index.ts）单独容错。
 */
export interface RegisterCbmToolsOptions {
  /** 实际执行 CLI 的函数（默认 runCbmCli，测试注入 fake）。 */
  runCli?: IndexerRunCli;
  /** CLI 执行依赖（spawn / resolveBinary / ensureInstalled 等）。 */
  runDeps?: CbmRunDeps;
  /** 自定义索引器（测试注入 stub；缺省由 createIndexer 构建）。 */
  indexer?: IndexerHandle;
  cacheRoot?: string;
}

/** 按配置构建全部启用的 cbm_* 工具；codebaseMemory 关闭时返回空数组。 */
export function buildCbmTools(
  ctx: ToolingContext,
  config: PluginConfig,
  opts: RegisterCbmToolsOptions = {},
): ToolDefinition[] {
  const cm = getCodebaseMemoryConfig(config);
  if (!cm.enabled || !cm.cliFallback) return [];

  const run: IndexerRunCli = opts.runCli ?? runCbmCli;
  const cacheRoot = opts.cacheRoot ?? cm.cacheDir ?? process.env.CBM_CACHE_DIR ?? getCacheRoot();
  const env: CbmToolEnv = {
    run,
    runDeps: opts.runDeps,
    indexer:
      opts.indexer ??
      createIndexer({
        autoIndex: cm.autoIndex,
        binaryPath: cm.binaryPath,
        cacheRoot,
        runCli: run,
        runDeps: opts.runDeps,
      }),
    binaryPath: cm.binaryPath,
    env: { CBM_CACHE_DIR: cacheRoot },
    cacheRoot,
    autoIndex: cm.autoIndex,
  };

  const builders: ReadonlyArray<{
    name: string;
    build(ctx: ToolingContext, config: PluginConfig, env: CbmToolEnv): ToolDefinition;
  }> = [
    { name: 'cbm_status', build: buildCbmStatusTool },
    { name: 'cbm_index', build: buildCbmIndexTool },
    { name: 'cbm_search_graph', build: buildCbmSearchGraphTool },
    { name: 'cbm_trace', build: buildCbmTraceTool },
    { name: 'cbm_code', build: buildCbmCodeTool },
    { name: 'cbm_query', build: buildCbmQueryTool },
    { name: 'cbm_detect_changes', build: buildCbmDetectChangesTool },
  ];

  return builders
    .filter(({ name }) => isToolEnabled(config, name))
    .map(({ name, build }) => build(ctx, config, env));
}
