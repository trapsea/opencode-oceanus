# Sisyphus 上下文优先与条件委派实施计划

## 验收标准

1. Intake skill 和 Sisyphus prompt 明确由 Sisyphus 完成，不能默认调用 Metis。
2. Brainstorm 中 Metis 仅作为条件性的独立方案分析，不能重复 Intake。
3. 所有阶段明确主 Agent 上下文所有权和条件委派理由。
4. Momus、Oracle、Fixer、Explorer、Observer 的现有有效职责不被削弱。
5. 契约测试覆盖“不重复分析、用户决策不委派、专业能力仍委派、Finish 不委派、SOLUTION_ANALYSIS 前置条件”。
6. Intake 的 CBM 所有权、执行时机和 fail-open 规则明确，测试可验证：代码/混合任务包含一次直接 `cbm_index` 和一次性/不重复语义；失败、超时、`in-progress` 均包含 fail-open 与证据记录；非代码任务明确不触发。
7. 文档与源码口径一致，测试和 typecheck 通过。

## 任务

### A — 更新 Sisyphus 阶段契约

- **Wave**: 1
- **Depends on**: none
- **Files**: `src/agents/sisyphus.ts`, `src/skills/sisyphus-intake.ts`, `src/skills/sisyphus-brainstorm.ts`, `src/skills/sisyphus-plan.ts`, `src/skills/sisyphus-execute.ts`, `src/skills/sisyphus-review.ts`, `src/skills/sisyphus-finish.ts`
- **验证**: 阶段顺序、Intake 主责、Sisyphus 直接 CBM 且 fail-open、Metis 条件调用、各阶段 owner/委派边界和 Finish 规则的契约测试；测试替换旧的“复杂任务先调用 Metis”断言，改为断言 `Intake 已完成 + 澄清后仍有未决方案 + 确需独立分析` 三项前置条件。

### B — 更新通用路由和 Agent 调度契约

- **Wave**: 1
- **Depends on**: none
- **Files**: `src/agents/oceanus.ts`, `src/agents/metis.ts`, `src/agents/momus.ts`, `src/agents/index.ts`（仅必要时）
- **验证**: 主上下文优先、委派收益判断、validation owner、各 specialist 条件路由和 disabled agent 行为；Metis 的 `SOLUTION_ANALYSIS` 明确要求已有 Intake 且不得用于重复 Intake。

### C — 更新测试和说明文档

- **Wave**: 2
- **Depends on**: A, B
- **Files**: `src/skills/stages.test.ts`, `src/agents/index.test.ts`, `src/agents/cbm-usage.test.ts`, `README.md`, `docs/three-way-capability-comparison.md`, `docs/openagent-orchestration-review.md`, `docs/codebase-memory-mcp.md`, `.oceanus/spec/sisyphus-intake-stage.md`, `.oceanus/spec/cbm-agent-usage-and-intent-gate.md`, `.oceanus/spec/codebase-memory-mcp-integration.md`
- **验证**: 相关 Bun 测试、typecheck、全文检索确认无旧的“Intake 必须 Metis”表述；确认所有文档统一描述 Sisyphus 直接 Intake/CBM，Metis 仅条件性 SOLUTION_ANALYSIS。

## 执行约束

- 不修改 task registry、task protocol、宿主 session 或运行时 Context Envelope。
- 保留工作区已有用户变更，不做 reset、commit 或 worktree 操作。
- A/B 文件范围完全不重叠，可并行执行；C 必须等待 A/B 完成。
- 所有 worker 只修改声明的 Files，不写共享 progress ledger。
