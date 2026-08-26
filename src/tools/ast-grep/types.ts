/**
 * AST-grep 核心的共享类型定义。
 *
 * 本模块刻意不依赖 `@opencode-ai/plugin`，只暴露纯 TS 的类型与常量，
 * 供原生 v2 Tool wiring（Wave 2 的 index.ts）直接消费。
 */

/** ast-grep CLI 支持的语言（共 25 种）。 */
export const CLI_LANGUAGES = [
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'elixir',
  'go',
  'haskell',
  'html',
  'java',
  'javascript',
  'json',
  'kotlin',
  'lua',
  'nix',
  'php',
  'python',
  'ruby',
  'rust',
  'scala',
  'solidity',
  'swift',
  'typescript',
  'tsx',
  'yaml',
] as const;

export type CliLanguage = (typeof CLI_LANGUAGES)[number];

/** 结果被截断的原因。 */
export type TruncationReason = 'timeout' | 'max_output_bytes' | 'max_matches';

export interface CliRange {
  byteOffset: { start: number; end: number };
  start: { line: number; column: number };
  end: { line: number; column: number };
}

/** ast-grep `--json=compact` 单条匹配的结构。 */
export interface CliMatch {
  file: string;
  range: CliRange;
  lines: string;
  text: string;
  /** 仅当带 `-r rewrite` 时存在。 */
  replacement?: string;
  language: string;
}

/** 一次搜索/替换的统一返回结构。错误一律放入 `error`，不抛异常。 */
export interface SgResult {
  matches: CliMatch[];
  totalMatches: number;
  truncated: boolean;
  truncatedReason?: TruncationReason;
  error?: string;
}

/** 搜索参数模型。 */
export interface SearchOptions {
  /** AST pattern，支持 $VAR / $$$ 元变量。 */
  pattern: string;
  /** 目标语言。 */
  lang: CliLanguage;
  /** 要搜索的路径（默认 [' . ']，即工作区根）。必须位于 workspaceRoot 内。 */
  paths?: string[];
  /** include/exclude glob（以 ! 前缀排除）。 */
  globs?: string[];
  /** 匹配上下文行数。 */
  context?: number;
  /** 工作区根目录，用于路径边界校验与 spawn 的 cwd。 */
  workspaceRoot?: string;
  /** 进程超时（毫秒）。默认 {@link DEFAULT_TIMEOUT_MS}。 */
  timeoutMs?: number;
  /** 最大返回匹配数。默认 {@link DEFAULT_MAX_MATCHES}。 */
  maxMatches?: number;
  /** 最大输出字节数。默认 {@link DEFAULT_MAX_OUTPUT_BYTES}。 */
  maxOutputBytes?: number;
}

/** 替换参数模型。 */
export interface ReplaceOptions extends SearchOptions {
  /** 替换模板，可使用 pattern 中的 $VAR。 */
  rewrite: string;
  /** 默认 true（仅预览不写入）。为 false 时才真正改写文件。 */
  dryRun?: boolean;
}
