# 原生 subagent 会话复用计划

关联 spec：`.oceanus/spec/subagent-session-reuse.md`

## 文件映射

- `src/runtime/task-observer.ts`：将明确的 `subagent` child session 输出接入现有 Job Board/Registry 终态、宿主确认和复用流程。
- `src/runtime/task-observer.test.ts`：为 `subagent` 观察、对账与 reusable 条件先写 RED 测试。
- `src/tools/task/reuse.test.ts`：验证同父/agent/lane 的可复用记录能传递至 adapter，及拒绝条件。
- `src/runtime/task-reconcile.ts`、`src/runtime/task-reconcile.test.ts`：使重启恢复路径采用与 observer 相同的 child ID 和 parent 归属核验。
- `src/runtime/task-supervisor.ts`、`src/runtime/task-supervisor.test.ts`、`src/index.ts`、`src/index.test.ts`：将 resolved `taskReuse.enabled` 从插件启动接线传入恢复路径并固定其生效。
- `src/agents/sisyphus.ts`、`src/agents/oceanus.ts`、`src/agents/orchestrator-context.ts`：统一 fallback 的受控任务豁免规则。
- `src/agents/index.test.ts`、`src/agents/orchestrator-context.test.ts`：固定三份提示词契约。

## 执行策略

- TDD：先执行 T1，使新增行为失败；T2 实现最小逻辑使其转绿；T3 执行全部定向验证。
- 当前工作区已有用户未提交修改，且三个任务有顺序依赖；建议共享工作区、串行执行，不创建 worktree。
- T1 前对所有允许编辑文件执行 `git diff -- <files>` 并保存基线；仅以追加式测试和窄 hunk 编辑变更，T6 逐文件对比基线确认不覆盖既有改动。
- 受控 ID 不变量：仅当 `tool: subagent` 的 result 中有明确、非空、非父的顶层 `sessionID` 时，使用该值同时作为 `task_id` 和 `child_session_id`；其他 `sessionID` 保持诊断级或忽略。
- 元数据来源：`agent` 仅取 `event.input.agent` 的非空字符串；`lane_key` 仅由 `event.input.description` 中唯一合法的 `lane:<stable-key>` 提取。缺任一字段的记录可被观测，但不能成为 `task_reuse` 候选。
- 完成后的对账触发：observer 收到 completed 后，使用宿主 `session.get(child_session_id)` 核验 `outcome === succeeded`、返回 `id === child_session_id`、且 `parentID === event.sessionID`；三者都匹配后才以 CAS 写入 `reconciliation: reconciled` 与 `reusable: true`。无 session/get、ID/parent 不匹配、或 outcome 为 failed/interrupted/不明确时保留 observed completed + unreconciled 且不可复用。
- 重启恢复不得授予新复用资格：`task-reconcile` 仅可保留启动前已授权的 `reusable: true`，不得因 host succeeded 将 `reusable: false` 或 taskReuse disabled 的记录升级为 true。

## 任务

### T1 — RED：覆盖 subagent 受控生命周期

- Wave：1；Depends on：无
- Files：`src/runtime/task-observer.test.ts`、`src/runtime/task-reconcile.test.ts`、`src/runtime/task-supervisor.test.ts`、`src/index.test.ts`、`src/tools/task/reuse.test.ts`
- Owner：主代理
- 目标：新增失败测试，固定真实事件形状：顶层 `result.sessionID`、`event.input.agent`、`event.input.description` 的唯一 lane 标记。断言 child ID 同时为 `task_id`/`child_session_id`；completed 后先由 `session.get` 成功核验再标记 reconciled/reusable；`task_reuse` 确实把第二个 brief 传给同一 child session。
- 边界：断言父 session ID、空/缺失 ID、非 completed、reuse disabled、未确认宿主 outcome、核验的 `id` 或 `parentID` 不匹配、以及 failed/interrupted outcome 均不会设置 reconciled/reusable；跨父、不同 agent、不同 lane 均不调用 `adapter.resumeChild`。保留原有通用 `extractChildSessionId` 对裸 sessionID 不充分的断言；新路径只对 `tool: subagent` 的受限顶层 result 例外。
- 元数据边界：缺失/空 `agent`、缺失/多重/非法 lane 时可保留观测记录，但绝不成为 `task_reuse` 候选。`task-reconcile` 测试同样覆盖 ID/parent 不匹配、failed/interrupted，确保重启恢复不能放宽 observer 的归属条件；这些路径必须断言不会写入 reconciled，并清除或保持 `reusable: false`，不得保留历史 reusable 标记。
- 重启正向边界：host succeeded 但启动前 `reusable: false` 或复用禁用时，reconcile 可确认状态但不得新晋升 `reusable: true`。
- 接线边界：测试必须证明 resolved `taskReuse.enabled: false` 从 `runSetup` 传至 supervisor/reconcile，而不是仅模拟 ReconcileOptions。
- 禁区：不得修改生产代码；不得改写现有用户测试。
- 验收/证据：修改前相关新增断言失败。
- 命令：`bun test src/runtime/task-observer.test.ts src/runtime/task-reconcile.test.ts src/runtime/task-supervisor.test.ts src/index.test.ts src/tools/task/reuse.test.ts`

### T2 — GREEN：接入 observer 生命周期

- Wave：2；Depends on：T1
- Files：`src/runtime/task-observer.ts`
- Owner：主代理
- 目标：仅对上述明确 `subagent` completed 事件，安全建立/更新 Board 和 Registry；保存规定来源的 agent/lane 元数据；经 `session.get` 成功核验后写入 reconciliation 与 reusable，并沿用 TTL 修剪。
- 禁区：不从输入 task ID 或 hook call ID 推断 child；不接受嵌套或模糊 `sessionID`；不在 `id`/`parentID` 都匹配前标记为受控可复用；不修改 `task` 路径语义；不扩大跨会话访问。
- 验收/证据：T1 断言转绿，未知或不完整输出仍不产生 reusable 条目。
- 命令：`bun test src/runtime/task-observer.test.ts src/tools/task/reuse.test.ts`

### T2R — GREEN：收紧重启恢复的归属核验

- Wave：3；Depends on：T2
- Files：`src/runtime/task-reconcile.ts`、`src/runtime/task-supervisor.ts`、`src/index.ts`
- Owner：主代理
- 目标：将 resolved `taskReuse.enabled` 经 index → supervisor → reconcile 明确传递；恢复路径只在 host `get` 同时确认 succeeded、child ID 和 parentID 匹配时才对账，并且仅在配置启用且原记录已经 `reusable: true` 时保留 reusable；不匹配、failed、interrupted 或禁用配置时保持不可复用。
- 禁区：不得以仅 outcome 判断覆盖 observer 的归属安全条件。
- 验收/证据：T1 的 reconcile、supervisor 和 setup 接线测试转绿；failed/interrupted/ID 不匹配/parent 不匹配均不写 reconciled，且清除或保持 `reusable: false`；配置禁用时不新授予 reusable。
- 命令：`bun test src/runtime/task-reconcile.test.ts src/runtime/task-supervisor.test.ts src/index.test.ts`

### T3 — SURFACE：回归验证与类型检查

- Wave：4；Depends on：T2R
- Files：无生产修改；仅允许按失败需要修改 T1 文件
- Owner：主代理
- 目标：运行定向测试和类型检查，复核跨父会话、不同 agent/lane、未对账拒绝条件及既有 diff 基线。
- 禁区：不得借由放宽断言掩盖失败。
- 验收/证据：测试和 `bun run typecheck` 成功；diff 仅在批准范围内。
- 命令：`bun test src/runtime/task-observer.test.ts src/runtime/task-reconcile.test.ts src/runtime/task-supervisor.test.ts src/index.test.ts src/tools/task/reuse.test.ts && bun run typecheck`

### T4 — RED：固定统一的 fallback 死锁豁免规则

- Wave：5；Depends on：T3
- Files：`src/agents/index.test.ts`、`src/agents/orchestrator-context.test.ts`
- Owner：主代理
- 目标：新增失败断言，规定三份编排提示词禁止 Job Board 中同 lane 的 active/unreconciled 任务 fallback；completed/reconciled/reusable 必须走 reuse；仅当 `task_reuse` 返回 `NO_REUSABLE_TASK` 且 Board 中没有同 lane 受控记录时，未登记任务允许一次 fallback。其他复用错误（如 `UNSUPPORTED`、`CAS_CONFLICT`、`UNCERTAIN`）不得许可 fallback；已对账不可复用终态仅可在消费结果、确认无同 lane 受控记录并收到该返回码后 replacement fallback。
- 禁区：不得弱化已登记任务的重复派发保护；不得修改执行代码。
- 验收/证据：新增提示词契约测试在生产提示词更新前失败。
- 命令：`bun test src/agents/index.test.ts src/agents/orchestrator-context.test.ts`

### T5 — GREEN：修正 fallback 编排规则

- Wave：6；Depends on：T4
- Files：`src/agents/sisyphus.ts`、`src/agents/oceanus.ts`、`src/agents/orchestrator-context.ts`
- Owner：主代理
- 目标：在三份编排提示词中用相同的精确条件替换无条件“同 lane 禁止第二次 fallback”的指令，使模型先检查 Job Board；已登记 active/unreconciled 必须等待，completed/reusable 必须续用；仅 `NO_REUSABLE_TASK` 且无同 lane 受控记录时，未登记或已消费结果的不可复用终态可一次 replacement fallback，其他错误不得 fallback。
- 禁区：不得放宽跨父/agent/lane 的复用限制；不得改变工具实现的所有权检查。
- 验收/证据：T4 转绿，现有工作流提示词测试保持通过。
- 命令：`bun test src/agents/index.test.ts src/agents/orchestrator-context.test.ts`

### T6 — FINAL：全量最终验证和基线审计

- Wave：7；Depends on：T5
- Files：无生产修改；仅允许修正 T1/T4 测试中明显错误的断言
- Owner：主代理
- 目标：运行所有定向测试和类型检查，并逐文件与编辑前基线比对，确认仅追加本计划的变更且全部最终源文件均已验证。
- 禁区：不得通过删除或放宽断言使验证通过。验证失败时将对应任务标记 blocked，回到对应 GREEN 任务（T2 生命周期实现或 T5 提示词实现）修复后重跑其定向测试和 T6；不得以改写测试代替生产修复。
- 验收/证据：三组定向测试和 `bun run typecheck` 全部成功；完整 diff 复核无无关 hunk 覆盖。
- 命令：`bun test src/runtime/task-observer.test.ts src/runtime/task-reconcile.test.ts src/runtime/task-supervisor.test.ts src/index.test.ts src/tools/task/reuse.test.ts src/agents/index.test.ts src/agents/orchestrator-context.test.ts && bun run typecheck`

## 风险与缓解

- 宿主 after 事件字段不稳定：只接受明确、顶层 child `sessionID`；其他形状 fail-open。
- 原生 `subagent` 任务需提供稳定 lane：调度时将 `lane:<key>` 放入工具 `description`，不是仅放在 prompt 内。
- 完成回调可能早于对账或输出被伪造：只有 `session.get` 确认 succeeded 且 id/parent 都匹配后才写 `reconciled/reusable`；失败、不确定或归属不匹配时保持不可复用。
- fallback 规则过严：仅在 `NO_REUSABLE_TASK` 且无同 lane 受控记录时允许 fallback；`UNSUPPORTED`、`CAS_CONFLICT`、`UNCERTAIN` 等错误保持阻断，已对账不可复用终态也须先消费结果后才可 replacement。

## Momus 门禁

- 状态：Momus 通过，待人工批准
- 轮次：9
- 审查时间：2026-08-28T10:36:35+08:00
- 结论：OKAY（r9）；实现时必须在 CAS 写入 `reconciled/reusable` 前完成 `session.get` 的 outcome、id、parentID 三重核验。
