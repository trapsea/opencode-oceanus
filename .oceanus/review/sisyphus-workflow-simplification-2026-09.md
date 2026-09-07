# Review: Sisyphus 工作流简化与调研协议优化

状态: PASS
Spec: `.oceanus/spec/sisyphus-workflow-simplification-2026-09.md`
Plan: `.oceanus/plan/sisyphus-workflow-simplification-2026-09.md`
Progress: `.oceanus/progress/sisyphus-workflow-simplification-2026-09.md`

## Completion Audit

| criterion | evidence | status | gap / next action |
|---|---|---|---|
| 六阶段顺序与 skill 注册保持 | `src/agents/sisyphus.ts`；`src/skills/index.ts`；`bun run check:dist` | PASS | 无 |
| Oracle 不再是固定门禁 | `src/agents/sisyphus.ts`、`src/skills/oceanus-plan.ts`、`src/skills/oceanus-execute.ts`、`src/skills/oceanus-finish.ts`；全量 746 tests | PASS | 历史 `plan-gate` 注册表保留为公共兼容数据，但不再是当前路由 |
| Oracle 仅按需咨询 spec/plan | `src/agents/oceanus.ts`、`src/agents/oracle.ts`、`src/review/scenes.ts`；Oracle 定向 38 tests | PASS | 真实 Host 的 prompt 行为仍属于宿主表面验证范围 |
| Explorer/Librarian 研究结果可审计 | `src/agents/orchestrator-context.ts`、`src/agents/explorer.ts`、`src/agents/librarian.ts`；9 定向 tests | PASS | 无 |
| Plan 自查与 Review 影响面复查衔接 | `src/cbm/registry.ts`、`src/skills/oceanus-plan.ts`、`src/skills/oceanus-review.ts`；CBM 定向测试 | PASS | CBM 有既有 `xx.sql:35` partial parse 信号，已按 fail-open 记录，不影响本任务结论 |
| 文档与构建产物同步 | README/AGENTS/docs/scripts；`bun run build`、`bun run check:dist`、`bun run check` | PASS | 无 |
| 工作区文件范围 | `git diff --check`、最终 diff/stat 复查 | PASS | 未运行 git 操作；既有 `.oceanus` 历史文档未修改 |

## Verification

- `bun test`: 746 pass / 0 fail。
- `bun run typecheck`: 通过。
- `bun run build`: 通过。
- `bun run check:dist`: 通过。
- `bun run check`: 通过。
- CBM `cbm_index`: indexed，2253 nodes / 6394 edges；`cbm_detect_changes` 工具返回格式异常，已降级使用实际 diff、grep/read 与测试证据。

## Residual uncertainty

- 这是 prompt/skill 层工作流，不是宿主运行时 supervisor；真实 OpenCode Host 不会自动强制阶段或 Oracle 调用。
- `src/review/protocol.ts` 仍保留 `gate` 类型和历史 verdict 解析能力以维持公共 API 兼容，但当前 Sisyphus/Oracle 路由不再使用其作为固定门禁。
