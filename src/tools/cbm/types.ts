import type { SpawnFn } from '../../cbm/process';

/**
 * codebase-memory-mcp（CBM）CLI 兜底执行器的共享类型定义。
 *
 * 本模块刻意不依赖 `@opencode-ai/plugin`，只暴露纯 TS 的类型与常量，
 * 供 Wave 2 的 `ctx.tool.transform` 接线（tools/index.ts）直接消费。
 *
 * CBM-03：为 `cli <tool> <json>` 提供安全、可测试的执行器契约：
 *   - 工具名、错误码、结构化结果；
 *   - 二进制解析优先级 binaryPath→缓存→PATH；
 *   - 预留 ensureInstalled / indexer 注入接口，多个调用共享安装 Promise。
 */

/** canonical 工具名常量。 */
export const SEARCH_GRAPH_TOOL = 'search_graph';
export const TRACE_PATH_TOOL = 'trace_path';
export const TRACE_CALL_PATH_TOOL = 'trace_call_path'; // 旧版本 alias
export const GET_CODE_SNIPPET_TOOL = 'get_code_snippet';
export const QUERY_GRAPH_TOOL = 'query_graph';
export const DETECT_CHANGES_TOOL = 'detect_changes';
export const LIST_PROJECTS_TOOL = 'list_projects';
export const INDEX_STATUS_TOOL = 'index_status';
export const INDEX_REPOSITORY_TOOL = 'index_repository';

/** 支持的 CBM 工具名（含旧版本 trace_call_path alias）。 */
export type CbmToolName =
  | typeof SEARCH_GRAPH_TOOL
  | typeof TRACE_PATH_TOOL
  | typeof TRACE_CALL_PATH_TOOL
  | typeof GET_CODE_SNIPPET_TOOL
  | typeof QUERY_GRAPH_TOOL
  | typeof DETECT_CHANGES_TOOL
  | typeof LIST_PROJECTS_TOOL
  | typeof INDEX_STATUS_TOOL
  | typeof INDEX_REPOSITORY_TOOL;

/** CLI 执行的结构化错误码。 */
export type CbmCliErrorCode =
  | 'binary_missing'
  | 'workspace_boundary'
  | 'timeout'
  | 'exit_nonzero'
  | 'invalid_json'
  | 'output_oversize'
  | 'spawn_failed'
  | 'internal_error';

/** 结构化错误：区分二进制缺失 / 越界 / 超时 / 退出码 / 非 JSON / 超大输出 / spawn 失败。 */
export interface CbmCliError {
  code: CbmCliErrorCode;
  message: string;
  /** 原始 stderr（仅供诊断，不直接当作成功结果）。 */
  stderr?: string;
  /** 非零退出码（仅 exit_nonzero）。 */
  exitCode?: number;
}

/** 一次 CLI 调用的统一返回结构。错误一律放入 `error`，不抛异常。 */
export interface CbmCliResult {
  ok: boolean;
  /** 实际使用的工具名（trace_call_path 归一化为 trace_path；回退后为 trace_call_path）。 */
  tool: string;
  /** 解析后的 JSON 结果（仅 ok 时可靠）。 */
  data: unknown;
  error?: CbmCliError;
  truncated?: boolean;
  truncatedReason?: 'timeout' | 'max_output_bytes';
}

/** `cli <tool> <json>` 执行参数。 */
export interface CbmExecOptions {
  /** 工具名。trace_path 为 canonical；trace_call_path 兼容旧版本。 */
  tool: string;
  /** 传给 CLI 的 JSON 参数（对象，执行时 JSON.stringify）。 */
  args: unknown;
  /** 显式配置的二进制路径，最高优先级（解析顺序 binaryPath→缓存→PATH）。 */
  binaryPath?: string;
  /** 工作区根目录，默认 process.cwd()，用于路径越界校验与 spawn 的 cwd。 */
  workspaceRoot?: string;
  /** 项目路径参数（如 index_repository 的 repository_path）；越界会被拒绝。 */
  projectPath?: string;
  /** 进程超时（毫秒），默认 {@link DEFAULT_TIMEOUT_MS}。 */
  timeoutMs?: number;
  /** 最大输出字节数，默认 {@link DEFAULT_MAX_OUTPUT_BYTES}。 */
  maxOutputBytes?: number;
  /** 额外环境变量（白名单基础上覆盖，如 CBM_CACHE_DIR）。token 会被剥离。 */
  env?: Record<string, string | undefined>;
  /** 查询前是否自动索引（预留；需注入 indexer 才生效）。 */
  autoIndex?: boolean;
  /** 共享缓存根目录。 */
  cacheRoot?: string;
}

/** 预留的索引器注入接口：项目未索引时自动索引。 */
export interface CbmIndexer {
  ensureIndexed(
    projectPath: string | undefined,
    opts: { workspaceRoot: string; timeoutMs: number },
  ): Promise<unknown>;
}

/** runCbmCli 的可注入依赖，便于测试替换 spawn / 二进制解析 / 安装 / 索引。 */
export interface CbmRunDeps {
  spawn?: SpawnFn;
  /** 同步解析二进制（binaryPath→缓存→PATH）；返回 null 表示未找到。 */
  resolveBinary?: (opts: { binaryPath?: string; cacheRoot?: string }) => string | null;
  /**
   * 预留：安装钩子。返回安装完成后可用的二进制路径（Promise<string | null>）。
   * 上层必须传入**共享**的安装 Promise，使多个并发/后续调用复用同一次安装。
   */
  ensureInstalled?: () => Promise<string | null>;
  /** 预留：索引器注入，查询前按需触发索引。 */
  indexer?: CbmIndexer;
}

/** 默认进程超时：120 秒。 */
export const DEFAULT_TIMEOUT_MS = 120_000;

/** 默认输出字节上限：4 MB。 */
export const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/** CBM 缓存目录环境变量名（MCP 与 CLI 共用同一 canonical 缓存）。 */
export const CBM_CACHE_DIR_ENV = 'CBM_CACHE_DIR';

/**
 * 子进程环境变量白名单：只继承白名单项，**不继承 provider token**。
 * 额外叠加调用方显式覆盖（如 CBM_CACHE_DIR）；敏感键会被剥离。
 */
export const CBM_ENV_WHITELIST: readonly string[] = [
  CBM_CACHE_DIR_ENV,
  'RUST_LOG',
  'RUST_BACKTRACE',
  'NO_COLOR',
  'CLICOLOR',
  'TERM',
  'HOME',
  'USER',
  'USERNAME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'XDG_CACHE_HOME',
  'LOCALAPPDATA',
  'APPDATA',
  'PATH',
];
