# 原生 subagent 会话复用

## 目标

让返回明确 child `sessionID` 的原生 `subagent` 调用进入受控的 Job Board 生命周期；完成且对账后，`task_reuse` 可在同一 child session 中执行后续 brief。

## 已确认事实

- `src/runtime/task-observer.ts` 当前只为 `subagent` 创建 diagnostic registry 条目（:327-330），并在 after 处理器中排除它（:343-345）。
- `task_reuse` 只接受同父 session、同 agent/lane 且 `completed + reconciled + reusable` 的 Job Board 记录（`src/tools/task/reuse.ts:20-24`）。
- 因此刚才由原生 `subagent` 产生的 `ses_fb9ca9a82ffe8Se0f1LfuKoapr` 从未进入可复用池，调用返回 `NO_REUSABLE_TASK`。
- oh-my-opencode-slim 先登记原生任务，再在终态完成对账后用相同任务 ID 续跑；参考位置：`src/hooks/task-session-manager/tool-execute-hooks.ts:136-183`、`src/tools/task-revive.ts:96-131`。

## 设计

1. `subagent` after 事件返回明确、非父会话的 child `sessionID` 时，将该 ID 同时作为受控任务 ID 与 `child_session_id` 写入 Registry 和 Job Board。
2. only 在 `taskReuse.enabled`、任务 `completed`、已 `reconciled`、并通过同 agent、同 lane、同父会话过滤时标记和选择为 reusable。
3. 结果缺少明确 child session ID、状态未完成或未对账时，保持 fail-open 且不可复用；不从 input 或调用 ID 猜测 session。
4. 不改变原生 `task` 的既有路径，也不允许跨父会话或跨 lane 续用。

5. 调度规则仅禁止对已登记且 active/unreconciled 的同 lane 任务重复 fallback。若 `task_reuse` 返回 `NO_REUSABLE_TASK` 且没有同 lane 的受控任务，允许一次原生 fallback；该规则必须在编排提示词中明确，避免未登记原生 `subagent` 造成死锁。

## 非目标

- 不将任意裸 session ID 直接作为可复用候选。
- 不绕过 Job Board 的所有权、CAS、generation 和 reconciliation 检查。
- 不允许已登记的 active/unreconciled 任务绕过 Job Board 再次 spawn。
- 不修改 oh-my-opencode-slim；它只提供生命周期设计参考。

## Metis 分析

未执行：候选方案已由用户明确选择，实施边界局部且无剩余架构分歧。残余风险是宿主 `subagent` after 事件形状；实现必须仅接受明确输出字段，并以测试固定该形状。

## 验收标准

1. `subagent` 返回的明确 child `sessionID` 可建立受控 Job Board 记录。
2. 任务完成、对账并启用复用后，`task_reuse` 能对同一 child session 投递第二个 brief。
3. 未对账、跨父会话、不同 agent/lane、或没有明确 session ID 的情况不能复用。
4. 相关 Bun 测试与 `bun run typecheck` 通过。
5. 编排提示词明确区分“已登记但未对账”的任务与“未登记、无可复用候选”的任务；后者可进行一次 fallback。
