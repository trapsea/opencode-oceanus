# Primary↔Subagent 通信优化实施计划

## 决策

- TDD：每项先写 RED 测试，再实现 GREEN，再运行回归。
- 共享工作区串行：已有未提交改动，不创建 worktree，不执行 git reset/commit。
- 本次实现可自动验证的 B→C 核心；真实宿主能力只记录为后续人工 smoke，不伪造通过。

## 任务图

### T1：移除默认终态 queue 通知（Wave 1）

- Depends on：无
- Files：`src/runtime/task-notification.ts`、`src/runtime/task-observer.ts`、`src/runtime/task-observer.test.ts`。
- 契约：observer 默认不调用 `session.prompt`；保留函数仅供显式调用；默认 completed/failed prompt 次数均为 0。
- 测试：新增/修改测试名 `completed 默认不调用 prompt`、`failed 默认不调用 prompt`、`observer 仍更新 registry/board`，断言 prompt spy=0。
- 命令：RED/GREEN `bun test src/runtime/task-observer.test.ts`；通过后才进入 T2。

### T2：事件幂等、generation fence 与 before/after 收敛（Wave 2）

- Depends on：T1
- Files：`src/runtime/task-observer.ts`、`src/runtime/task.ts`、`src/tools/task/registry.ts`、`src/tools/task/job-board.ts`、`src/tools/task/types.ts`、`src/runtime/task-observer.test.ts`、`src/runtime/task.test.ts`、`src/tools/task/registry.test.ts`、`src/tools/task/job-board.test.ts`。
- 事件契约：`{eventId:string,taskId:string,parentSessionId:string,childSessionId?,generation:number,kind:'started'|'completed'|'failed'|'interrupted',result?,at:number}`；缺 eventId/generation 只记录 uncertain；同 eventId 同 payload 幂等且 revision 不增加；同 eventId 不同 payload 返回 `EVENT_CONFLICT` 且状态不变；generation `< current` 返回 `STALE_EVENT`，`= current` 应用，`> current` 返回 `FUTURE_GENERATION` 且不应用。
- barrier 契约：每个 callId 建立 before Promise；after 先到最多等待 2000ms；before 成功后应用 after；before 失败/超时最终为 `uncertain`，后续同 generation after 可收敛；每 parent buffer 上限 32 且处理后清理。
- 测试名/断言：`after 先到最终 state=completed`、`before 失败 state=uncertain`、`相同 eventId revision 不增加`、`event conflict state 不变`、`旧 generation 返回 STALE_EVENT`、`revive 后旧 complete 不覆盖`。
- 命令：RED/GREEN `bun test src/runtime/task-observer.test.ts src/runtime/task.test.ts src/tools/task/registry.test.ts src/tools/task/job-board.test.ts`。

### T3：状态机、取消与恢复一致性（Wave 3）

- Depends on：T2
- Files：`src/tools/task/job-board.ts`、`src/runtime/task-supervisor.ts`、`src/tools/task/revive.ts`、`src/tools/task/job-board.test.ts`、`src/runtime/task-supervisor.test.ts`、`src/tools/task/revive.test.ts`、`src/runtime/production-task-harness.test.ts`。
- 状态契约：host `succeeded→completed`、`failed→failed`、`interrupted→cancelled`；cancel_requested 遇 succeeded/failed 不改成 cancelled；只有 interrupted 才 cancelled；revive 为 `starting`，仅 host active=true 后为 `running`；resume 失败为 `uncertain`；CAS 失败保持原 state/revision。
- 测试名/断言：`cancel+succeeded state=completed`、`cancel+failed state=failed`、`interrupt state=cancelled`、`revive active state=running generation+1`、`resume 失败 state=uncertain`、`CAS 冲突 state/revision 不变`、`损坏主文件 backup 可恢复`、`uncertain 可重新打开`。
- 命令：RED/GREEN `bun test src/tools/task/job-board.test.ts src/runtime/task-supervisor.test.ts src/tools/task/revive.test.ts src/runtime/production-task-harness.test.ts`。

### T4：primary→subagent 消息边界与可靠性（Wave 4）

- Depends on：T3
- Files：`src/tools/task/message.ts`、`src/tools/task/job-board.ts`、`src/runtime/types.ts`、`src/tools/index.ts`、`src/tools/task/message.test.ts`、`src/tools/task/job-board.test.ts`、`src/runtime/production-task-harness.test.ts`、`src/tooling-integration.test.ts`。
- 消息契约：字段 `sequence:number,key:string,state:'pending'|'delivered'|'uncertain',attempts:number`；无 child/非 running/跨 parent/generation 在写 outbox 前拒绝；超过 32 条返回 `MESSAGE_LIMIT`；send resolve 记 delivered，send 抛错/无能力记 uncertain；每条总尝试最多 3 次；同 key retry 不新增消息；重启保留 pending。
- 测试名/断言：`无 child 不写 outbox`、`send 失败 state=uncertain`、`retry attempts<=3`、`重启保留 pending`、`sequence 严格递增`、`重复 key 不重复发送`、`超过 32 条 MESSAGE_LIMIT`、`跨 parent/generation 拒绝`。
- 命令：RED/GREEN `bun test src/tools/task/message.test.ts src/tools/task/job-board.test.ts src/runtime/production-task-harness.test.ts src/tooling-integration.test.ts`。

### T5：结果查询与 agent 协议边界（Wave 5）

- Depends on：T4
- Files：`src/tools/index.ts`、`src/tools/task/types.ts`、`src/runtime/task.ts`、`src/agents/sisyphus.ts`、`src/agents/oceanus.ts`、`src/skills/sisyphus-execute.ts`、`src/skills/sisyphus-review.ts`、`src/agents/index.test.ts`、`src/agents/orchestrator-context.test.ts`、`src/tooling-registration.test.ts`、`src/tooling-integration.test.ts`、`docs/codebase-memory-mcp.md`。
- 契约：host running/outcome 优先于 observation；旧 generation 结果不可返回；host 未确认返回 `verified:false`/`uncertain`；跨 parent 拒绝；prompt 不要求默认 queue 通知。
- 命令：RED/GREEN `bun test src/tooling-registration.test.ts src/tooling-integration.test.ts src/agents/index.test.ts src/agents/orchestrator-context.test.ts`，明确断言上述五项。

## Wave 门禁

每个 Wave 必须先完成 RED→GREEN，串行检查 diff，再进入下一 Wave；失败任务阻塞依赖任务，不修改其他文件。

## 可执行通信契约补充

- `callId` 是宿主 execute 事件的 `event.id`，同一工具调用的 before/after 必须相同；`eventId` 是 `${callId}:${phase}:${attempt}`，缺 callId/phase 不应用终态。before 建立 `callId -> {taskId,generation,beforePromise,expiresAt}`；正常处理后删除，超时后保留 10 分钟供 late event 使用，过期清理。
- barrier 从 before handler 创建时开始计时；after 先到时等待 before promise，2 秒后写入对应 task 的 `state=uncertain` 和 `pending_event`，返回 `BARRIER_TIMEOUT`；late before 成功或使用新的 `attempt` 的同 generation after 到达时再收敛；原 eventId 已应用则幂等，旧 eventId 仍返回 `STALE_EVENT`。
- 事件去重记录持久化在 JobBoard task 的 `event_log`（eventId、payload digest、generation、result kind）；同 digest 不增加 board revision，冲突返回 `EVENT_CONFLICT`；revision 指 JobBoard 顶层 revision。
- 宿主 outcome 统一由 `applyHostOutcome(taskId, generation, outcome)` 驱动：`task_status`、`task_result` 读取前、`task_cancel` interrupt 后、`task_revive` resume 后、reconcile 启动时都调用它；`session.get().outcome` 为 succeeded/failed/interrupted 分别映射 completed/failed/cancelled；`session.active(childId)===true` 是 revive 后 starting→running 的唯一确认条件；无法读取 outcome/active 保持 uncertain。测试必须 spy 断言每个入口触发该函数并持久化状态。
- 消息完整结构为 `{sequence,key,message,parentSessionId,childSessionId,generation,state,attempts,error?,createdAt,updatedAt}`；sequence 在 task 内由 JobBoard CAS 分配，key 必填且 task 内唯一，attempts 初始 0、每次实际 send 前加 1，首次及额外重试总数最多 3。`sendMessage` resolve 记 delivered，抛错写 error 并记 uncertain；delivered 不再 retry；`retryTaskMessage(taskId,key)` 显式读取模式（只需 taskId）并对 pending/uncertain 执行 retry，达到 3 返回 `RETRY_LIMIT`；重启只保留 pending/uncertain，不自动发送，显式 retry 按 sequence 发送。
- 消息写入模式必须包含 taskId、message、idempotencyKey；读取模式只需 taskId；retry 模式只需 taskId+idempotencyKey。parent 由调用 context，child/generation/state 由当前 JobBoard task 读取。无 child、parent 不匹配、generation 不匹配或 state 非 running 时返回 `TASK_NOT_LIVE/PARENT_OWNERSHIP/GENERATION_CONFLICT`，且 outbox revision 不变；无 `sendMessage` 返回 `queued_not_delivered` 并持久化 uncertain。
- 每个 Wave 采用累计回归：T1 `bun test src/runtime/task-observer.test.ts`；T2 在 T1 基础上加 `src/runtime/task.test.ts src/tools/task/registry.test.ts src/tools/task/job-board.test.ts`；T3 再加 `src/runtime/task-supervisor.test.ts src/tools/task/revive.test.ts src/runtime/production-task-harness.test.ts`；T4 再加 `src/tools/task/message.test.ts src/tooling-integration.test.ts`；T5 再加 `src/tooling-registration.test.ts src/agents/index.test.ts src/agents/orchestrator-context.test.ts`，最终 `bun test && bun run typecheck`。

## 后续人工验证（不作为本次自动完成条件）

在真实 OpenCode V2 会话中分别验证 task/subagent after、session outcome、sendMessage、resumeChild、interrupt。当前 bun 测试环境无法证明这些宿主能力；若 host 不可用，记录 degraded/skip，不能将 mock 通过当作真实通信通过。

## 风险与非目标

- 不修改 OpenCode 宿主调度器，不创建第二套 session，不把 prompt 当可靠消息队列。
- child 输出按数据处理，不直接成为 primary 指令。
- 宿主 API 形状未知时 fail-open，不伪造送达或终态。

## Momus

- 第 1 轮：REJECT（2026-08-27），契约和验收不足。
- 第 2 轮：REJECT（2026-08-27），竞态、outbox、host smoke 不够具体。
- 第 3 轮：REJECT（2026-08-27），仍有宽泛文件和未定义宿主验证。
- 第 4 轮：REJECT（2026-08-27），call/event、barrier、outbox 和 outcome 触发点仍有歧义。
- 第 5 轮：OKAY（2026-08-27）。留意：`applyHostOutcome` 定义放在已声明文件；不得越界修改 `task-reconcile.ts`/`task-control.ts`；T2 新建 `src/runtime/task.test.ts`；以累计回归命令为门禁。
