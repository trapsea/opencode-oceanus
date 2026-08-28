# 后台任务生命周期能力分层：实施计划

## 已确认策略

- 测试：严格 RED → GREEN → SURFACE。
- 工作区：共享工作区串行；不创建 Worktree，所有写入任务互相依赖且不得并行。
- 运行时：native background `task` 是完整生命周期能力的唯一入口；raw `subagent` 仅记录为不可控会话，以便返回明确诊断。

## 文件映射

- `src/runtime/task-observer.ts`：区分 host `task` 与 raw `subagent`；仅接受宿主返回体中显式的 `taskId` / `task_id` 作为 native task ID，绝不把 `event.id` 当成 native task ID。未知或畸形返回只记录不可控会话诊断，禁止授予生命周期控制能力。
- `src/tools/task/job-board.ts`、`src/tools/task/types.ts`：持久化能力/别名映射，并按父 session 安全解析 task ID 或 session ID。
- `src/tools/index.ts`、`src/tools/task/message.ts`：将不可控或未知 raw subagent 显式报告为 `BACKGROUND_TASK_API_UNAVAILABLE`；状态/结果支持从 JobBoard 恢复。
- `src/tools/task/revive.ts`、`src/tools/task/reuse.ts`、`src/runtime/task-reconcile.ts`：CAS 落入 revive/reuse 的终态、完成后收敛和 reusable 标识。
- `src/agents/oceanus.ts`、`src/agents/sisyphus.ts`、`README.md`：仅受控任务可消息/复用；说明宿主能力降级。
- 对应 `*.test.ts`：覆盖每项行为。

## 任务

| Task ID | Wave | Depends on | Files | 目标 | 验证 |
|---|---:|---|---|---|---|
| T1 | 历史 | — | — | **已失败且从执行图移除**；由 T1R 完全替代，不得调度。 | 失败证据见 ledger。 |
| T1R | 2 | —（替代 T1） | `src/runtime/task-observer.ts`, `src/tools/task/types.ts`, `src/runtime/task-observer.test.ts`, `src/runtime/production-task-harness.test.ts` | 回退 T1 的 production-first 部分；先更新契约测试并捕获 RED，再以最小实现恢复 observer 的既有 barrier 行为，同时保留严格 native ID 规则。 | RED/GREEN 命令：`bun test src/runtime/task-observer.test.ts src/runtime/production-task-harness.test.ts`；上述 hook surface 测试通过且新增 fail-closed 用例覆盖受控/不可控边界。 |
| T2 | 3 | T1R | `src/tools/index.ts`, `src/tools/task/message.ts`, `src/tools/task/job-board.ts`, `src/runtime/production-task-harness.test.ts`, `src/tools/task/message.test.ts` | 使用别名解析和 JobBoard 回退实现明确能力错误、重启后的状态/结果读取、受控消息及取消。 | `bun test src/tools/task/message.test.ts src/runtime/production-task-harness.test.ts`：Registry 未命中但同父 session 的受控 task 可从重开 JobBoard 查询 status/result；跨父 session 返回 `PARENT_OWNERSHIP`；raw/未知 session 对 `message/status/result/cancel` 均不触发 session 控制且返回一致能力错误。 |
| T3 | 4 | T1R, T2 | `src/tools/task/revive.ts`, `src/tools/task/reuse.ts`, `src/runtime/task-reconcile.ts`, `src/tools/task/revive.test.ts`, `src/tools/task/reuse.test.ts`, `src/runtime/task-reconcile.test.ts`, `src/tools/task/job-board.test.ts` | 对 raw/unknown session 的 revive/reuse 先拒绝且不调用 session 控制 API；对受控任务保证 revive/reuse 的宿主终态 CAS 落板、完成任务 reconcile 后才 reusable。 | `bun test src/tools/task/revive.test.ts src/tools/task/reuse.test.ts src/runtime/task-reconcile.test.ts src/tools/task/job-board.test.ts`：raw/unknown 的 `revive/reuse` 返回 `BACKGROUND_TASK_API_UNAVAILABLE` 且 adapter 零调用；受控路径无 `starting` 残留与 generation 回归及 reopen 读取。 |
| T4 | 5 | T1R, T2, T3 | `src/agents/oceanus.ts`, `src/agents/sisyphus.ts`, `README.md`, `src/runtime/production-task-harness.test.ts`, `src/smoke/host-smoke.test.ts` | 更新编排契约、配置/运行边界和文档；增加条件化宿主 smoke，严格断言能力缺失时跳过并输出原因。 | `bun test src/runtime/production-task-harness.test.ts src/smoke/host-smoke.test.ts` 后，运行 `bun test`、`bun run typecheck`、`bun run build`；真实宿主存在 native task API 时 smoke 覆盖消息和终态收敛，否则明确 skip。 |

## 风险与降级

- V2 stable 未承诺已完成 child session 可复用：能力缺失必须返回 `UNSUPPORTED` / `UNCERTAIN`，不伪造成功。
- 真实 native background-task 回调形状依赖宿主：解析必须严格且 fail-closed for lifecycle control。
- JobBoard 与 Registry 的跨重启差异：JobBoard 是持久化回退来源，宿主事实仍优先。

## 逐任务实施步骤

### T1R — 受控任务识别修正

1. 在 `task-observer.test.ts` 先替换旧的 input/call ID 假设，并新增 RED：仅 native `task` result 中一致的非空 `taskId`/`task_id` 可控；input ID、call ID、raw `subagent`、空值、类型错误或冲突键均不可控。**此时立刻运行** `bun test src/runtime/task-observer.test.ts src/runtime/production-task-harness.test.ts` 并将失败输出记录为 RED，之后才允许改生产代码。
2. 在 `production-task-harness.test.ts` 新增 host before/after surface，断言受控 ID 和 child session 绑定；raw 会话只产生诊断而不进入控制路径。
3. 最小化修正 `task-observer.ts`，保留 before-after barrier 与 generation 逻辑；更新 `types.ts` 的 control/capability 字段。
4. 实现后再次运行同一命令，GREEN 输出与第 1 步 RED 输出均入账本。

### T2 — 受控工具与跨重启查询

1. 在 `message.test.ts` 与 `production-task-harness.test.ts` 先新增 RED：Registry 未命中时，同父受控 JobBoard task 的 status/result 成功；跨父拒绝；raw/unknown 的 message/status/result/cancel 返回 `BACKGROUND_TASK_API_UNAVAILABLE` 且无 host 调用。**立刻运行** `bun test src/tools/task/message.test.ts src/runtime/production-task-harness.test.ts` 并记录 RED，之后才改生产代码。
2. 为 JobBoard 增加按 native task ID/child session 的受限、同父别名解析；`index.ts` 和 `message.ts` 只将 resolved controlled task 传入宿主控制能力。
3. 再次运行 `bun test src/tools/task/message.test.ts src/runtime/production-task-harness.test.ts`，记录 GREEN 和持久化 board reopen surface。

### T3 — revive、reuse 与收敛

1. 在 `revive.test.ts`、`reuse.test.ts`、`task-reconcile.test.ts`、`job-board.test.ts` 先新增 RED：raw/unknown 的 revive/reuse 不调用 adapter；受控 revive/reuse 接到 `succeeded`/`failed`/`interrupted` 后以同 generation CAS 转终态；reconcile 后 completed 才 reusable，且重开 JobBoard 后可读取该终态。**立刻运行** `bun test src/tools/task/revive.test.ts src/tools/task/reuse.test.ts src/runtime/task-reconcile.test.ts src/tools/task/job-board.test.ts` 并记录 RED。
2. 修改 `revive.ts`、`reuse.ts`、`task-reconcile.ts`；保留 failed/uncertain 的安全边界。
3. 再次运行 `bun test src/tools/task/revive.test.ts src/tools/task/reuse.test.ts src/runtime/task-reconcile.test.ts src/tools/task/job-board.test.ts`，记录 GREEN。

### T4 — 编排契约与完整验证

1. 在代理提示词/README 中明确“仅受控 native background task 可 message/reuse”；raw `subagent` 是降级路径。
2. 将真实宿主 smoke 做成 capability-gated：缺 native API 输出明确 skip，具备时覆盖消息与终态。
3. 运行 `bun test`、`bun run typecheck`、`bun run build`，记录结果。

## Momus 审查

- 状态：已通过
- 轮次：3
- 时间：2026-08-28
- 结论：OKAY
- 问题：第一轮要求补充 native ID 严格提取、取消降级、全生命周期 raw 覆盖与真实宿主 smoke；第二轮要求把 raw revive/reuse 移至 T3、补齐 fail-closed 反例与重启同父/跨父边界；均已实质修订。第三轮确认依赖、文件范围、测试覆盖与能力降级可执行。
