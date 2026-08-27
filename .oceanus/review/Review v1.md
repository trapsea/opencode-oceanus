# Primary↔Subagent 通信优化 Review v1

## 结论

REVIEW_OKAY。B→C 的本地可自动验证范围已完成；未修改 OpenCode 宿主。真实 host 的 `sendMessage`/`resumeChild`/`interrupt` 时序仍需在实际 OpenCode 会话中验证。

## 完成矩阵

| Criterion | Evidence | Status |
|---|---|---|
| 默认终态不制造 queue prompt | `src/runtime/task-observer.test.ts`：终态 prompt spy 为 0；全量测试通过 | verified |
| before/after 竞态不伪造完成 | observer barrier 测试：after 先到、缺 before 映射最终 uncertain；全量测试通过 | verified |
| eventId 幂等与 generation fence | JobBoard 测试覆盖同事件、冲突、STALE/FUTURE、revive 旧事件；全量测试通过 | verified |
| 并发 call 不串线 | observer 回退测试覆盖同 task 并发 call barrier 隔离；定向测试通过 | verified |
| cancel/complete/revive 状态一致 | supervisor/revive/JobBoard 测试覆盖 succeeded/failed/interrupted、CAS、uncertain 恢复；全量测试通过 | verified |
| 消息 outbox 边界与重试 | message 测试覆盖 pending/delivered/uncertain、attempts≤3、FIFO、幂等、权限和 32 条限制；全量测试通过 | verified |
| task_status/task_result 宿主事实优先 | tooling integration 测试覆盖 host running/outcome、旧 generation、verified:false、跨 parent；全量测试通过 | verified |
| agent 不依赖 queue 通知 | agent prompt 测试和源码检查确认显式 task_status/task_result 查询约定 | verified |
| 真实 OpenCode host 送达/恢复时序 | 当前 bun 环境仅执行 mock smoke；真实 host 测试被 skip | degraded |

## 验证

- `bun test`：942 pass，8 skip，0 fail，3194 assertions。
- `bun run typecheck`：通过。
- CBM Review 阶段 `cbm_index`：daemon 30 秒未响应，fail-open；未使用伪造的 CBM 证据。

## 观察与剩余风险

- `src/runtime/task-capabilities.ts` 仍使用面向子 session 的 `delivery:'queue'`，它不是 primary 终态通知；真实宿主中的排队/送达语义仍需 smoke。
- 生产 revive 适配器暂时缺少 `confirmActive` 时保持 `starting`，不会伪造 `running`。
- 工作区存在大量既有未提交改动，本次未清理、reset 或提交。
