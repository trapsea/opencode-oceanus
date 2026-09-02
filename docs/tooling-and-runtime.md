# 新增工具与运行时保护

本文记录 Oceanus 插件 P1-P14 已实现的原生 v2 工具（Tools）与运行时保护 Hook，
以及对应的配置方式。实现细节与决策背景见
`.oceanus/spec/tooling-and-runtime-guards.md`。

## 总体说明

六阶段工作流（Intake → Brainstorm → Plan → Execute → Review → Finish）由 Agent/Skill 的
prompt 契约驱动：Agent 负责编排与委派，Skill 规定阶段边界；工具和 Hook 只提供运行时
能力，不是阶段 supervisor。执行配置（Metis 审核/Momus 审核/SDD/TDD/Worktree/连续执行
授权）由 Brainstorm 前置的执行配置批问确认——一次 question 批量问六项，各带推荐值及
依据（Metis/Momus 依据=预估拆分任务数与需求复杂度，其余依据=预估任务数），漏答回落
推荐值并记录、不补问；方案方向由方案总批准单问覆盖。Momus 审核=开时 Plan 必须经过
`@momus` 的 `OKAY` + 有效方案总批准；关闭时降级为仅人工批准并记录 SKIPPED_BY_USER。
Review 由 review subagent、`@momus` 复核并运行测试。Finish 只读 Review 报告，不再测试、
构建、调用 CBM、委派或写文件（worktree 收尾除外）。

Ledger 与 Review 报告是不同契约：Ledger 记录任务 id、状态、父子关系和时间等进度视图；
Review schema 记录 success criteria、证据、发现、验证结果和结论。二者都不能把 registry
状态或 CBM（仅 advisory 依赖）提升为宿主事实，也不能用 advisory 结果替代权限门控。

- 新增 Tool 与 Hook 默认全部启用。
- 通过 `ctx.tool.transform` 注册工具、`ctx.tool.hook` 注册 Hook。
- **直接工具 vs Code Mode（宿主 registry 实证，beta-18230）**：注册工具不设置
  `options.codemode` 时缺省落入 Code Mode catalog——只能在该会话 `execute` 工具
  的 JS 运行时内经 `tools.<name>` 调用；subagent 虽有 `execute`，但模型几乎不会
  为单次编辑绕道 Code Mode（实测 fixer 回退宿主原生 `edit`，hashline 引导失效）。
  因此 `registerOceanusTools` 在注册包装层为 9 个核心工具
  （ast_grep_search / ast_grep_replace / hashline_edit / task_status /
  task_result / task_cancel / task_message / task_revive / clipboard_image）
  统一注入 `options.codemode: false`，使其进入所有会话（含 subagent）的
  **直接工具目录**；CBM 工具保持缺省 Code Mode（catalog 形式，见
  codebase-memory-mcp.md）。宿主原生 write/edit/webfetch/websearch 同样显式
  `codemode: false`。`permission` 不单独设置：宿主以工具名作为 permission
  action，与 `READONLY_DEFAULT_PERMISSION` 的 deny key（hashline_edit /
  ast_grep_replace 等）对齐，只读 agent 的写入边界经宿主权限系统直接生效。
  Agent prompt 中"call directly, never through a Code Mode `execute` proxy"
  的既有措辞在直接化后语义更准（这些工具与宿主工具同级），无需弱化。
- **写入 subagent 的工具族硬约束（WRITER_TOOL_PERMISSION）**：直接化只解决
  "可用"，实测（3/3）模型仍偏好宿主原生 `edit`。宿主 `edit` / `write` /
  `apply_patch` 共用 permission action `"edit"`（二进制实证），因此对
  fixer/designer 声明 `edit: 'deny'` 即经宿主 `Tool.snapshot(permissions)`
  把三个宿主写入工具从其工具目录整体移除；`hashline_edit`（支持新建文件、
  批量编辑、删除、重命名）与 `ast_grep_replace` 为仅存写入通道并显式
  `allow`。注册层 `mergeAgentPermissions` 以 merge 语义追加（保留宿主
  `*:* allow` 基线与 .env/外部目录 ask 特例、幂等、findLast 下追加规则
  优先），不整体替换 agent.permissions。
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

### `hashline_edit`

- 按文件行 hash 锚点执行 `replace` / `append` / `prepend`，校验文件版本并返回
  结构化 diff。
- 使用前先 `read` 获取行 hash；hash mismatch（文件已被改动）时返回可操作的重新
  读取提示，**不会静默重试**，需要重新 `read` 后再次编辑。
- 目标文件必须位于工作区内，受文件大小上限（`maxFileBytes`）约束。
- 删除 / 重命名能力在路径安全检查明确前不开放。

### `editing.strategy`（写入策略）

writer subagent（fixer/designer）的文件编辑工具选择，默认 `"hashline"`：

- `"hashline"`（默认）：锁定锚定通道——宿主 `edit` / `write` / `apply_patch` 共用
  action `edit`，`deny` 后从工具目录整体移除；定点修改必须走 `hashline_edit`
  （prompt 中为 MANDATORY 约束），`ast_grep_replace` 显式 `dryRun: false` 后可写。
- `"host"`：放开宿主原生工具——不 deny `edit`，`edit`/`write`/`apply_patch` 保留在
  工具目录；`hashline_edit` / `ast_grep_replace` 仍可用但不强制，prompt 指引同步
  切换。适合偏好原生体验或锚点工作流不适应的场景。

```jsonc
{ "editing": { "strategy": "host" } }
```

显式 `agents.<name>.permission` 始终覆盖策略默认；主 agent（oceanus/sisyphus）不受
此配置影响（本就两套工具都可用）。


### task 三件套：`task_status` / `task_result` / `task_cancel`

围绕 Oceanus 轻量 task registry + v2 session API 实现，只管理本插件创建的后台子任务。

- `task_status`：查询任务状态。只读；仅可访问当前 session 能访问的任务；优先使用运行时
  可用的宿主 session 事实（`session.active` / `session.get` / 事件快照），当前 beta
  插件类型未暴露 `session.active` 时诚实降级为 `session.get` / registry，并标记未验证。
- `task_result`：读取**已完成**任务的最终结果。只接受「宿主已验证的终态」或
  「registry 中明确存储的终态观察结果」，否则返回错误；不会把 registry 的
  `completed` 状态本身当作宿主事实。
- `task_cancel`：取消任务，中断其子 session 并通过宿主状态验证。调用方必须是任务的
  父或子 session；可传 `parentID` / `childID` 交叉校验 ownership。仅当宿主确认
  interrupt 成功、session 不再 active、且 outcome 明确为 `interrupted` / `succeeded`
  时才报告 `cancelled`，否则返回结构化错误，不伪造取消结果（interrupt 失败但
  outcome 已为自然终态时同样不伪造 cancelled）。

## 内置 Hook

固定执行顺序：无 coordinator 的 mock 注册为 3 个 before、5 个 after；生产接线另含
`subagent-bridge`，因此为 4 个 before、6 个 after（共 10 个 Hook）。图片相关的
`image_materializer` / `image_error_hint` 是 session hook，只有真实 Host 暴露相应 API
时才注册，不计入上述 execute Hook 数量。

```text
before: apply-patch → loop-guard.before → task-registry-observer.before → cbm-guidance.before
after:  json-error-recovery → hashline-read-enhancer → tool-output-truncator → tool-loop-guard → task-registry-observer.after → cbm-guidance.after
```

| Hook | 作用 | fail-open / fail-closed 边界 |
|------|------|------------------------------|
| `apply_patch` | 校验并保守规范化 `apply_patch` 输入：解析 Codex 风格 patch、路径边界、无损重写（CRLF→LF、heredoc 去包裹、空白裁剪、路径 `\`→`/`），以“重写前后语义等价”为校验闸门 | 工作区外路径、只读 `event.input` → **fail-open**（交由宿主处理）；输入形状无效、校验失败、内部异常 → **fail-closed**（抛错阻断执行）。无法解析工作区根时跳过校验（fail-open） |
| `json_error_recovery` | 修正工具返回的错误 JSON，避免错误被当作结果吞掉 | after Hook 默认 **fail-open** |
| `tool_output_truncator` | 截断超长工具输出，避免破坏上下文；保留错误、状态、diff 与 hash mismatch 等控制信息 | **fail-open** |
| `tool_loop_guard` | 检测重复工具调用：达到 `warnAt` 提示、`blockAt` 熔断；不阻止合法 task polling | **fail-open** |
| `task_registry_observer` | 观察宿主 `task` / `subagent` 的 before/after，把明确可识别的任务记录写入本地 task registry（任务 id、父子 ownership、观察到的 child session、受限结果摘要） | **fail-open**：不拦截、不抛错；未知结果形状不猜测、不伪造 child session 与终态 |
| `cbm_guidance` | 在工具执行前后提供 CBM 使用建议与状态提示 | **fail-open**：CBM 不可用时标记不确定性并继续 |

> after Hook 默认 fail-open：保护逻辑失败不阻断已完成的宿主工具结果。

## 配置

配置位于用户级 `~/.config/opencode/opencode-oceanus.jsonc` 与项目级
`.opencode/opencode-oceanus.jsonc`（项目优先）。相关字段：

```jsonc
{
  "disabled_tools": ["task_cancel"],
  "disabled_hooks": [],
  "tools": {
    "ast_grep_search": { "enabled": true, "timeoutMs": 30000, "maxMatches": 200, "maxOutputBytes": 262144 },
    "ast_grep_replace": { "enabled": true, "dryRun": true },
    "hashline_edit": { "enabled": true, "maxFileBytes": 1048576 },
    "task_status": { "enabled": true },
    "task_result": { "enabled": true },
    "task_cancel": { "enabled": true },
    "task_message": { "enabled": true },
    "task_revive": { "enabled": true },
    "clipboard_image": { "enabled": true }
  },
  "hooks": {
    "apply_patch": { "enabled": true },
    "tool_output_truncator": { "enabled": true, "maxOutputBytes": 200000 },
    "json_error_recovery": { "enabled": true },
    "tool_loop_guard": { "enabled": true, "warnAt": 3, "blockAt": 5, "maxSessions": 512 },
    "task_registry_observer": { "enabled": true },
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

- 单元测试覆盖工具参数、CLI 解析、hashline 编辑、task registry、CBM 与各 Hook。
- `src/tooling-integration.test.ts` / `src/smoke/host-smoke.test.ts` 在 bun test 下用 mock ctx
  验证注册契约（16 个工具：9 个 Oceanus 工具 + 7 个 CBM 工具、3 个 before + 5 个 after Hook）；生产 coordinator 接线还会
  注册 subagent bridge，实际为 4 个 before + 6 个 after。
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
