# 后台任务生命周期能力分层

> **设计演进（2026-08-28）**：本文档「能力分层 2（标准 subagent 降级模式）」与「非目标 3（不使 raw subagent 自动拥有完整 task 生命周期）」**已被本节取代**。实测推翻了原前提：
>
> 1. 宿主 V2 `Tool.Result` 形状为 `{ output?, content?: string | Content[], metadata? }`（无 `sessionID` 字段）——原实现只认 `result.sessionID` 导致真实宿主上登记从未发生（`.oceanus/tasks.json` 不生成、`task_status` 报「task 不存在」）。
> 2. 宿主实际支持 raw `subagent` 任务的登记与复用：subagent 工具支持 `sessionID` 参数续会话（实测可用），后台返回文本即含 `sessionID: ses_x` 标记并引导 `task_status` 轮询。
>
> **现行设计**：subagent-bridge 经兼容链从 `Tool.Result` 提取 child sessionID——`result.sessionID` → `result.metadata.sessionID/taskID` → 文本标记（`task_id: ses_x`、`sessionID: ses_x`、`sessionID="ses_x"`）→ 兜底首个 `ses_` ID（≠ parent）。提取失败记录诊断日志并保持不登记（fail-open 不变）。「受控后台任务模式」与「受限 revive/reuse」的其余语义不变。
>
> **第三次修订（2026-08-28，宿主事实兜底登记）**：实测发现 bridge 登记在真实宿主上仍未发生（静态排查：dist=源码、hook API 与事件形状同宿主 `Tool.trigger` 实现一致、工具名 `subagent` 匹配、coordinator 已接线，断点未实证）。据此把登记表降级为**缓存/护栏**，宿主 session 事实为终极事实源：`TaskCoordinator.ensureRegistered(taskID, parentSessionID)` 在登记缺失时以 `session.get` 严格校验子会话存在且 `parentID === parentSessionID`（保持跨父过滤边界），通过则补偿登记（保留 lane `host-fallback`）并按宿主 outcome 收敛终态；`task_status`/`task_result`/`task_cancel`/`task_message`/`task_revive` 全部接入兜底（防御性可选，兼容 stub 注入）。`runSetup` 补传 logger 使 bridge 诊断可见（此前 `opts.logger ?? noop` 静默丢弃）。已知上游缺口：oh-my-opencode-slim 登记桥硬编码只认工具名 `task`（其 `server.js` `tool.toLowerCase() !== "task"`），对当前宿主注册名 `subagent` 永不登记。

## 目标

让 Oceanus 仅对拥有稳定原生 `taskId` 的后台任务提供消息、状态、结果、取消与受限复用；标准 OpenCode V2 `subagent` 不再被误认为可控后台任务。

## 已确认事实

- OpenCode V2 的 `subagent` 运行于 child session，并提供 session 级 `prompt`、`wait`、`interrupt` 等 API；官方未承诺已完成 child session 可作为新任务稳定复用。
- oh-my-opencode-slim 的完整后台编排依赖 native background task 返回 task ID；这是参考实现模式，而非 OpenCode V2 的稳定 API 契约。
- 当前 native `subagent` 返回 session ID；将它传给 `task_message` 会得到 `TASK_NOT_FOUND`。

## 设计

### 能力分层

1. **受控后台任务模式**：仅当宿主返回稳定 native `taskId` 时，observer 才将任务写入 Registry 与 JobBoard。对外生命周期工具只接收该 `taskId`，内部通过 `taskId -> childSessionId` 映射调用宿主能力。
2. **标准 subagent 降级模式**：raw `subagent` 不是插件可控任务。生命周期工具不得接受它的 session ID，并返回明确的能力错误而非 `TASK_NOT_FOUND`。编排提示词不得要求此类任务消息投递或复用。
3. **受限 revive/reuse**：只有宿主确认支持、任务已 reconcile 且同 generation 的终态已写入 JobBoard 时，才允许复用；否则返回 `unsupported` / `uncertain` 并允许一次新建任务回退。

### 状态一致性

- JobBoard 是持久化任务事实；Registry 是进程内索引。
- `task_status`、`task_result` 在 Registry 未命中时可读取同父 session 的 JobBoard 记录，并优先宿主事实。
- observer 对明确终态同步写入 reconcile/reusable 条件；revive/reuse 将宿主返回的终态以 CAS 落板，绝不长期停在 `starting`。
- 仅 `completed + reconciled + childSessionId` 的任务进入 reusable pool。

## 范围

- 修改任务 observer、任务工具、reconcile/revive/reuse、能力诊断、代理提示词与相应测试。
- 增加 capability error 与受控任务辨识的单元测试。

## 非目标

- 不强制安装或启动 OpenCode 服务。
- 不把已完成 child session 的 `prompt` 当作官方保证的复用能力。
- 不使 raw `subagent` 自动拥有完整 task 生命周期。

## Metis 分析

未执行：已基于 OpenCode V2 官方文档、oh-my-opencode-slim 的公开后台编排文档、当前源码审计形成明确的能力分层方案，不存在尚未决的候选架构。残余风险是宿主实验性后台 task API 的实际形状，须通过 capability detection 和 host smoke 隔离。

## 验收标准

1. ~~raw `subagent` 的 session ID 不再导致误导性的 `TASK_NOT_FOUND`，而是明确报告不受支持。~~ **（2026-08-28 修订）** raw `subagent` 后台任务经 bridge 自动登记；宿主 result 无法提取 sessionID 时记录诊断日志且不登记。
2. 受控任务的 `taskId` 可用于消息、状态、结果与取消。
3. revive/reuse 的终态不会遗留在 `starting`，generation 语义保持正确。
4. 重启后可从 JobBoard 查询受控任务状态/结果。
5. 类型检查和任务生命周期单元测试通过；真实宿主 smoke 在能力存在时覆盖消息与终态收敛。
6. **（2026-08-28 新增）** 单测覆盖宿主真实 result 形状（content 文本内嵌 sessionID / Content[] / metadata），不再仅依赖 `result.sessionID` fake 形状。
