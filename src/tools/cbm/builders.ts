import type { IndexerHandle, IndexerRunCli } from '../../cbm/indexer';
import { getToolConfig } from '../../config/utils';
import type { PluginConfig } from '../../config/schema';
import { resolveWorkspaceRoot } from '../../runtime/workspace';
import type {
  ToolContextLike,
  ToolDefinition,
  ToolResult,
  ToolingContext,
} from '../../runtime/types';
import {
  DEFAULT_TIMEOUT_MS,
  DETECT_CHANGES_TOOL,
  GET_CODE_SNIPPET_TOOL,
  INDEX_REPOSITORY_TOOL,
  INDEX_STATUS_TOOL,
  QUERY_GRAPH_TOOL,
  SEARCH_GRAPH_TOOL,
  TRACE_PATH_TOOL,
  type CbmCliResult,
  type CbmExecOptions,
  type CbmRunDeps,
} from './types';

/**
 * codebase-memory-mcp（CBM）CLI 兜底工具 builders（CBM-09）。
 *
 * 通过 `ctx.tool.transform` 注册 `cbm_status / cbm_index / cbm_search_graph /
 * cbm_trace / cbm_code / cbm_query / cbm_detect_changes`：
 * - `cbm_status` 不触发索引；`cbm_index` 显式触发索引（独立较长超时）；
 * - 查询型工具经共享 indexer 做首次状态检查（尊重 codebaseMemory.autoIndex）；
 * - 所有路径/参数经 workspace root 解析与 schema 校验；
 * - `cbm_trace` 映射 canonical `trace_path`（旧版本 alias 由 CLI 层回退）；
 * - `cbm_query` 只允许只读 Cypher 子集，拒绝写入型语句；
 * - 一律返回结构化 JSON（错误放入 `error`），不抛异常。
 *
 * 执行全部通过 {@link CbmToolEnv} 注入 `run` / indexer / 二进制 / 环境，
 * 测试可用 fake runCli 与 stub indexer 驱动，不依赖真实二进制。
 */

/** CBM 工具 builders 共享的执行环境（测试可注入）。 */
export interface CbmToolEnv {
  /** 实际执行 CLI 的函数（默认 runCbmCli，测试注入 fake）。 */
  run: IndexerRunCli;
  /** CLI 执行依赖（spawn / resolveBinary / ensureInstalled 等）。 */
  runDeps?: CbmRunDeps;
  /** 共享索引器：查询前首次状态检查（尊重 autoIndex）。 */
  indexer: IndexerHandle;
  /** 显式二进制路径（透传给 CLI 调用）。 */
  binaryPath?: string;
  /** 环境白名单覆盖（如 CBM_CACHE_DIR）。 */
  env?: Record<string, string | undefined>;
  /** 默认自动索引开关。 */
  autoIndex: boolean;
  /** 共享缓存根目录。 */
  cacheRoot?: string;
}

/** cbm_* 工具 canonical 名称。 */
export const CBM_TOOL_NAMES = [
  'cbm_status',
  'cbm_index',
  'cbm_search_graph',
  'cbm_trace',
  'cbm_code',
  'cbm_query',
  'cbm_detect_changes',
] as const;
export type CbmToolName = (typeof CBM_TOOL_NAMES)[number];

/** 全量 cbm_index 的独立较长超时（10 分钟）。 */
const CBM_INDEX_TIMEOUT_MS = 600_000;

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const asNumber = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

function defineTool(def: {
  name: string;
  description: string;
  input: Record<string, unknown>;
  execute(input: any, context: ToolContextLike): Promise<ToolResult>;
}): ToolDefinition {
  return {
    name: def.name,
    description: def.description,
    input: def.input,
    execute: def.execute,
  } as ToolDefinition;
}

function contentResult(obj: unknown): ToolResult {
  return { content: JSON.stringify(obj, null, 2) };
}
function errorResult(message: string): ToolResult {
  return contentResult({ error: message });
}

/** 将 CLI 结果归一化为结构化 ToolResult；错误放入 error 并保留错误码。 */
function cbmResult(result: CbmCliResult): ToolResult {
  if (result.ok) return contentResult(result.data ?? { ok: true, tool: result.tool });
  const body: Record<string, unknown> = {
    error: result.error?.message ?? 'CBM 调用失败',
  };
  if (result.error?.code) body.code = result.error.code;
  if (result.error?.exitCode !== undefined) body.exitCode = result.error.exitCode;
  if (result.truncated) body.truncated = true;
  if (result.truncatedReason) body.truncatedReason = result.truncatedReason;
  return contentResult(body);
}

/** 提取字符串字面量，避免只读 Cypher 检测把字符串内的关键词误判为写入。 */
function stripCypherStrings(query: string): string {
  return query
    .replace(/'[^']*'/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/`[^`]*`/g, ' ');
}

/** 是否含写入型 Cypher 语句（CREATE / MERGE / DELETE / DETACH / SET / REMOVE / FOREACH）。 */
export function isWriteCypher(query: string): boolean {
  const stripped = stripCypherStrings(query);
  return /\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|FOREACH)\b/i.test(stripped);
}

/** 组装 CLI 执行参数：合并工具级配置（timeoutMs / maxOutputBytes）与传入覆盖。 */
function execOpts(
  env: CbmToolEnv,
  config: PluginConfig,
  toolName: string,
  tool: string,
  args: Record<string, unknown>,
  root: string,
  extra?: Partial<CbmExecOptions>,
): CbmExecOptions {
  const cfg = getToolConfig(config, toolName);
  return {
    tool,
    args,
    workspaceRoot: root,
    binaryPath: env.binaryPath,
    env: { ...(env.env ?? {}), ...(env.cacheRoot ? { CBM_CACHE_DIR: env.cacheRoot } : {}) },
    timeoutMs: extra?.timeoutMs ?? cfg?.timeoutMs,
    maxOutputBytes: cfg?.maxOutputBytes,
    ...extra,
    ...(env.cacheRoot ? { cacheRoot: env.cacheRoot, env: { ...(extra?.env ?? {}), CBM_CACHE_DIR: env.cacheRoot } } : {}),
  };
}

/** 解析当前会话 workspace root；失败返回 null（调用方转为结构化错误）。 */
async function rootOf(
  wctx: ToolingContext,
  tctx: ToolContextLike,
): Promise<string | null> {
  return resolveWorkspaceRoot(wctx.session, tctx.sessionID);
}

/** 查询前经 indexer 做首次状态检查；不满足时返回禁止执行的提示，允许回退原生工具。 */
async function guardForQuery(
  env: CbmToolEnv,
  root: string,
  timeoutMs: number,
): Promise<{ allow: boolean; message?: string }> {
  const outcome = await env.indexer.ensureIndexed(root, {
    workspaceRoot: root,
    timeoutMs,
    autoIndex: env.autoIndex,
  });
  if (outcome.kind === 'indexed' || outcome.kind === 'index_started' || outcome.kind === 'indexing') {
    return { allow: true };
  }
  if (outcome.kind === 'degraded') {
    const code = outcome.errorCode ? `:${outcome.errorCode}` : '';
    return {
      allow: false,
      message: `CBM 索引检查失败（${outcome.reason}${code}）。${outcome.message ?? ''} 可回退 grep/read。`,
    };
  }
  if (outcome.kind === 'skipped_auto_index_disabled') {
    return {
      allow: false,
      message: 'CBM 自动索引已关闭（codebaseMemory.autoIndex=false）。如需结构化查询请先运行 cbm_index。',
    };
  }
  return { allow: false, message: '无法确认 CBM 项目索引状态，可回退 grep/read。' };
}

/** 查询型工具的公共执行路径：indexer 门控 → CLI → 结构化结果。 */
async function runQuery(
  env: CbmToolEnv,
  root: string,
  opts: CbmExecOptions,
): Promise<ToolResult> {
  const guard = await guardForQuery(env, root, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (!guard.allow) return errorResult(guard.message ?? 'CBM 索引状态不满足查询条件');
  const result = await env.run(opts, env.runDeps);
  return cbmResult(result);
}

// ─────────────────────────── 各工具 builder ───────────────────────────

export function buildCbmStatusTool(
  wctx: ToolingContext,
  config: PluginConfig,
  env: CbmToolEnv,
): ToolDefinition {
  return defineTool({
    name: 'cbm_status',
    description:
      '查询 codebase-memory 当前项目的索引状态。不触发索引，仅报告状态。',
    input: { type: 'object', properties: {} },
    async execute(_input, tctx) {
      const root = await rootOf(wctx, tctx);
      if (!root) return errorResult('无法解析当前会话的工作区根目录');
      const opts = execOpts(env, config, 'cbm_status', INDEX_STATUS_TOOL, { project_path: root }, root);
      const result = await env.run(opts, env.runDeps);
      return cbmResult(result);
    },
  });
}

export function buildCbmIndexTool(
  wctx: ToolingContext,
  config: PluginConfig,
  env: CbmToolEnv,
): ToolDefinition {
  return defineTool({
    name: 'cbm_index',
    description:
      '显式触发 codebase-memory 对当前项目建索引。使用独立较长超时，返回进行中/完成状态。',
    input: { type: 'object', properties: {} },
    async execute(_input, tctx) {
      const root = await rootOf(wctx, tctx);
      if (!root) return errorResult('无法解析当前会话的工作区根目录');
      const cfg = getToolConfig(config, 'cbm_index');
      const opts = execOpts(
        env,
        config,
        'cbm_index',
        INDEX_REPOSITORY_TOOL,
        { repository_path: root },
        root,
        { timeoutMs: cfg?.timeoutMs ?? CBM_INDEX_TIMEOUT_MS },
      );
      const result = await env.run(opts, env.runDeps);
      return cbmResult(result);
    },
  });
}

export function buildCbmSearchGraphTool(
  wctx: ToolingContext,
  config: PluginConfig,
  env: CbmToolEnv,
): ToolDefinition {
  return defineTool({
    name: 'cbm_search_graph',
    description:
      '按名称/正则模式在代码知识图谱中定位函数、类、方法、接口与模块。返回结构化匹配。',
    input: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '名称或正则模式，如 ".*OrderHandler.*"' },
        limit: { type: 'number', description: '返回结果上限' },
      },
      required: ['query'],
    },
    async execute(input, tctx) {
      const query = asString(input?.query);
      if (!query) return errorResult('query 必填');
      const root = await rootOf(wctx, tctx);
      if (!root) return errorResult('无法解析当前会话的工作区根目录');
      const args: Record<string, unknown> = { query };
      const limit = asNumber(input?.limit);
      if (limit !== undefined) args.limit = limit;
      const opts = execOpts(env, config, 'cbm_search_graph', SEARCH_GRAPH_TOOL, args, root);
      return runQuery(env, root, opts);
    },
  });
}

export function buildCbmTraceTool(
  wctx: ToolingContext,
  config: PluginConfig,
  env: CbmToolEnv,
): ToolDefinition {
  return defineTool({
    name: 'cbm_trace',
    description:
      '追踪符号的调用链（inbound 谁调用它 / outbound 它调用谁）。映射 canonical trace_path，旧版本二进制自动回退 trace_call_path。',
    input: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: '符号名（函数/类等）' },
        direction: { type: 'string', enum: ['inbound', 'outbound'], description: '追踪方向' },
      },
      required: ['symbol'],
    },
    async execute(input, tctx) {
      const symbol = asString(input?.symbol);
      if (!symbol) return errorResult('symbol 必填');
      const direction = asString(input?.direction);
      if (direction !== undefined && direction !== 'inbound' && direction !== 'outbound') {
        return errorResult('direction 必须是 inbound 或 outbound');
      }
      const root = await rootOf(wctx, tctx);
      if (!root) return errorResult('无法解析当前会话的工作区根目录');
      const args: Record<string, unknown> = { function_name: symbol };
      if (direction) args.direction = direction;
      const opts = execOpts(env, config, 'cbm_trace', TRACE_PATH_TOOL, args, root);
      return runQuery(env, root, opts);
    },
  });
}

export function buildCbmCodeTool(
  wctx: ToolingContext,
  config: PluginConfig,
  env: CbmToolEnv,
): ToolDefinition {
  return defineTool({
    name: 'cbm_code',
    description: '读取指定 qualified name 对应的源码片段（get_code_snippet）。',
    input: {
      type: 'object',
      properties: {
        qualified_name: { type: 'string', description: '符号的 qualified name，如 "pkg/orders.OrderHandler"' },
      },
      required: ['qualified_name'],
    },
    async execute(input, tctx) {
      const qualifiedName = asString(input?.qualified_name) ?? asString(input?.name);
      if (!qualifiedName) return errorResult('qualified_name 必填');
      const root = await rootOf(wctx, tctx);
      if (!root) return errorResult('无法解析当前会话的工作区根目录');
      const opts = execOpts(
        env,
        config,
        'cbm_code',
        GET_CODE_SNIPPET_TOOL,
        { qualified_name: qualifiedName },
        root,
      );
      return runQuery(env, root, opts);
    },
  });
}

export function buildCbmQueryTool(
  wctx: ToolingContext,
  config: PluginConfig,
  env: CbmToolEnv,
): ToolDefinition {
  return defineTool({
    name: 'cbm_query',
    description:
      '对代码知识图谱执行只读 Cypher 查询。拒绝写入型语句（CREATE/MERGE/DELETE/DETACH/SET/REMOVE/FOREACH）。',
    input: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '只读 Cypher 查询' },
      },
      required: ['query'],
    },
    async execute(input, tctx) {
      const query = asString(input?.query);
      if (!query) return errorResult('query 必填');
      if (isWriteCypher(query)) {
        return errorResult('cbm_query 只允许只读 Cypher 查询，检测到写入型语句（CREATE/MERGE/DELETE/DETACH/SET/REMOVE/FOREACH）。');
      }
      const root = await rootOf(wctx, tctx);
      if (!root) return errorResult('无法解析当前会话的工作区根目录');
      const opts = execOpts(env, config, 'cbm_query', QUERY_GRAPH_TOOL, { query }, root);
      return runQuery(env, root, opts);
    },
  });
}

export function buildCbmDetectChangesTool(
  wctx: ToolingContext,
  config: PluginConfig,
  env: CbmToolEnv,
): ToolDefinition {
  return defineTool({
    name: 'cbm_detect_changes',
    description: '检测项目变更/影响面（detect_changes），返回变更文件与结构。',
    input: {
      type: 'object',
      properties: {
        since: { type: 'string', description: '变更起始参照（如 commit / 时间）' },
        repository_path: { type: 'string', description: '可选；必须位于工作区内' },
      },
    },
    async execute(input, tctx) {
      const root = await rootOf(wctx, tctx);
      if (!root) return errorResult('无法解析当前会话的工作区根目录');
      const args: Record<string, unknown> = {};
      const since = asString(input?.since);
      if (since) args.since = since;
      const repositoryPath = asString(input?.repository_path);
      if (repositoryPath) args.repository_path = repositoryPath;
      const opts = execOpts(
        env,
        config,
        'cbm_detect_changes',
        DETECT_CHANGES_TOOL,
        args,
        root,
      );
      return runQuery(env, root, opts);
    },
  });
}
