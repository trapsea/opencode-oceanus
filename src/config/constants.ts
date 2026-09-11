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
] as const;

export const ALL_AGENT_NAMES = [
  'oceanus',
  'sisyphus',
  'prometheus',
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
  prometheus: undefined,
  oracle: undefined,
  librarian: undefined,
  explorer: undefined,
  designer: undefined,
  fixer: undefined,
  observer: undefined,
};

/** 写权限 agent（designer/fixer）的文件操作规则 */
export const WRITABLE_FILE_OPERATIONS_RULES = `**文件操作规则**：
- 工具来源：read/grep/glob/list/lsp/codesearch/webfetch/websearch 是宿主提供的工具——按照当前会话工具目录直接按名称调用；绝不能通过 Code Mode \`execute\` 代理调用，也绝不能臆造目录中不存在的工具名。文本/正则搜索使用 \`grep\`；不存在通用的 \`search\` 工具。
 - 常规代码工作优先使用专用文件工具：用 glob/grep/ast_grep_search 进行发现，用 read 读取文件内容，用 edit/write/apply_patch 进行有针对性的源代码修改。
- 新增或修改文件必须遵循目标项目现有的格式与语言规范，适用于代码、文档及其他文件类型；不得为了节省行数而压缩内容。
- 使用 bash 工具执行自动化操作：git、包管理器、测试、构建、脚本、诊断及 shell 原生文件系统操作。注意：bash 工具的实际 shell 以其工具描述中的 OS/Shell 标注为准（Windows 上通常是 PowerShell 或 cmd.exe，并非 bash）——命令动词、引号与连接符必须跟随该 shell（Windows PowerShell 5.1 不支持 \`&&\`，用 \`cmd1; if ($?) { cmd2 }\`），不要默认 Unix 语法（grep/sed/cat 在 PowerShell/cmd 下通常不存在）。
- 批量或机械文件变更在比逐项编辑更清晰或安全时可以使用 Shell（例如截断生成日志、移除构建产物、批量重命名/移动），尤其是用户明确要求该 Shell 操作时。
- 进行破坏性或大范围 Shell 操作前，核实目标集合并引用路径；可行时优先先做 dry-run/列举。
- 不要仅为读取代码而使用 cat/head/tail/sed/awk（或其 Windows 等价物 type/Get-Content/Select-String）；使用 read/grep，除非 Shell 管道确实更适合诊断。`;

/** 只读 agent（explorer/librarian/oracle/observer）的文件操作规则 */
export const READONLY_FILE_OPERATIONS_RULES = `**文件操作规则**：
- 工具来源：read/grep/glob/list/lsp/codesearch/webfetch/websearch 是宿主提供的工具——按照当前会话工具目录直接按名称调用；绝不能通过 Code Mode \`execute\` 代理调用，也绝不能臆造目录中不存在的工具名。文本/正则搜索使用 \`grep\`；不存在通用的 \`search\` 工具。
 - 只读：检查并报告；不要修改文件。
 - 代码库检查优先使用专用文件工具：用 glob/grep/ast_grep_search 进行发现，用 read 读取文件内容。
- 当 bash 工具最清晰时，允许用它执行不修改文件的诊断和 shell 原生检查，但不得用于修改文件。注意：bash 工具的实际 shell 以其工具描述中的 OS/Shell 标注为准（Windows 上通常是 PowerShell 或 cmd.exe，并非 bash）——命令动词、引号与连接符必须跟随该 shell（Windows PowerShell 5.1 不支持 \`&&\`），不要默认 Unix 语法（grep/sed/cat 在 PowerShell/cmd 下通常不存在）。
- 不要仅为读取代码而使用 cat/head/tail/sed/awk（或其 Windows 等价物 type/Get-Content/Select-String）；使用 read/grep，除非 Shell 管道确实更适合诊断。`;

/**
 * 只读 agent 的 shell 工具规则：默认允许检查，按命令模式拦截明显写操作。
 *
 * 宿主评估语义（对齐 tool/shell.ts + permission/arity.ts）：
 * - 命令经 tree-sitter 解析后按 BashArity 前缀生成 pattern（cmdlet 无 arity
 *   条目时取首 token），权限评估为 `Wildcard.match(pattern, 规则键)`，findLast
 *   后声明优先——因此所有 deny 必须位于 `'*': 'allow'` 之后。
 * - 管道命令按两侧 command 节点分别生成 pattern（不含 `|`），因此动词式规则
 *   即可覆盖管道右侧（`... | Out-File f` 由 `'Out-File *'` 拦截）。
 * - `Wildcard.match` 仅在 win32 大小写不敏感；PowerShell cmdlet 在非 win32
 *   平台（pwsh）按大小写敏感匹配，故 cmdlet 采用 PascalCase + 小写双写。
 *   cmd.exe 动词惯例小写，单写小写。
 */
export const READONLY_SHELL_PERMISSION: Record<string, 'allow' | 'deny'> = {
  '*': 'allow',
  // ── POSIX 动词（bash/zsh/Git Bash） ──
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
  // ── cmd.exe 内置写动词 ──
  'del *': 'deny',
  'erase *': 'deny',
  'rd *': 'deny',
  'ren *': 'deny',
  'rename *': 'deny',
  'move *': 'deny',
  'copy *': 'deny',
  'md *': 'deny',
  // ── PowerShell cmdlet（PascalCase 规范形 + 小写形双写） ──
  'Remove-Item *': 'deny',
  'remove-item *': 'deny',
  'Copy-Item *': 'deny',
  'copy-item *': 'deny',
  'Move-Item *': 'deny',
  'move-item *': 'deny',
  'New-Item *': 'deny',
  'new-item *': 'deny',
  'Rename-Item *': 'deny',
  'rename-item *': 'deny',
  'Set-Content *': 'deny',
  'set-content *': 'deny',
  'Add-Content *': 'deny',
  'add-content *': 'deny',
  'Clear-Content *': 'deny',
  'clear-content *': 'deny',
  'Set-Item *': 'deny',
  'set-item *': 'deny',
  'Out-File *': 'deny',
  'out-file *': 'deny',
  'Tee-Object *': 'deny',
  'tee-object *': 'deny',
  'Compress-Archive *': 'deny',
  'compress-archive *': 'deny',
  'Expand-Archive *': 'deny',
  'expand-archive *': 'deny',
  'Start-Process *': 'deny',
  'start-process *': 'deny',
  // ── git 写操作（跨 shell 同名子命令） ──
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
  // ── 包管理器安装/变更 ──
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
  // ── 重定向写（bash/cmd/PowerShell 变体） ──
  '* > *': 'deny',
  '* >*': 'deny',
  '* >> *': 'deny',
  '*>>*': 'deny',
  '*> *': 'deny',
  '* | tee *': 'deny',
};

/** 默认禁用的 agent（默认全部启用；observer 需要视觉模型，可经 disabled_agents 显式禁用） */
export const DEFAULT_DISABLED_AGENTS: string[] = [];

/**
 * 默认只读 agent 集合。这些 agent 在无显式 agents.<name>.permission 时
 * 会集中获得 READONLY_DEFAULT_PERMISSION，保证只读不写入、不委派、不执行 task。
 */
export const READONLY_AGENTS: ReadonlySet<string> = new Set([
  'explorer',
  'librarian',
  'oracle',
  'observer',
]);

/**
 * 只读 agent 的默认 permission：
 * - allow：read/glob/grep/list/lsp/codesearch/webfetch/websearch/ast_grep_search
 *   以及查询型 codebase-memory 工具
 * - bash：宿主 shell 工具的权限键**恒为 'bash'**（宿主 tool/shell/id.ts `ToolID`，
 *   与实际运行 bash/PowerShell/cmd 无关）；默认允许非修改命令，并按
 *   READONLY_SHELL_PERMISSION 拒绝常见写入模式。'shell' 键为兼容双写
 *   （防宿主按 id.ts 注释预告在 2.0 改名），两条键生成等价规则、互不冲突。
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
  bash: READONLY_SHELL_PERMISSION,
  // 兼容双写：宿主当前权限键为 'bash'；'shell' 为未来改名预留，二者同规则。
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
  // 用户级配置写入只允许主编排 agent（/oceanus-config 流程）执行。
  oceanus_config_generate: 'deny',
};

/**
 * explorer 与其他只读 agent 一致使用 READONLY_DEFAULT_PERMISSION：
 * 调研结果不落盘，完整结论在对话回复中以七字段结构返回（2026-09 用户决策）。
 * 历史 findings 落盘放行（EXPLORER_DEFAULT_PERMISSION）已移除。
 */

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

/**
 * Prometheus（primary 规划 agent）的受限权限：
 * 以只读默认权限 spread 派生（锁死与 READONLY_DEFAULT_PERMISSION 的漂移面，
 * 只读表未来增删键自动同步），差异仅两键：
 * - question: allow —— primary 直接面对用户，owner-decision 必须能建立阻塞边界；
 * - skill: deny —— 规划流程全部内联 system prompt，不加载执行类 skill 指令文本；
 * - task/subagent 沿用只读表整体 'deny' —— 不委派任何 subagent，全部研究自查。
 *   历史：曾以对象形式白名单放行 explorer/librarian/oracle（前缀式 resource
 *   `task.explorer` 等）；但宿主 task 工具以裸 agent 名评估——宿主 tool/task.ts
 *   `ctx.ask({ permission: 'task', patterns: [params.subagent_type] })`，evaluate
 *   走 `Wildcard.match(裸名, rule.pattern)`，前缀式 resource 永不匹配、findLast
 *   命中 `{'*': 'deny'}`，真实会话 fail-closed 全拒（2026-09-10 实锤），遂移除。
 * 注意：用户显式 agents.prometheus.permission 会整体替换本表（非合并），未声明
 * 键回落宿主 `*:*` allow 基线；调整权限请提供完整表。
 * `execute`（Code Mode）与只读 subagent 同姿态：未声明，继承宿主基线。
 */
export const PROMETHEUS_PERMISSION: NonNullable<
  AgentOverrideConfig['permission']
> = {
  ...READONLY_DEFAULT_PERMISSION,
  skill: 'deny',
  question: 'allow',
};
