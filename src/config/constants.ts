import type { AgentOverrideConfig } from './schema';

// Agent 名称
export const AGENT_ALIASES: Record<string, string> = {
  explore: 'explorer',
  'frontend-ui-ux-engineer': 'designer',
};

/** 主 agent（oceanus + sisyphus）+ 子 agent */
export const SUBAGENT_NAMES = [
  'explorer',
  'librarian',
  'oracle',
  'designer',
  'fixer',
  'observer',
  'metis',
  'momus',
] as const;

export const ALL_AGENT_NAMES = [
  'oceanus',
  'sisyphus',
  ...SUBAGENT_NAMES,
] as const;

export type AgentName = (typeof ALL_AGENT_NAMES)[number];

/** 不可被 disabled 的 agent */
export const PROTECTED_AGENTS = new Set(['oceanus']);

/**
 * 各 agent 默认模型。全部为 undefined，表示跟随当前会话模型；
 * 用户可通过 opencode-oceanus 配置文件 agents.<name>.model 单独指定。
 */
export const DEFAULT_MODELS: Record<AgentName, string | undefined> = {
  oceanus: undefined,
  sisyphus: undefined,
  oracle: undefined,
  librarian: undefined,
  explorer: undefined,
  designer: undefined,
  fixer: undefined,
  observer: undefined,
  metis: undefined,
  momus: undefined,
};

/** 写权限 agent（designer/fixer）的文件操作规则 */
export const WRITABLE_FILE_OPERATIONS_RULES = `**File Operations Rules**:
- Prefer dedicated file tools for normal code work: glob/grep/ast_grep_search for discovery, read for file contents, and edit/write/apply_patch for targeted source changes.
- Use bash for execution and automation: git, package managers, tests, builds, scripts, diagnostics, and shell-native filesystem operations.
- Shell is acceptable for bulk or mechanical filesystem changes when it is clearer or safer than many individual edits (for example: truncate generated logs, remove build artifacts, batch rename/move files), especially when the user explicitly asks for that shell operation.
- Before destructive or broad shell operations, verify the target set and quote paths. Prefer a dry-run/listing first when practical.
- Do not use cat/head/tail/sed/awk only to read code into context; use read/grep unless a shell pipeline is genuinely the better diagnostic.`;

/** 只读 agent（explorer/librarian/oracle/observer）的文件操作规则 */
export const READONLY_FILE_OPERATIONS_RULES = `**File Operations Rules**:
- READ-ONLY: inspect and report; do not modify files.
- Prefer dedicated file tools for codebase inspection: glob/grep/ast_grep_search for discovery and read for file contents.
- Bash is allowed for non-mutating diagnostics and shell-native inspection when it is the clearest tool, but not for modifying files.
- Do not use cat/head/tail/sed/awk only to read code into context; use read/grep unless a shell pipeline is genuinely the better diagnostic.`;

/** 默认禁用的 agent（observer 需要视觉模型，默认关闭） */
export const DEFAULT_DISABLED_AGENTS: string[] = ['observer'];

/**
 * 默认只读 agent 集合。这些 agent 在无显式 agents.<name>.permission 时
 * 会集中获得 READONLY_DEFAULT_PERMISSION，保证只读不写入、不委派、不执行 task。
 */
export const READONLY_AGENTS: ReadonlySet<string> = new Set([
  'explorer',
  'librarian',
  'oracle',
  'observer',
  'metis',
  'momus',
]);

/**
 * 只读 agent 的默认 permission：
 * - allow：read/glob/grep/list/lsp/codesearch/webfetch/websearch
 * - deny：bash/edit/write/apply_patch/ast_grep_replace/hashline_edit/task/todowrite（写入与执行相关动作）
 * 显式 agents.<name>.permission 始终覆盖此默认值。
 */
export const READONLY_DEFAULT_PERMISSION: NonNullable<
  AgentOverrideConfig['permission']
> = {
  read: 'allow',
  glob: 'allow',
  grep: 'allow',
  list: 'allow',
  lsp: 'allow',
  codesearch: 'allow',
  webfetch: 'allow',
  websearch: 'allow',
  bash: 'deny',
  edit: 'deny',
  write: 'deny',
  apply_patch: 'deny',
  ast_grep_replace: 'deny',
  hashline_edit: 'deny',
  task: 'deny',
  todowrite: 'deny',
};
