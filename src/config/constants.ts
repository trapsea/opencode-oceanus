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
- Tool sources: read/grep/glob/list/lsp/codesearch/webfetch/websearch are host-provided tools — call them directly by name per the current session tool catalog; never call them through a Code Mode \`execute\` proxy and never invent tool names not present in the catalog. Use \`grep\` for text/regex search; there is no generic \`search\` tool.
- Prefer dedicated file tools for normal code work: glob/grep/ast_grep_search for discovery, read for file contents, and edit/write/apply_patch for targeted source changes.
- Use bash for execution and automation: git, package managers, tests, builds, scripts, diagnostics, and shell-native filesystem operations.
- Shell is acceptable for bulk or mechanical filesystem changes when it is clearer or safer than many individual edits (for example: truncate generated logs, remove build artifacts, batch rename/move files), especially when the user explicitly asks for that shell operation.
- Before destructive or broad shell operations, verify the target set and quote paths. Prefer a dry-run/listing first when practical.
- Do not use cat/head/tail/sed/awk only to read code into context; use read/grep unless a shell pipeline is genuinely the better diagnostic.`;

/** 只读 agent（explorer/librarian/oracle/observer）的文件操作规则 */
export const READONLY_FILE_OPERATIONS_RULES = `**File Operations Rules**:
- Tool sources: read/grep/glob/list/lsp/codesearch/webfetch/websearch are host-provided tools — call them directly by name per the current session tool catalog; never call them through a Code Mode \`execute\` proxy and never invent tool names not present in the catalog. Use \`grep\` for text/regex search; there is no generic \`search\` tool.
- READ-ONLY: inspect and report; do not modify files.
- Prefer dedicated file tools for codebase inspection: glob/grep/ast_grep_search for discovery and read for file contents.
- Bash is allowed for non-mutating diagnostics and shell-native inspection when it is the clearest tool, but not for modifying files.
- Do not use cat/head/tail/sed/awk only to read code into context; use read/grep unless a shell pipeline is genuinely the better diagnostic.`;

/** 只读 agent 的 shell 规则：默认允许检查，按命令模式拦截明显写操作。 */
export const READONLY_SHELL_PERMISSION: Record<string, 'allow' | 'deny'> = {
  '*': 'allow',
  'rm *': 'deny',
  'rmdir *': 'deny',
  'mv *': 'deny',
  'cp *': 'deny',
  'touch *': 'deny',
  'mkdir *': 'deny',
  'ln *': 'deny',
  'chmod *': 'deny',
  'chown *': 'deny',
  'tee *': 'deny',
  '*tee *': 'deny',
  'sed -i*': 'deny',
  'perl -i*': 'deny',
  'git add *': 'deny',
  'git commit *': 'deny',
  'git push *': 'deny',
  'git pull *': 'deny',
  'git fetch *': 'deny',
  'git checkout *': 'deny',
  'git reset *': 'deny',
  'git restore *': 'deny',
  'git clean *': 'deny',
  'git merge *': 'deny',
  'git rebase *': 'deny',
  'npm install*': 'deny',
  'npm add *': 'deny',
  'npm remove *': 'deny',
  'npm update*': 'deny',
  'yarn install*': 'deny',
  'yarn add *': 'deny',
  'yarn remove *': 'deny',
  'yarn update*': 'deny',
  'pnpm install*': 'deny',
  'pnpm add *': 'deny',
  'pnpm remove *': 'deny',
  'pnpm update*': 'deny',
  'bun install*': 'deny',
  'bun add *': 'deny',
  'bun remove *': 'deny',
  'bun update*': 'deny',
  '* > *': 'deny',
  '* >> *': 'deny',
  '* | tee *': 'deny',
};

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
 * - allow：read/glob/grep/list/lsp/codesearch/webfetch/websearch/ast_grep_search
 *   以及查询型 codebase-memory 工具
 * - shell：默认允许非修改命令，并按 READONLY_SHELL_PERMISSION 拒绝常见写入模式
 * - deny：subagent/edit/write/apply_patch/ast_grep_replace/hashline_edit/todowrite/clipboard_image
 *   （写入、委派动作与系统剪贴板读取）
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
  ast_grep_search: 'allow',
  cbm_status: 'allow',
  cbm_index: 'deny',
  cbm_search_graph: 'allow',
  cbm_trace: 'allow',
  cbm_code: 'allow',
  cbm_query: 'allow',
  cbm_detect_changes: 'allow',
  shell: READONLY_SHELL_PERMISSION,
  task: 'deny',
  subagent: 'deny',
  edit: 'deny',
  write: 'deny',
  apply_patch: 'deny',
  ast_grep_replace: 'deny',
  hashline_edit: 'deny',
  todowrite: 'deny',
  // 剪贴板可能包含与当前任务无关的敏感内容；只允许主编排 agent 按需处理。
  clipboard_image: 'deny',
};

/** Metis 的只读权限：方案分析仅允许查询，索引初始化由 Intake 主流程负责。 */
export const METIS_DEFAULT_PERMISSION: NonNullable<
  AgentOverrideConfig['permission']
> = {
  ...READONLY_DEFAULT_PERMISSION,
  cbm_index: 'deny',
};

/**
 * 写入 subagent（fixer/designer）的工具族 permission：
 * - 宿主 edit / write / apply_patch 三个写入工具共用 permission action "edit"
 *   （宿主二进制实证），`edit: 'deny'` 使三者经 Tool.snapshot 从该 agent 的
 *   工具目录整体移除——写入只剩 hashline_edit / ast_grep_replace 两条
 *   受锚点/预览保护的通道（hashline_edit 支持新建文件、批量编辑、
 *   删除与重命名，能力无损）。
 * - `hashline_edit` / `ast_grep_replace` 显式 allow：二者 action 为工具名，
 *   显式 allow 避免落入宿主 permission 默认 ask 而 auto 批准的不确定路径。
 * - 其他 action 不在此声明：注册层（applyAgentDefinitions）以 merge 语义
 *   追加本表，宿主 Agent.Info 默认基线（`*:* allow` + .env/外部目录 ask
 *   特例）保持生效。
 */
export const WRITER_TOOL_PERMISSION: NonNullable<
  AgentOverrideConfig['permission']
> = {
  edit: 'deny',
  hashline_edit: 'allow',
  ast_grep_replace: 'allow',
};

/** 写入策略：hashline（默认，锚定通道锁定）| host（宿主原生工具放开）。 */
export type EditStrategy = 'hashline' | 'host';

/**
 * editing.strategy = "host" 时写入 subagent（fixer/designer）的 permission：
 * 不声明 action "edit"（宿主 edit/write/apply_patch 保留在工具目录），
 * hashline_edit / ast_grep_replace 显式 allow（可用但不强制）。
 * 显式 agents.<name>.permission 始终覆盖此默认值。
 */
export const HOST_WRITER_TOOL_PERMISSION: NonNullable<
  AgentOverrideConfig['permission']
> = {
  hashline_edit: 'allow',
  ast_grep_replace: 'allow',
};

/** 按写入策略解析 writer subagent 的默认 permission。 */
export function writerPermissionFor(strategy: EditStrategy = 'hashline') {
  return strategy === 'host'
    ? HOST_WRITER_TOOL_PERMISSION
    : WRITER_TOOL_PERMISSION;
}
