# 通用 subagent 会话复用优化计划

## 执行约束
- TDD：每项先 RED、再 GREEN、最后全量验证。
- 共享工作区串行；不创建 Worktree，不修改无关未提交文件。
- task_reuse 失败由 Sisyphus 做一次 native fallback，工具不创建新 session。

## 统一契约
- agent 只来自 native subagent input.agent；lane 只来自 description 中唯一 `lane:<stable-key>`，stable-key 为 `[A-Za-z0-9._/-]+`；缺失/非法/重复不自动复用。
- 自动候选要求 parent/workspace/agent/lane 全匹配、state=completed、reusable=true、reconciliation=reconciled、certainty=authoritative|observed、child 存在且未过 TTL；failed/cancelled/uncertain 不进自动候选。
- task_revive 只允许 parent owner 恢复 blocked（child 非空且未过 TTL），或 completed/failed/cancelled 且 reusable=true、reconciled、child 非空且未过 TTL；uncertain/running/stopped/NOT_RETAINED 拒绝。容量为 maxRetained 个 reusable，按 last_activity_at 降序保留；uncertain 仅诊断值，绝不 revive。
- JobBoard `open({workspaceRoot,parentSessionId})` 绑定两者，持久化任一不匹配即 degraded；degraded 下 tasks/get/messages/listReusable 固定返回 []/undefined/[]/[]，recordEvent/replace/transition/appendMessage/updateMessage/applyObservedEvent/revive 固定抛 BOARD_OWNERSHIP_MISMATCH 且不写盘；正常路径逐方法校验任务归属，缺失任务抛 TASK_NOT_FOUND。
- task_reuse 输入 brief 必须为非空 UTF-8 字符串且≤32 KiB。canonical payload 是字段顺序固定的 `{agent,lane_key,brief}` JSON；reuse_id 同 operation_id。调用前写 `task.operations[id]={request:canonicalPayload,status:'started'}`，结果提交后原子更新为 `{request,status:'completed'|'uncertain'|'conflict',response}`；若已有 started，任务 state/certainty/reconciliation 不再变更，写入 response={七字段，code:'OPERATION_IN_FLIGHT'}，禁止再次调用宿主；后续同 payload replay 该 response+IDEMPOTENCY_REPLAY。相同 payload replay 原响应七字段，冲突 payload 也返回七字段、保留原状态并 code=IDEMPOTENCY_KEY_REUSE，且不调用宿主。选择失败时 task_id=undefined（CAS 冲突除外，使用候选 task_id），state=starting、certainty=uncertain、reconciliation=unreconciled；无候选/多候选/归属不符/能力缺失分别 code=NO_CANDIDATE/AMBIGUOUS/BOARD_OWNERSHIP_MISMATCH/UNSUPPORTED，result.reason 固定为 no_candidate/ambiguous/ownership_mismatch/unsupported。

## R1 — JobBoard 与 observer 的 lane/reusable 契约
- Wave: 1；Depends on: []
- Files: `src/tools/task/types.ts`, `src/tools/task/job-board.ts`, `src/runtime/task-observer.ts`, `src/runtime/task-reconcile.ts`, `src/runtime/types.ts`, `src/tools/task/job-board.test.ts`, `src/runtime/task-observer.test.ts`, `src/runtime/task-reconcile.test.ts`（均已存在）
- 目标：补字段、listReusable、reconciled→reusable CAS、TTL/maxRetained、atomic write/backup/restart、跨实例锁、旧 generation、cancel/revive 竞争和全部方法守卫。
- RED/完成证据：逐项测试 owner/workspace/缺失/degraded 行为及可复用状态矩阵；命令为 `bun test src/tools/task/job-board.test.ts src/runtime/task-observer.test.ts src/runtime/task-reconcile.test.ts`。

## R2 — 通用 task_reuse 与 v2 session 续用
- Wave: 2；Depends on: [R1]
- Files: `src/runtime/task-capabilities.ts`, `src/tools/task/revive.ts`, `src/tools/task/reuse.ts`（新增）, `src/tools/index.ts`, `src/runtime/types.ts`, `src/runtime/task-capabilities.test.ts`, `src/tools/task/revive.test.ts`, `src/tools/task/reuse.test.ts`（新增）
- 目标：以 board.revision+task_version+generation+operation_id CAS 转 starting；prompt、wait、get 各自 30 秒（总计 90 秒），严格 prompt→wait→get。调用返回必须是对象且 ok===true；非对象/缺 ok/字段类型错误为 MALFORMED，ok===false 为异常。prompt 的 MALFORMED/异常/timeout/unsupported 分别 PROMPT_MALFORMED/PROMPT_UNCERTAIN/PROMPT_TIMEOUT/PROMPT_UNSUPPORTED；wait 同理 WAIT_MALFORMED/WAIT_UNCERTAIN/WAIT_TIMEOUT/WAIT_UNSUPPORTED，任一 wait 失败不调用 get；get timeout/exception/unsupported/无 outcome/malformed→OUTCOME_UNCERTAIN；上述失败均为 starting/unreconciled/uncertain 且 result={phase,reason,hostOutcome?}。get succeeded→completed/reconciled/authoritative/OK，failed→failed/reconciled/authoritative/CHILD_FAILED，interrupted→cancelled/reconciled/authoritative/CHILD_INTERRUPTED。提交失败重读：已提交返回原七字段+COMMIT_CONFIRMED，operation 为 completed；未提交返回七字段诊断+COMMIT_UNKNOWN，operation 保留 started，后续同 reuse_id 返回 OPERATION_IN_FLIGHT，不重试宿主。
- RED/完成证据：逐项断言 7 个响应字段 `{ok,task_id,state,certainty,reconciliation,code,result}`、调用顺序、operation 的 started→终态写入、重读与 replay；命令为 `bun test src/tools/task/reuse.test.ts src/runtime/task-capabilities.test.ts src/tools/task/revive.test.ts`。

## R3 — Sisyphus/Oceanus 调度协议、注册与配置
- Wave: 3；Depends on: [R1,R2]
- Files: `src/index.ts`, `src/hooks/index.ts`, `src/runtime/workspace.ts`, `src/runtime/types.ts`, `src/agents/orchestrator-context.ts`, `src/agents/sisyphus.ts`, `src/agents/oceanus.ts`, `src/skills/stages.test.ts`（已存在）, `src/config/utils.ts`, `src/config/schema.ts`, `README.md`, `src/agents/orchestrator-context.test.ts`（已存在）, `src/agents/index.test.ts`（已存在）, `src/config/tooling.test.ts`（已存在）, `src/tools/reuse-registration.test.ts`（新增）
- 目标：新增 resolveWorkspaceRootOrCwd（session.get location.directory 优先，缺失回退 cwd）；传递绑定 board/session/workspace；提示明确 lane、先 task_reuse 后 native subagent，失败仅一次 fallback；缺省 enabled 改 true，显式 false 保持关闭，关闭时 observer 标记、候选查询、task_reuse 均不生效。
- RED/完成证据：八类 specialist 各用固定 `lane:<agent>.review` 验证同 lane，Momus REJECT 后原 child；不同 lane、并行、关闭配置、注册、fallback、第二 session、workspace 回退断言通过。命令为 `bun test src/tools/reuse-registration.test.ts src/agents/orchestrator-context.test.ts src/agents/index.test.ts src/config/tooling.test.ts`。

## Ledger 映射

`.oceanus/progress/subagent-session-reuse.md` 且仅含 R1/R2/R3 三行；每行已记录同名 Task ID、Wave、Depends on、Files、State、Worker/Session、Validation evidence、Updated。初始 pending，启动前 in_progress，主 Agent 按 R1/R2/R3 各自命令及最终 `bun test && bun run typecheck && bun run build` 验证后 completed/failed/blocked；依赖严格 R1→R2→R3。

## 门禁记录
- Momus 第 1-10 轮：REJECT；已补齐 revive 边界、方法行为、完整状态/响应/operation/超时/replay 契约和 ledger 验证。
- 用户决策：默认开启 taskReuse；失败由 Sisyphus 回退；共享工作区串行、TDD。
- 人工批准：待最终 Momus OKAY 后确认。
- 追加集成（R1-R3 终态后）：新增 `src/runtime/dispatch-guard.ts` 派发纪律守卫——① 角色冒名拦截（prompt「你是 X」而 agent≠X 直接拒绝并指路原生名+task_reuse）；② 同目标终态未消费重派断路器（task_result 消费后放行，`last_used_at` 标记）；observer.before 接线、board 记录增补 `objective_key`、门禁文案追加派发纪律三条。依据：slim #1070 范式对比；全量 `bun test` 978 pass / 0 fail + typecheck 通过。
