# 通用 subagent 会话复用优化设计

## 状态

已获用户批准，采用“通用 lane 复用”方案；用户确认 `taskReuse` 默认开启。

## 目标与边界

满足安全条件的 specialist 后续委派优先复用原 child session，覆盖 Momus、Oracle、Explorer、Librarian、Fixer、Designer、Observer、Metis。不复用 active、未确认终态、过期、跨 parent/workspace 或语义不一致任务。不修改宿主 subagent 调度器，不猜测任意 prompt 语义。

## 复用契约

- 标识为 `parent_session_id + workspace_root + agent + lane_key`。
- lane 必须由 Sisyphus 在 native `subagent` 的 `description` 中显式写成 `lane:<stable-key>`；缺少 agent 或 lane 不自动匹配。
- 自动候选必须是 `completed + reusable + reconciled`，certainty 为 `authoritative|observed`，child session 存在且未过 TTL；`uncertain` 只表示结果无法确认，不允许任何 revive。
- `task_reuse({agent, lane_key, brief, reuse_id})` 查询唯一候选、执行 CAS，并调用 v2 `session.prompt`、`session.wait`、`session.get` 续用原 child；不创建隐藏 session。
- 无候选、多候选、能力缺失、CAS 冲突或复用失败返回真实 `degraded/uncertain`；是否创建新 subagent 由 Sisyphus 根据结果显式决定，避免重复副作用。
- reconciliation 由 `task-reconcile` 在宿主完成且 `session.get().outcome === succeeded` 后以 CAS 收敛为 `reconciled`；随后 observer 在 enabled、child 存在等条件满足时标记 reusable。
- JobBoard parent/workspace 不一致时进入 degraded read-only；不得列出候选或写入。

## 验收

- 同 lane 的 Momus REJECT 后复用原 child，不创建第二 session；八类 specialist 均可复用。
- active/unreconciled/uncertain、缺字段、跨 parent/workspace/agent、过期、失败/取消、非唯一候选均不复用。
- prompt/wait/get 的成功、failed、interrupted、timeout、缺能力和无法确认均返回正确状态；CAS/operation 幂等有效。
- `taskReuse` 默认开启，关闭后不标记、不复用；`bun test`、`bun run typecheck`、`bun run build` 通过。
