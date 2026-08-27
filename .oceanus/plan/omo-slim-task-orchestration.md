# Plan：参考 omo-slim 优化 Sisyphus 任务编排

## 状态

- TDD：严格 RED → GREEN → SURFACE
- Worktree：当前共享工作区；并行任务文件完全不重叠，worker 不执行 git/Worktree 操作，不修改 ledger
- 目标：在当前 OpenCode v2 契约上实现 omo-slim 风格的交接、阻塞、Job Board、父子通信和显式恢复
- Momus：OKAY

## 事实边界

- 宿主 session/status 是运行事实；Job Board 是持久化运行态投影；TaskRegistry 是轻量本地索引；progress ledger 是计划/验证账本。
- v2 能力缺失、超时或 malformed 只能产生 degraded/uncertain，不得伪造成功。
- 子 agent 只向父 Sisyphus 返回 BLOCKED；用户问题由父 Sisyphus 统一发起。
- 取消不回滚工作区修改。

## 任务图

### Wave 1：RED——契约与现状基线

#### T1：定义编排领域类型与 Delegation Brief 测试

- Files：`src/tools/task/types.ts`、`src/tools/task/protocol.ts`、`src/tools/task/protocol.test.ts`
- Depends on：无
- Goal：定义 `DelegationBrief`、`BlockedRequest`、任务运行态、结果确定性、generation 和能力状态的最小类型/校验契约；先补目标失败测试。
- Validation：`bun test src/tools/task/protocol.test.ts`；缺失目标、Files、验收、阻塞问题和非法 generation 均按预期 RED。

#### T2：Job Board 持久化模型与竞态测试

- Files：`src/tools/task/job-board.test.ts`（仅 RED 测试；T5 负责同文件 GREEN 实现）
- Depends on：T1
- Goal：先固定 `.oceanus/task-board.json` schema v1、`.bak` 恢复、atomic rename、损坏/权限/未知 schema、状态机、ownership、generation、reconcile、reusable/unreconciled 和并发写测试；不接入入口。
- Validation：`bun test src/tools/task/job-board.test.ts`；逐项记录截断 JSON、损坏备份、未知 schema、写失败、旧 generation、并发更新和空结果 RED。

#### T3：父子通信/恢复工具契约测试

- Files：`src/tools/task/message.test.ts`、`src/tools/task/revive.test.ts`（仅 RED 测试；T6 负责同文件 GREEN 实现）
- Depends on：T1
- Goal：先固定 `task_message` 的 8 KiB/32 条/24 小时 FIFO 幂等队列，`task_revive` 的 blocked/reusable 边界、generation 先持久化再调用宿主和 v2 degraded 行为。
- Validation：`bun test src/tools/task/message.test.ts src/tools/task/revive.test.ts`；覆盖运行中、终态、错误 ID、越权、空 session、旧 generation、队列溢出/过期和宿主能力缺失 RED。

#### T4：Delegation Brief 与 BLOCKED prompt 基线测试

- Files：`src/agents/orchestrator-context.test.ts`、`src/agents/index.test.ts`（仅 RED 测试；T8 负责 prompt 实现）
- Depends on：T1
- Goal：先固定 Sisyphus 委派 brief 生成规则、fixer 接收边界、BLOCKED 输出格式和“不得直接问用户/不得猜测”语义；brief 必须含目标、背景、决策、Files、禁区、依赖、验收和测试命令。
- Validation：`bun test src/agents/orchestrator-context.test.ts src/agents/index.test.ts`；断言 prompt 不得只引用上文，且包含目标/背景/Files/禁区/验收/测试/阻塞格式。

### Wave 2：GREEN——基础能力实现

#### T5：实现独立持久化 Job Board

- Files：`src/tools/task/job-board.ts`、`src/tools/task/job-board.test.ts`、`src/config/task-state.ts`、`src/config/task-state.test.ts`
- Depends on：T1、T2
- Goal：实现 `.oceanus/task-board.json` schema v1、临时文件 rename、`.bak` fallback、未知 schema/截断 JSON/权限和磁盘失败的 degraded 读取写入、rehydrate、ownership/generation/lease/reconcile；不修改 progress ledger 语义。T2 与 T5 为同一文件的顺序 ownership，不能并行。
- Validation：`bun test src/tools/task/job-board.test.ts src/config/task-state.test.ts`；逐项通过 schema 字段、状态转换、`.bak` fallback、CAS_CONFLICT、PERSISTENCE_UNAVAILABLE、COMMIT_UNKNOWN、operation 幂等和不伪造 completed 断言。

#### T6：实现 v2 capability adapter 与消息/恢复服务

- Files：`src/runtime/task-capabilities.ts`、`src/runtime/task-capabilities.test.ts`、`src/tools/task/message.ts`、`src/tools/task/message.test.ts`、`src/tools/task/revive.ts`、`src/tools/task/revive.test.ts`、`src/runtime/task-control.ts`、`src/runtime/task-control.test.ts`；T3 测试文件由 T6 顺序接管 GREEN ownership
- Depends on：T1、T3、T5
- Goal：封装当前 v2 `session.active`/`session.get.outcome`/interrupt/follow-up 能力；实现有限非中断消息、pending 队列、显式 revive、`expected_board_revision + expected_task_version + expected_generation` 条件、BLOCKED continuation brief、generation 先持久化再调用宿主、终态/不确定/降级边界；不得隐式启动或恢复，不暴露 v1 API。blocked 可 revive，stopped/uncertain 不可 revive，终态仅在 reusable=true 时 revive。
- Validation：`bun test src/runtime/task-capabilities.test.ts src/tools/task/message.test.ts src/tools/task/revive.test.ts src/runtime/task-control.test.ts`；覆盖 `queued_not_delivered`、`unsupported`、malformed/timeout→uncertain、interrupt 后 status 重读、revive 不创建新 session、generation 先持久化和旧结果拒绝。

#### T7：接入 task 工具、observer 与终态通知

- Files：`src/tools/index.ts`、`src/runtime/task-observer.ts`、`src/runtime/task.ts`、`src/runtime/task-notification.ts`、`src/hooks/index.ts`、`src/tools/index.test.ts`、`src/runtime/task-observer.test.ts`、`src/runtime/task.test.ts`、`src/runtime/task-notification.test.ts`、`src/tooling-integration.test.ts`、`src/tooling-registration.test.ts`、`src/smoke/host-smoke.test.ts`
- Depends on：T5、T6
- Goal：增加 `task_message`/`task_revive` 注册；observer 将宿主事件写入 Job Board；status/result/cancel 使用清晰事实优先级；终态结果通知父 session；保持旧三件套兼容。
- Validation：`bun test src/tools/index.test.ts src/runtime/task-observer.test.ts src/runtime/task.test.ts src/runtime/task-notification.test.ts src/tooling-integration.test.ts src/tooling-registration.test.ts src/smoke/host-smoke.test.ts`；覆盖宿主事实优先、registry fallback `verified:false`、终态通知、重复事件、message/revive 注册、错误 ID、越权、旧三件套兼容和更新后的 v2 工具注册契约。

#### T8：接入 Sisyphus 调度与交接上下文

- Files：`src/agents/orchestrator-context.ts`、`src/agents/sisyphus.ts`、`src/agents/fixer.ts`、`src/agents/oceanus.ts`、`src/agents/index.ts`、`src/agents/index.test.ts`；T4 测试由 T8 顺序接管 GREEN ownership
- Depends on：T4、T6、T7
- Goal：委派前生成 Delegation Brief；将 Job Board active/unreconciled/reusable 摘要注入 Sisyphus；fixer 缺信息返回 BLOCKED；父 agent 通过 message/revive 继续同一任务，不重复创建。
- Validation：`bun test src/agents/orchestrator-context.test.ts src/agents/index.test.ts`；覆盖 BLOCKED→父提问→同 task 新 generation、不会直接问用户、Job Board 摘要注入和不会重复创建任务。

### Wave 3：GREEN——运行时恢复与监督

#### T9：实现重启恢复、监督与 reconcile

- Files：`src/runtime/task-supervisor.ts`、`src/runtime/task-supervisor.test.ts`、`src/runtime/task-reconcile.ts`、`src/runtime/task-reconcile.test.ts`、`src/index.ts`
- Depends on：T5、T6、T7、T8
- Goal：启动时 rehydrate Job Board，按 `parent_session_id`/`owner_agent` 防 foreign owner，区分 active、stopped、unreconciled、reusable/lost 和 `certainty=uncertain`；实现显式恢复、超时/lease 和旧结果防护。测试使用 fake clock、固定 revision/task_version/operation_id 和明确事件交错；stopped/uncertain 不可 revive，blocked/终态 reusable 才可 revive。
- Validation：`bun test src/runtime/task-supervisor.test.ts src/runtime/task-reconcile.test.ts src/smoke/host-smoke.test.ts`；固定覆盖 cancel-before-host、cancel-vs-complete、cancel-late-complete、cancel-unknown、cancel-reconcile、revive-vs-cancel、revive-persist-failure、message-vs-terminal、generation stale event、foreign owner、重复恢复和宿主不可用降级。

#### T10：progress ledger 与 Job Board 边界审计

- Files：`src/tools/task/ledger-bridge.ts`、`src/tools/task/ledger-bridge.test.ts`、`README.md`
- Depends on：T5、T8、T9
- Goal：明确 Job Board 与 progress ledger 的关联字段和单向证据同步，禁止状态静默覆盖；更新用户文档和迁移说明，移除过时的 task_message/task_revive 非目标声明。
- Validation：`bun test src/tools/task/ledger-bridge.test.ts`；运行 `grep -n "task_message\|task_revive\|Job Board\|progress ledger\|不回滚\|degraded" README.md`；确认只同步 task ID/状态摘要/验证证据，不反向覆盖运行态。

### Wave 4：SURFACE——全量回归与宿主验证

#### T11：全量测试、构建和 v2 host smoke

- Files：仅生成 `dist/**`；`src/smoke/host-smoke.test.ts` 只运行、不修改；不重新拥有前序源码文件
- Depends on：T7、T9、T10
- Goal：执行全量测试、类型检查、构建、dist skill 校验、diff 检查和当前 v2 host smoke；汇总真实宿主能力缺失的降级证据。
- Validation：`bun test`、`bun run typecheck`、`bun run build`、`bun scripts/verify-dist-skills.ts`、`git diff --check`；所有可运行检查通过，skip 项有明确原因。

### Wave 5：Review 修复——生产链路闭合

#### T12：接入 Job Board、真实 task 控制与 CAS 线性化

- Files：`src/index.ts`、`src/index.test.ts`、`src/tools/index.ts`、`src/hooks/index.ts`、`src/runtime/types.ts`、`src/tools/task/types.ts`、`src/tools/task/job-board.ts`、`src/tools/task/job-board.test.ts`、`src/tools/task/message.ts`、`src/tools/task/message.test.ts`、`src/tools/task/revive.ts`、`src/tools/task/revive.test.ts`、`src/runtime/task-capabilities.ts`、`src/runtime/task-capabilities.test.ts`、`src/runtime/task-control.ts`、`src/runtime/task-control.test.ts`、`src/runtime/task-observer.ts`、`src/runtime/task-observer.test.ts`、`src/runtime/task-supervisor.ts`、`src/runtime/task-reconcile.ts`、新增 `src/runtime/production-task-harness.test.ts`；不修改 agent prompt、README、progress ledger 或 host smoke。
- Depends on：T5、T6、T7、T9、T10
- Goal：用新增 `production-task-harness.test.ts` 验证真实 `runSetup` 注册链路：同一 board 注入 tools/hooks/observer/supervisor；message board CAS 写回、忽略伪造 taskStatus、rehydrate 保留队列和无 host API 的 degraded；revive 持久化 continuation brief 后调用 `resumeChild`；cancel 先 board CAS 再 interrupt、重读 status、最终 CAS 收敛；补齐 schema、唯一 revision、task_version、锁/CAS、operation 幂等、atomic rename/backup/fsync 失败语义。
- Validation：先补失败 harness/边界测试再实现；`bun test src/runtime/production-task-harness.test.ts src/tools/task/job-board.test.ts src/tools/task/message.test.ts src/tools/task/revive.test.ts src/runtime/task-capabilities.test.ts src/runtime/task-control.test.ts src/runtime/task-observer.test.ts src/runtime/task-supervisor.test.ts src/runtime/task-reconcile.test.ts src/tooling-integration.test.ts src/tooling-registration.test.ts`；断言对象引用 `===`、错误 taskStatus 被拒、消息 revision/version 递增且重启保留、`queued_not_delivered`、真实 `resumeChild` 参数/失败收敛、cancel 线性化和 stale generation 拒绝。

#### T13：重新执行全量 SURFACE 与独立生产链路审计

- Files：仅验证/生成 `dist/**`；只运行不修改 `src/runtime/production-task-harness.test.ts`、`src/smoke/host-smoke.test.ts`；不修改源码、其他测试、文档或 ledger。
- Depends on：T12
- Goal：复跑 T12 创建的 production harness 和 host smoke，验证真实注册入口、hooks、observer 与构建产物；不把 skill 校验当作 production harness。
- Validation：`bun test src/runtime/production-task-harness.test.ts src/smoke/host-smoke.test.ts`、`bun test`、`bun run typecheck`、`bun run build`、`bun scripts/verify-dist-skills.ts`、`git diff --check`；宿主能力缺失仅接受明确 degraded/skip 证据。

## 并行调度

- Wave 1：T1 独立；T2/T3/T4 需按依赖执行。T2 与 T3 在 T1 完成后可并行，但文件不重叠。
- Wave 2：T5 完成后，T6 可继续；T7 等 T5/T6；T8 等 T4/T6/T7。
- Wave 3：T9 后置串行；T10 可在 T9 完成后执行；T11 原 SURFACE 已执行但 Review 未通过。
- Wave 5：T12 串行修复生产链路；T13 最后执行。
- 所有共享工作区 worker 禁止 git add/commit/reset、分支/worktree 操作和修改声明外文件。

## Momus

- Verdict：首轮、二轮 REJECT；revision 4、5 复审 OKAY
- Revision：5；补充 production harness、message/revive/cancel 真实接线、capability 参数、消息持久化/CAS 和唯一 revision 契约；复审通过
