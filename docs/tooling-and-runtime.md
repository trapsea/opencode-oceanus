# 新增工具与运行时保护

本文记录 Oceanus 插件 P1-P14 已实现的原生 v2 工具（Tools）与运行时保护 Hook，
以及对应的配置方式。实现细节与决策背景见
`.oceanus/spec/tooling-and-runtime-guards.md`。

## 总体说明

六阶段工作流（Intake → discuss → Plan → Execute → Review → Finish）由 Agent/Skill 的
prompt 契约驱动：Agent 负责编排与委派，Skill 规定阶段边界；工具和 Hook 只提供运行时
能力，不是阶段 supervisor。执行配置（SDD/TDD/Review 循环执行）由
Intake 前置的执行配置批问确认——一次 question 批量问三项，**三项默认推荐全部关闭**
（选项说明中可提示何种规模值得开启）；仅实现类任务批问，调研/查询/方案设计等非实现
类任务跳过批问并按默认关闭记录（\`not_asked: non-implementation\`），漏答回落默认关闭
并记录、不补问；方案方向由方案总批准单问覆盖。Oracle 仅在复杂架构或高风险业务场景按需咨询，
并对落盘 spec/plan 提供 advisory。Review 发现 BLOCKER 后按「Review 循环执行」开关分流：
开启时自动修复并重新 Review（最多 3 轮复审闭环，通过才进入 Finish）；关闭（默认）时
一次性修复全部 BLOCKER 并取得当前状态验证证据后直接进入 Finish，不重新 Review；
UNCERTAIN 在任何模式下都阻塞并请求用户决策。Review 由主 agent 复查并运行测试，正式审查按双信号分级路由给 oracle：
docs-only diff 走 `diff-review` 轻量场景（`review_intensity: light`：范围核对、
证据映射与文档底线），trivial 任务走 `review` 场景的 scoped 维度映射（三维必查、
其余按 diff 触及面映射），standard/architecture 保持 `review` 场景 9 维全量
（`review_intensity: full`）；判据缺失或不可判定时回落 full，任何分级都保留
graded 契约与 fresh-session 独立性，不存在零审查放行路径。Oracle Brief 以
路径引用与不超过 3 行的短摘要为主（不内联长文本），Oracle 按读取优先级
（审核对象/diff > 验收标准 > plan > 其他上下文）自行读取原始文件；
completion-audit 场景仍作为完成矩阵审计的条件触发项。Finish 只读 Review 报告，不再测试、
构建、调用 CBM、委派或写文件。

Ledger 与 Review 报告是不同契约：Ledger 记录任务 id、状态、父子关系和时间等进度视图；
Review schema 记录 success criteria、证据、发现、验证结果和结论。二者都不能把 registry
状态或 CBM（仅 advisory 依赖）提升为宿主事实，也不能用 advisory 结果替代权限门控。

- 新增 Tool 与 Hook 默认全部启用。
- 通过 `ctx.tool.transform` 注册工具、`ctx.tool.hook` 注册 Hook。
- **直接工具 vs Code Mode（宿主 registry 实证，beta-18230）**：注册工具不设置
  `options.codemode` 时缺省落入 Code Mode catalog——只能在该会话 `execute` 工具
  的 JS 运行时内经 `tools.<name>` 调用；subagent 虽有 `execute`，但模型几乎不会
  为单次编辑绕道 Code Mode（实测 subagent 几乎不绕道）。
  因此 `registerOceanusTools` 在注册包装层为核心工具
  统一注入 `options.codemode: false`，使其进入所有会话（含 subagent）的
  **直接工具目录**；CBM 工具保持缺省 Code Mode（catalog 形式，见
  codebase-memory-mcp.md）。宿主原生 write/edit/webfetch/websearch 同样显式
  `codemode: false`。`permission` 不单独设置：宿主以工具名作为 permission
  action，与 `READONLY_DEFAULT_PERMISSION` 的 deny key（ast_grep_replace
  等）对齐，只读 agent 的写入边界经宿主权限系统直接生效。
  Agent prompt 中“直接调用，不要通过 Code Mode 的 `execute` proxy”
  的既有措辞在直接化后语义更准（这些工具与宿主工具同级），无需弱化。
- **Code Mode 内部调用纪律（beta-19296 宿主实证）**：`execute` 的 JS 运行时里
  存在两种调用形态——catalog 工具挂在 `tools` 命名空间（`tools.<ns>.<name>(...)`），
  而 `search(...)` 是**全局内置函数**（发现工具目录与签名，返回 path 与
  signature），不在 `tools` 命名空间内。模型高频混淆点：把 `search` 写成
  `tools.search(...)` / `tools["search"](...)` 会触发
  `Unknown tool 'search'`（真实会话已复现；错误提示
  "Use search to find available tools" 指的正是全局函数形态）。正确纪律：
  工具一律 `tools.<ns>.<name>(...)`；发现工具用全局 `search({ query })`；
  `Object.keys(tools)` 列出顶层命名空间。该纪律已固化为
  `CODEMODE_CALLING_PROTOCOL`（`src/agents/protocol.ts`），常驻
  oceanus/sisyphus 主 agent prompt，并由 `oceanus-execute` skill 步骤 3
  同步。宿主源码主线已将 `search` 迁至 `tools.$codemode.search` 并常驻
  注册（防投机调用失败），升级宿主后以运行时目录提示的实际形态为准，
  两代形态不得在同一会话混用。
- **写入 subagent 的工具族约束（WRITER_TOOL_PERMISSION）**：文件编辑使用宿主原生
  `edit` / `write` / `apply_patch`（原生 diff 渲染与模型通用心智）；`ast_grep_replace`
  显式 `allow`（默认 dry-run 预览保护）。
  注册层 `mergeAgentPermissions` 以 merge 语义追加，不整体替换 agent.permissions。
- 工具与 Hook 各自独立容错：单个初始化或执行失败不阻止其它 Hook 与插件启动。
- 工具一律以结构化 result 返回错误，不抛异常。
- 不引入 v1 client/session shim，不重复实现宿主已有的 `read` / `glob` / `grep` /
  `edit` / `webfetch` / `question` / `subagent`。

## 内置工具

### AST：`ast_grep_search` / `ast_grep_replace`

- `ast_grep_search`：按 AST 语法模式搜索（只读）。支持 `$VAR` / `$$$` 元变量、
  语言（`lang`）、路径（`paths`）、glob（`globs`）、上下文行数（`context`）、
  匹配数上限（`maxMatches`）、输出字节上限（`maxOutputBytes`）与超时（`timeoutMs`）。
- `ast_grep_replace`：查找并替换。**默认 dry-run**（只预览改写结果，不改写文件）；
  显式 `dryRun: false` 才真正写入。只改写工作区内文件。
- 两个工具都要求真实 ast-grep CLI；缺失时返回诊断信息。

文件编辑统一使用宿主原生 `edit` / `write` / `apply_patch`（原生 diff 渲染、模型通用心智），结构性替换用 `ast_grep_replace`。

## 内置 Hook

固定执行顺序：无 `coordinator` 的 `mock` 注册为 3 个 `before`、5 个 `after`；生产接线另含
`image_materializer` / `image_error_hint` 是 session hook，只有真实 Host 暴露相应 API
时才注册，不计入上述 execute Hook 数量。

```text
before: apply-patch → loop-guard.before → task-registry-observer.before → cbm-guidance.before
after:  json-error-recovery → tool-output-truncator → tool-loop-guard → task-registry-observer.after → cbm-guidance.after
```

| Hook | 作用 | fail-open / fail-closed 边界 |
|------|------|------------------------------|
| `apply_patch` | 校验并保守规范化 `apply_patch` 输入：解析 Codex 风格 patch、路径边界、无损重写（CRLF→LF、heredoc 去包裹、空白裁剪、路径 `\`→`/`），以“重写前后语义等价”为校验闸门 | 工作区外路径、只读 `event.input` → **fail-open**（交由宿主处理）；输入形状无效、校验失败、内部异常 → **fail-closed**（抛错阻断执行）。无法解析工作区根时跳过校验（fail-open） |
| `json_error_recovery` | 修正工具返回的错误 JSON，避免错误被当作结果吞掉 | after Hook 默认 **fail-open** |
| `tool_output_truncator` | 截断超长工具输出，避免破坏上下文；保留错误、状态、diff 与 hash mismatch 等控制信息 | **fail-open** |
| `tool_loop_guard` | 检测重复工具调用：达到 `warnAt` 提示、`blockAt` 熔断；不阻止合法 task polling | **fail-open** |
| `cbm_guidance` | 在工具执行前后提供 CBM 使用建议与状态提示 | **fail-open**：CBM 不可用时标记不确定性并继续 |

> after Hook 默认 fail-open：保护逻辑失败不阻断已完成的宿主工具结果。

## 配置

配置位于用户级 `~/.config/opencode/opencode-oceanus.jsonc` 与项目级
`.opencode/opencode-oceanus.jsonc`（项目优先）。相关字段：

```jsonc
{
  "disabled_hooks": [],
  "tools": {
    "ast_grep_search": { "enabled": true, "timeoutMs": 30000, "maxMatches": 200, "maxOutputBytes": 262144 },
    "ast_grep_replace": { "enabled": true, "dryRun": true },
    "clipboard_image": { "enabled": true }
  },
  "hooks": {
    "apply_patch": { "enabled": true },
    "tool_output_truncator": { "enabled": true, "maxOutputBytes": 200000 },
    "json_error_recovery": { "enabled": true },
    "tool_loop_guard": { "enabled": true, "warnAt": 3, "blockAt": 5, "maxSessions": 512 },
    "cbm_guidance": { "enabled": true }
  }
}
```

配置规则：

1. 未配置时默认全部启用。
2. `disabled_tools` / `disabled_hooks` 对对应名称拥有最终禁用权。
3. 单项 `enabled: false` 等价于禁用。
4. 优先级：`disabled_*` > `item.enabled` > 默认 `true`。
5. 项目配置覆盖用户配置；`tools` / `hooks` 按名称深合并，同一项只覆盖显式字段；
   `disabled_tools` / `disabled_hooks` 作为数组整体由项目配置覆盖用户配置。
6. 未知工具名、Hook 名或配置字段会被 schema 拒绝，而不是静默忽略。

工具与 Hook 可用字段：

- `tools`（`ToolConfigSchema`）：`enabled`、`timeoutMs`、`maxMatches`、
  `maxOutputBytes`、`dryRun`、`maxFileBytes`。
- `hooks`（`HookConfigSchema`）：`enabled`、`maxOutputBytes`（truncator）、
  `warnAt` / `blockAt` / `maxSessions`（loop guard）。

## AST CLI 安装与诊断

`ast_grep_search` / `ast_grep_replace` 依赖真实 ast-grep CLI。插件不自动下载二进制。

解析顺序：

1. `AST_GREP_BIN` 环境变量显式覆盖
2. 缓存目录二进制
3. `@ast-grep/cli` 包（优先 `ast-grep`，回退 `sg`）
4. 平台专属包（如 `@ast-grep/cli-linux-x64-gnu`）
5. PATH 上的 `ast-grep` / `sg`

每个候选在接受前执行短超时 `--version` 验证，输出必须包含 `ast-grep`，从而拒绝
同名但非 ast-grep 的程序（如 Linux 上作为 `newgrp` 别名的 `sg`）。

安装方式：

```bash
bun add -D @ast-grep/cli   # 或 cargo install ast-grep、brew install ast-grep
```

或设置 `AST_GREP_BIN=/path/to/ast-grep` 指向已有二进制。

环境中没有真正可用的 ast-grep 时，工具返回诊断信息；测试
（`src/smoke/host-smoke.test.ts`、`src/smoke/ast-grep-probe.ts`）会**明确 skip 真实
CLI 集成并输出诊断**，不把环境缺失误报为产品失败。

## 测试与验证

- 单元测试覆盖工具参数、CLI 解析、CBM 与各 Hook。
- `src/tooling-integration.test.ts` / `src/smoke/host-smoke.test.ts` 在 bun test 下用 mock ctx
  验证注册契约（Oceanus 工具 + CBM 工具、`before` + `after` Hook 的数量与顺序）；生产 `coordinator` 接线还会
  注册子代理桥接，实际为 4 个 `before` + 6 个 `after`。
- 真实 ast-grep CLI 集成测试仅在探针确认可用时运行（`describe.skipIf`）。
- 真实 OpenCode v2 host 能力（`session.active` / `interrupt` 等）只在 opencode 会话内
  执行插件时验证；当前 smoke 主要是 mock ctx 注册契约，真实 Host/CLI 成功**未宣称、未默认验证**。

### CBM 索引命令注册

CBM 工具共注册 7 个：`cbm_status`、`cbm_index`、`cbm_search_graph`、`cbm_trace`、
`cbm_code`、`cbm_query`、`cbm_detect_changes`。其中 `cbm_index` 是显式触发索引的
独立长超时命令（不是 status 的别名），仅在 `codebaseMemory.enabled` 且 CLI fallback
门控允许时注册。CLI 兼容路径优先 `--args-file`，失败时才回退旧 raw JSON 形式；兼容性
有单元测试，但未在真实 CBM daemon/CLI 版本矩阵中验证。

## 不在范围

以下能力不作为本项目原生工具提供：`context7`、`gh_grep`、完整 BackgroundJobBoard /
parent-wake / generation fence、
v1 `PluginInput` / client shim、multiplexer / team mode / ACP / smartfetch /
session-manager、telemetry 与长期 memory。

## Spec / Plan / Review 输出契约
最小骨架：Spec 说明 Goal、Context、Scope、Design、边界和可验证 Acceptance；Plan 写唯一 Spec 路径、Files map、依赖及逐 Task 的 Files、Interfaces、checkbox、`Validation command + expected output`；Review 逐条输出 `criterion -> evidence -> status -> gap/next action`。禁止 TBD/TODO/later 和未定义引用。
