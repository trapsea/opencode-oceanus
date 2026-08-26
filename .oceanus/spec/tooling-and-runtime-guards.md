# Oceanus 工具与运行时保护设计
### task registry 观察链路

- 插件不替代宿主 `subagent`/`task` 工具；通过内部 `task_registry_observer` Hook 观察这些宿主工具的 before/after 事件。
- before 以宿主调用 id（或显式 task id）创建父 session ownership 记录；after 从结果中提取明确的 child session id、终态和受限结果摘要。
- 只有明确可识别的 id 才写入 registry；未知结果形状不猜测 child session，不伪造完成状态。
- observer 失败 fail-open，不阻断宿主任务；task_status/result/cancel 仍以 registry ownership 和宿主 session 事实为准。

## 目标

在保持 Oceanus 原生 OpenCode v2 架构的前提下，增加代码结构操作、精确编辑、后台任务观测和工具运行时保护能力，并参考 `oh-my-opencode-slim` 与 `oh-my-openagent` 的成熟实现，避免直接移植 v1 client/session 状态机。

## 已确认决策

- 默认策略：新增 Tool 与 Hook 默认全部启用。
- AST 首期采用原生 v2 Tool，不拆成 MCP。
- task 首期只实现：`task_status`、`task_result`、`task_cancel`。
- `task_message`、`task_revive` 暂不伪实现；待 v2 父子 session、prompt 传输和 generation 语义确认后再评估。
- 使用 v2 宿主权限和 session API，不复制 v1 `ctx.ask`、`client.session.*` shim。
- 不重复实现宿主已有的 `read`、`glob`、`grep`、`edit`、`webfetch`、`question`、`subagent` 和 MCP OAuth。

## 实现范围

### 原生 Tools

#### AST

- `ast_grep_search`
- `ast_grep_replace`

能力包括 AST 模式、语言、路径、glob、上下文、dry-run、匹配数量限制、输出大小限制和超时。replace 遵循工具调用权限并由插件执行工作区路径校验；不在插件中复制宿主 `edit` 的 ask/deny 状态机。

#### hashline

- `hashline_edit`

首期支持按文件 hash 行锚点执行 replace、append、prepend，校验文件版本并返回结构化 diff。删除和重命名能力只有在路径安全检查明确后再开放。

#### task

- `task_status`
- `task_result`
- `task_cancel`

使用 Oceanus 自己的轻量 task registry 记录受插件管理的子任务。状态读取优先使用 v2 session/event 的事实，registry 状态只作为本地索引，不能将未知状态伪装为完成。

### Runtime Hooks

- `apply-patch`
- `tool-output-truncator`
- `json-error-recovery`
- `tool-loop-guard`
- `task-registry-observer`

Hook 必须通过 `ctx.tool.hook("execute.before")` / `ctx.tool.hook("execute.after")` 注册；单个 Hook 初始化或执行失败不能阻止其它 Hook 和插件启动。

#### task_registry_observer（宿主观察链路）

- 插件不替代宿主 `subagent` / `task` 工具，仅通过内部 `task_registry_observer` Hook 观察这些宿主工具的 before/after 事件；不观察自定义 task_status/result/cancel。
- before 以 input 的 taskId/task_id（若明确）或宿主调用 id（`event.id`）生成稳定任务 id，记录 `parentSessionId=event.sessionID`、label/subject（若明确）、`status=running`，并保存 callID→任务 id 映射；未知/异常输入不抛错、不伪造 child session。
- after 从 result（output/content/metadata 及任意嵌套）递归提取明确 child session id（优先 childSessionId > child_session_id > sessionID > sessionId，且排除父 session），并保留受限长度文本摘要；仅当明确识别时绑定 child；`completed→completed`、`error→failed`，未知形状保持 running/unknown。
- 只有明确可识别的 id 才写入 registry；未知结果形状不猜测 child session，不伪造完成状态。
- observer 失败 fail-open，不阻断宿主任务；task_status/result/cancel 仍以 registry ownership 和宿主 session 事实为准。
- 扩展 `TaskRegistry` 安全方法 `attachChildSession` / `setObservation`：仅父 session 可调用（parent ownership），维护 session 索引、返回副本、结果大小有上限、仅显式终态才同步状态。
- `task_result` 只接受「宿主已验证（`verified===true`）的终态」或「registry 中明确存储的终态观察结果」，否则返回结构化错误；不能把 registry 的 `completed` 状态当作宿主事实。

### 工具之间的联动

```text
read → hashline_edit → tool-output-truncator
                  └── hash mismatch → 重新 read

ast_grep_search → ast_grep_replace → apply-patch / edit protection

subagent → task registry → task_status/task_result/task_cancel → TUI/task evidence

任意 Tool → JSON error recovery / loop guard / output truncation
```

- `tool-loop-guard` 不得阻止 task polling 工具的合法重复调用。
- `tool-output-truncator` 必须在 JSON error recovery 和 loop guard 之前或之后按稳定顺序执行，并避免截断错误标记和控制协议。
- `apply-patch` 只改写目标工具的输入，不能替代宿主权限判断。
- `hashline_edit` 的 hash mismatch 必须返回可操作的重新读取提示，不能静默重试。

## 配置设计

保留现有顶层 `disabled_tools` 兼容字段，并新增结构化配置：

```jsonc
{
  "disabled_tools": [],
  "disabled_hooks": [],
  "tools": {
    "ast_grep_search": {
      "enabled": true,
      "timeoutMs": 30000,
      "maxMatches": 200,
      "maxOutputBytes": 262144
    },
    "ast_grep_replace": {
      "enabled": true,
      "dryRun": true
    },
    "hashline_edit": {
      "enabled": true,
      "maxFileBytes": 1048576
    },
    "task_status": { "enabled": true },
    "task_result": { "enabled": true },
    "task_cancel": { "enabled": true }
  },
  "hooks": {
    "apply_patch": { "enabled": true },
    "tool_output_truncator": {
      "enabled": true,
      "maxOutputBytes": 200000
    },
    "json_error_recovery": { "enabled": true },
    "tool_loop_guard": {
      "enabled": true,
      "warnAt": 3,
      "blockAt": 5,
      "maxSessions": 512
    },
    "task_registry_observer": { "enabled": true }
  }
}
```

配置规则：

1. 未配置时默认启用全部本次新增能力。
2. `disabled_tools` 对工具名拥有最终禁用权。
3. `disabled_hooks` 对 Hook 名拥有最终禁用权。
4. 结构化配置中的 `enabled: false` 等价于禁用对应能力。
5. 项目配置覆盖用户配置；preset 只覆盖工具/Hook 参数，不应隐式改变宿主权限。
6. 未知工具、Hook 或配置字段必须通过 schema 报告，而不是静默忽略。
7. `tools` 和 `hooks` 使用按工具/Hook 名称的深度合并；同一项只覆盖显式提供的字段。`disabled_tools` 和 `disabled_hooks` 作为数组整体由项目配置覆盖用户配置。

现有 `disabled_tools` 当前只是 schema 字段，尚未被注册逻辑消费；本次必须在 Tool transform 中落实。`disabled_tools`、`disabled_hooks` 和单项 `enabled: false` 的优先级为：

```text
disabled_tools/disabled_hooks > item.enabled > default(true)
```

## v2 API 映射

- v2 `execute.before` Hook 使用单个 event 参数，修改 `event.input`；不能直接复制 slim 的 `output.args` 写法。
- v2 `execute.after` Hook 修改 `event.result` 或 `event.error`；不能直接复制 slim 的 `output.output` 写法。
- 工作区根目录通过 `sessionID → ctx.session.get → location.directory` 解析；当前 beta 插件上下文未暴露 `project.canonical`，Tool 参数中的路径必须 canonicalize 后校验。
- `task_cancel` 使用 v2 `ctx.session.interrupt({ sessionID, continue: false })`，该 API 官方契约返回 `Promise<void>`；随后通过 `session.get`/`session.active` 验证结果。只有 interrupt 正常返回、session 不再 active 且 outcome 明确为 `interrupted`/`succeeded` 时才报告取消成功；不使用 v1 的 `abort`/`delete` 假设。
- `task_status` 的宿主事实来源优先级为运行时可用的 `session.active`、`session.get` 和事件快照；当前 beta 插件类型未暴露 `session.active` 时诚实降级为 `session.get`/registry，并标记 `verified:false`，不伪造运行中状态。

Hook 的固定执行顺序为：

```text
before: apply-patch → tool-loop-guard.before → task-registry-observer.before
after:  json-error-recovery → tool-output-truncator → tool-loop-guard → task-registry-observer.after
```

每个 Hook 自己捕获和记录异常。`apply-patch` 只对明确的工作区外路径检查失败开放，其余验证/内部错误默认 fail-closed；after Hook 默认 fail-open，不能因为保护逻辑失败而阻断已完成的宿主工具结果。Hook 抛错是否被宿主阻断工具执行必须通过 smoke test 固定行为。

## 安全边界

- 使用 v2 宿主权限 action 与工具自身 action；插件不复制 `read`、`edit`、`subagent`、`shell` 的宿主实现。
- AST search 和 task_status/result 只读。
- AST replace、hashline_edit 和 task_cancel 通过自身工具调用入口接受宿主权限控制，不在插件中复制或绕过 ask/deny；工作区路径校验由插件自身完成，因为宿主工具权限不自动覆盖 AST CLI 或 hashline 的每个文件路径。
- 所有路径必须解析到当前工作区或明确允许的外部目录。
- 不自动下载并执行未经校验的二进制；AST CLI 的路径、版本、缓存和失败行为必须可诊断。
- AST CLI 的每个候选路径在接受前必须执行短超时 `--version` 验证并确认输出包含 `ast-grep`，拒绝 GNU `sg/newgrp` 等同名程序；真实 CLI 缺失时测试应明确 skip 并输出诊断。
- Tool 输出截断必须保留错误、状态、task id、diff 和 hash mismatch 等控制信息。
- task registry 必须限制大小、清理已结束任务并防止跨 session 越权读取。

## 不在本次范围

- `task_message`
- `task_revive`
- 完整 BackgroundJobBoard、parent-wake、generation fence
- v1 `PluginInput`/client shim
- multiplexer、team mode、ACP、smartfetch、session-manager
- telemetry 和长期 memory

## 验收目标

1. 所有新增 Tool 能通过 v2 `ctx.tool.transform` 注册并可按配置启停。
2. 所有 Hook 能通过 v2 `ctx.tool.hook` 注册，且失败隔离。
3. AST search/replace 有超时、输出上限、路径限制和 dry-run 测试。
4. hashline_edit 能检测文件变化并返回稳定 diff。
5. task_status/result/cancel 不读取或修改非本 session 管理的任务。
6. loop guard 不阻止合法 task polling；并发调用不会提前增加计数。
7. JSON error recovery 不对排除工具产生误报。
8. apply-patch 重写失败时遵循明确的 fail-open/fail-closed 策略。
9. 通过单元测试、类型检查、构建和最小 v2 host smoke test。
