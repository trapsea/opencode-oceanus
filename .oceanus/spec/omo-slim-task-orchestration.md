# 设计：参考 omo-slim 优化 Sisyphus 任务编排

## 状态

已获批准：采用“完整 Job Board + v2 能力适配层”的分阶段方案。

## 目标

- 让 Sisyphus 向 subagent 提供结构化、可验证的完整任务交接上下文。
- 支持子 agent 以结构化 `BLOCKED` 状态向父 Sisyphus 请求补充信息。
- 支持父子 session 的有限消息通信、显式恢复和 generation 防旧结果覆盖。
- 建立独立持久化 Job Board，支持 active、blocked、unreconciled、reusable、uncertain 等运行态。
- 保持 progress ledger 只负责计划态、验证证据和 blocker；不与 Job Board 互相冒充宿主事实。
- 以当前 OpenCode v2 API 为主；宿主能力缺失时明确 degraded，不伪造恢复成功。

## 参考实现

### oh-my-openagent

- `packages/senpi-task/src/tools/task/execute-spec.ts`：任务启动 spec 与 prompt/context 组装。
- `packages/senpi-task/src/tools/control/send.ts`：父子消息发送。
- `packages/senpi-task/src/steering/engine.ts`：pending 消息、运行中 steer/follow-up 和恢复。
- `packages/senpi-task/src/runners/in-process/child-handle.ts`：同 session follow-up/复活。

### oh-my-opencode-slim

- `src/utils/background-job-board.ts`：任务状态、lease、generation、reconcile、reusable。
- `docs/background-orchestration.md`：`task_message`、`task_revive`、状态和恢复语义。
- `src/agents/orchestrator.ts`：调度、上下文、Background Job Board 注入。
- `src/agents/task-rejection.ts`：角色越界拒绝。

参考仓库使用旧版 API；不得直接复制 v1 session 调用形状。

## 已确认决策

1. **范围**：分阶段实现完整能力，而不是只改 prompt。
2. **兼容**：v2 优先；能力不存在、超时或 malformed 时返回明确 degraded/uncertain。
3. **持久化**：Job Board 独立于 progress ledger 持久化到项目级 `.oceanus/task-board.json`；采用 schema version、临时文件写入后 rename、保留 `.bak`，读取时优先主文件，主文件损坏再尝试备份，均损坏则以空 board 启动并输出 degraded，不伪造完成状态。
4. **提问路由**：子 agent 只向父 Sisyphus 报告 `BLOCKED`；父 Sisyphus 统一使用 `question` 向用户提问。
5. **取消**：取消不等于文件回滚；恢复或替代任务前必须暴露工作区残留风险。
6. **恢复**：只提供经过 ownership、generation 和状态校验的显式恢复；不得把缺失 session 判为成功。

## Job Board schema v1

持久化文件为 `.oceanus/task-board.json`，主文件损坏时尝试 `.bak`；两者均不可用则只读 degraded 启动。顶层必填字段：`schema_version: "1"`、`board_id`、`parent_session_id`、`parent_agent: "sisyphus"`、`workspace_root`、非负 `revision`、`created_at`、`updated_at`、`tasks`。

每个任务记录至少包含：`task_id/alias/parent_session_id/child_session_id/agent/objective` 字符串、`state`、`certainty`、`reconciliation`、非负 `task_version`、非负 `generation`、`ownership`、`depends_on` 字符串数组、`created_at/updated_at/last_activity_at` Unix ms、`leases` 对象、`messages` 队列对象、`operations` operation_id 对象映射、`reusable` 布尔值和可选 `recovery: "lost"`。

- `state`：`queued | starting | running | blocked | cancel_requested | stopped | completed | failed | cancelled`；`uncertain` 不是 state，而是 `certainty`。
- `certainty`：`authoritative | observed | uncertain`。
- `reconciliation`：`unreconciled | reconciled`，不是执行状态。
- `ownership` 包含 `parent_session_id`、`owner_agent`、`file_scopes` 字符串数组、`resource_scopes` 字符串数组和可选 `lease_holder_session_id`；控制操作只允许 parent session。
- `generation` 从 1 开始；新运行/revive 递增，消息、lease、reconciliation 不改变它；旧 generation 事件只能记录 `STALE_EVENT`，不得覆盖当前状态。`task_version` 是单 task CAS 版本，任意该 task 字段/lease/message 改变时递增；`board.revision` 是全局提交版本，二者没有数值相等关系。

允许的核心转换为：`queued→starting→running`；`running→blocked|cancel_requested|completed|failed|stopped`；`cancel_requested→cancelled|completed|failed`；`blocked→starting` 仅限父 brief/用户回答驱动的 revive；`completed|failed|cancelled→starting` 仅限已 reconciliation 且 retained session 可复用的显式 revive；`stopped` 只能在宿主明确 busy/retry 时回到原 generation 的 running。宿主不确定时保持原 state 并设 `certainty=uncertain`；`reusable` 是 completed/failed/cancelled 且 reconciled、仍有 retained session 的独立布尔元数据，blocked/stopped/uncertain 不可 reusable；无法恢复时设置 `recovery=lost`。终态只能更新 reconciliation，不可被旧 generation 重新打开。

## 持久化与线性化

每次变更携带 `expected_revision` 与 `operation_id`，通过 board 级互斥/CAS 校验后才将 revision 加一。相同 operation_id 重试返回首次提交结果；相同 operation_id 搭配不同 payload 返回 `IDEMPOTENCY_KEY_REUSE`。写入顺序为同目录临时文件 → 完整写入 → fsync → rename → fsync 目录。CAS 冲突不调用宿主；临时写入/fsync/rename 失败保持旧 revision；rename 后目录 fsync 失败返回 `COMMIT_UNKNOWN`，通过 operation_id/revision 重读确认。

取消、消息和恢复遵循“准备持久化 → 宿主调用 → 持久化结果”；准备失败不产生宿主副作用，宿主成功但结果持久化失败则保持 unknown，等待 reconciliation。

## 通信边界

`task_message` 按 UTF-8 字节限制为 1–8192 字节，每 task/generation 最多 32 条 pending 消息，TTL 24 小时，使用单调 sequence FIFO 和 message id 幂等。只允许父向当前 generation 的 running child 发送，不隐式启动、恢复、取消。`blocked` 任务保存 `BlockedRequest`、关联 task/message id 和父 session；用户回答后通过原 task 的新 generation 恢复。

`task_revive` 只允许 parent owner 对 `blocked/reusable` 任务调用；先 CAS 递增 generation 并持久化，再调用宿主。宿主失败标记 `uncertain`，不创建隐藏 session。

## v2 capability 结果

适配器只暴露项目自有结果类型，不暴露 omo-slim/v1 nested session API。`session.active`/`session.get.outcome` 映射 status，interrupt 后必须重新读取 status；缺少 message 能力时返回 `degraded: queued_not_delivered`，缺少 revive/prompt 能力时返回 `degraded: unsupported`，malformed/timeout 返回 `uncertain`，不得伪造送达、完成或恢复成功。

## 事实源优先级

| 信息 | 第一事实源 | 次级来源 | 不确定时 |
|---|---|---|---|
| session 是否运行 | v2 宿主 session API | Job Board 的 last-known 状态 | `uncertain` |
| 任务终态 | 宿主 outcome/result | observer/TaskRegistry 摘要 | 不得标记 completed |
| 任务元数据 | Job Board | TaskRegistry 本地索引 | 保留原记录并 degraded |
| 计划验证证据 | progress ledger | Job Board 的 result 摘要 | 不互相覆盖 |

TaskRegistry 只提供进程内索引和 fallback 线索；宿主不可用时必须标记 `verified: false`。

## 通信与线性化契约

- `task_message`：单条最多 8 KiB、每 task pending 队列最多 32 条、TTL 24 小时；按 sequence FIFO 投递，message id 幂等；只允许 parent→child，不能隐式 revive/interrupt。
- 任务进入 `blocked` 时保存 `BlockedRequest`、关联 message/task id 和父 session；补充信息只能通过原 task 的 follow-up/revive 进入。
- `task_revive`：只允许 parent owner 对 `blocked` 或 `reusable=true` 任务调用，并必须携带 `resume_id`、`brief`、`expected_board_revision`、`expected_task_version` 和 `expected_generation`；先 CAS 写入 continuation brief、状态 starting 并递增 generation，再调用宿主。宿主失败保留 starting/uncertain，不创建隐藏 session；blocked 不使用 task_message 承载回答。
- 所有写入使用 `expected_board_revision + expected_task_version`，运行相关操作另需 `expected_generation`；旧 generation 的消息、终态和恢复结果被拒绝并保留诊断。相同 operation_id 重试返回首次结果，不重复副作用；不同 payload 返回 `IDEMPOTENCY_KEY_REUSE`。
- `cancel` 与 `revive` 竞争时以先成功线性化的状态转换为准；取消后的迟到完成不能覆盖 cancelled，且不声明文件已回滚。

## v2 capability adapter 映射

- `status`：映射当前 v2 `session.active`/`session.get.outcome`；缺失返回 `unsupported`。
- `interrupt`：映射 v2 session interrupt；完成后重新读取 status 验证。
- `message`：v2 没有父子消息 API 时保留 pending 队列并返回 `degraded: queued_not_delivered`，不得声称已送达。
- `revive`：v2 没有 session resume/prompt API 时返回 `degraded: unsupported`，不创建新 session。
- 不暴露 omo-slim/v1 的 nested session API；适配器只输出当前项目自己的 capability/result 类型。

## 生产接线契约

- `runSetup` 只创建一个 `JobBoard` 实例，并将同一对象传给 `registerOceanusTools`、`registerOceanusHooks`、observer 和 supervisor；production harness 必须断言捕获到的对象引用 `===`。
- `task_message` 必须从 board 读取任务，校验 parent session、child session、当前 generation 和 `running` 状态；不得信任调用参数中的 `taskStatus`。入队通过 board CAS 写回 `messages`，递增 `task_version` 与 `board.revision`，重启后保留 FIFO/TTL；无宿主消息 API 返回 `degraded: queued_not_delivered`。
- `task_revive` 必须接收 `resume_id`、`brief`、`expected_board_revision`、`expected_task_version`、`expected_generation`、`operation_id`；先 CAS 写入 continuation brief、`starting` 和新 generation，再调用 `resumeChild({ childSessionId, resumeId, brief, generation })`，不得创建新 session。能力缺失返回 `degraded: unsupported`，调用或结果持久化失败设 `certainty=uncertain`。
- `task_cancel` 仅允许 parent session：先 CAS `running→cancel_requested`，调用 `interrupt({ childSessionId, generation })`，重读 host status，再 CAS 收敛到 `cancelled/completed/failed` 或保留 `certainty=uncertain`；迟到结果按 generation 拒绝。
- `board.revision` 是唯一顶层版本；task 保存 `last_board_revision`，与 `task_version` 一起作为 CAS 输入。提交前重读主文件，并用 board mutex/锁文件或等价机制串行化跨实例操作。

## 分阶段能力

### 阶段一：契约与能力适配

- 定义 `DelegationBrief`、`BlockedRequest`、任务状态、结果和能力降级契约。
- 增加 v2 host capability adapter，隔离 session/status/message/revive/interrupt 差异。
- 固定 fixer、Sisyphus 和 task 工具的输出格式。

### 阶段二：独立 Job Board

- 记录 task ID、alias、parent/root session、agent、objective、owner、generation、state、certainty、result 摘要、时间戳和恢复元数据。
- 持久化写入采用原子更新或等价保护，启动时 rehydrate。
- Job Board 是运行态投影，不替代宿主真实状态；宿主状态优先。

### 阶段三：交接与阻塞

- 委派时必须生成 Delegation Brief，不能只引用父会话上下文。
- 子 agent 上下文不足时返回 `STATUS: BLOCKED`、问题、影响和已检查范围。
- 父 agent 可补充 brief 并恢复同一 task，不重复创建任务。

### 阶段四：父子通信

- 增加有限长度、非中断的 `task_message`/等价能力。
- 运行中消息进入 pending 队列；终态、错误 task、越权和过期 generation 返回明确错误。
- 消息不得隐式启动、恢复、取消或创建任务。

### 阶段五：恢复与监督

- 增加显式 `task_revive`/等价恢复入口。
- generation 递增；旧结果、旧消息、旧恢复请求不得覆盖当前 generation。
- 区分 stopped、cancelled、uncertain、unreconciled、reusable 和 lost。
- 重启后只恢复可验证任务；无法恢复的任务保留不确定状态并提示父 agent。

### 阶段六：运行时整合

- Job Board 注入 Sisyphus prompt，提供 active/unreconciled/reusable 任务摘要。
- observer、终态通知、task result/status 和 progress ledger 建立明确边界。
- 加入 v2 host smoke、竞态、持久化和能力缺失测试。

## 明确非目标

- 不修改 OpenCode 宿主 task 调度器或外部 session 服务。
- 不直接实现旧版 OpenCode API 的完全兼容。
- 不允许子 agent 直接向用户发问。
- 不把 prompt/skill 文案当作运行时硬保证。
- 不自动回滚子 agent 已修改的文件。
- 不把 progress ledger 改造成完整运行态数据库。
- 不在宿主能力缺失时静默模拟成功。

## Metis 分析

### 需求缺口

- 当前 task 三件套缺少消息、恢复、generation 和 Job Board。
- 当前 fixer 没有正式交接或 BLOCKED 协议。
- v2 宿主 session API 与参考仓库不一致，必须隔离适配。
- 需要明确 Job Board、宿主状态和 progress ledger 的事实优先级。

### 风险

- 宿主状态、TaskRegistry、Job Board 和 ledger 多重事实源冲突。
- 取消、终态通知、恢复和延迟结果乱序。
- 没有 generation/lease 会导致重复执行或旧结果覆盖。
- 持久化失败、重启和 orphan session 可能造成任务丢失。
- 共享工作区中的取消不会回滚已写入文件。
- 直接移植 omo-slim v1 API 可能编译通过但运行失败。

### 边界与非目标

- v2 优先、能力降级；不修改宿主调度器。
- 子 agent 只向父 Sisyphus 报阻塞。
- 取消不回滚文件。
- progress ledger 保持计划态职责。

### 反例与边界条件

- 空 task ID、错误 task ID、空 child session、越权 parent session 必须拒绝。
- 任务已终态后发送消息必须失败，不得隐式 revive。
- 不同 generation 的旧结果和恢复响应必须被丢弃。
- 宿主 status 缺失、超时、malformed 时标记 uncertain/degraded。
- 重启期间任务状态不明时不得标记 completed。
- Job Board 文件损坏时必须保留备份/降级，不阻塞其他插件功能。

### 可验证验收标准

1. 委派 prompt 可测试地包含目标、背景、决策、Files、禁区、依赖、验收和测试命令。
2. 上下文不足的子 agent 返回结构化 BLOCKED，不猜测、不越权修改。
3. 父 agent 可向同一 task 发送补充消息，不创建重复 task。
4. Job Board 独立持久化并能重启 rehydrate，状态不覆盖 progress ledger。
5. ownership、generation、终态、取消和恢复竞态均有测试。
6. 宿主能力缺失时返回明确 degraded/uncertain。
7. 旧结果不会覆盖新 generation，重复恢复不会重复执行。
8. 全量测试、类型检查、构建和 v2 host smoke 通过；真实宿主不可用时诚实记录降级证据。
