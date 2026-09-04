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
export const WRITABLE_FILE_OPERATIONS_RULES = `**文件操作规则**：
- 工具来源：read/grep/glob/list/lsp/codesearch/webfetch/websearch 是宿主提供的工具——按照当前会话工具目录直接按名称调用；绝不能通过 Code Mode \`execute\` 代理调用，也绝不能臆造目录中不存在的工具名。文本/正则搜索使用 \`grep\`；不存在通用的 \`search\` 工具。
 - 常规代码工作优先使用专用文件工具：用 glob/grep/ast_grep_search 进行发现，用 read 读取文件内容，用 edit/write/apply_patch 进行有针对性的源代码修改。
- 新增或修改文件必须遵循目标项目现有的格式与语言规范，适用于代码、文档及其他文件类型；不得为了节省行数而压缩内容。
- 使用 bash 执行自动化操作：git、包管理器、测试、构建、脚本、诊断及 shell 原生文件系统操作。
- 批量或机械文件变更在比逐项编辑更清晰或安全时可以使用 Shell（例如截断生成日志、移除构建产物、批量重命名/移动），尤其是用户明确要求该 Shell 操作时。
- 进行破坏性或大范围 Shell 操作前，核实目标集合并引用路径；可行时优先先做 dry-run/列举。
- 不要仅为读取代码而使用 cat/head/tail/sed/awk；使用 read/grep，除非 Shell 管道确实更适合诊断。`;

/** 只读 agent（explorer/librarian/oracle/observer）的文件操作规则 */
export const READONLY_FILE_OPERATIONS_RULES = `**文件操作规则**：
- 工具来源：read/grep/glob/list/lsp/codesearch/webfetch/websearch 是宿主提供的工具——按照当前会话工具目录直接按名称调用；绝不能通过 Code Mode \`execute\` 代理调用，也绝不能臆造目录中不存在的工具名。文本/正则搜索使用 \`grep\`；不存在通用的 \`search\` 工具。
 - 只读：检查并报告；不要修改文件。
 - 代码库检查优先使用专用文件工具：用 glob/grep/ast_grep_search 进行发现，用 read 读取文件内容。
- 当 bash 最清晰时，允许用它执行不修改文件的诊断和 shell 原生检查，但不得用于修改文件。
- 不要仅为读取代码而使用 cat/head/tail/sed/awk；使用 read/grep，除非 Shell 管道确实更适合诊断。`;

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
 * - deny：subagent/edit/write/apply_patch/ast_grep_replace/todowrite/clipboard_image
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
 * 文件编辑走宿主原生 edit / write / apply_patch（原生 diff 渲染与模型心智），
 * ast_grep_replace 显式 allow（默认 dry-run 预览，显式 dryRun:false 才写入）。
 * 其他 action 不在此声明：注册层（applyAgentDefinitions）以 merge 语义追加本表。
 */
export const WRITER_TOOL_PERMISSION: NonNullable<
  AgentOverrideConfig['permission']
> = {
  ast_grep_replace: 'allow',
};
