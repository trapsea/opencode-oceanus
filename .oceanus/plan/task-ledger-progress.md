# 实现计划

## Wave 1 — 计划阶段规范

- **Task ID**：ledger-plan
- **任务**：要求计划阶段为每个计划创建对应 progress ledger，初始化全部任务为 `pending`，并记录 Task ID、Wave、依赖、文件范围和验证标准。
- **Files**：`src/skills/sisyphus-plan.ts`、`src/agents/sisyphus.ts`
- **Depends on**：无
- **验证**：检查内置 skill 和 Sisyphus 主提示词均包含 ledger 初始化规则。

## Wave 1 — 执行阶段规范

- **Task ID**：ledger-execute
- **任务**：要求 orchestrator 在派发前、任务终态后逐任务更新 ledger，并定义并行写入安全规则。
- **Files**：`src/skills/sisyphus-execute.ts`、`src/agents/sisyphus.ts`、`src/agents/oceanus.ts`
- **Depends on**：无；与 `ledger-plan` 均为提示词修改，但共享 Sisyphus 主提示词，因此实际串行修改。
- **验证**：检查 pending/in_progress/completed/failed/blocked 状态、验证证据和并行更新规则完整。

## Wave 2 — 文档同步与验证

- **Task ID**：ledger-docs
- **任务**：同步 README 和进度设计文档，运行类型检查和构建。
- **Files**：`README.md`、`.oceanus/spec/task-ledger-progress.md`
- **Depends on**：ledger-plan、ledger-execute
- **验证**：旧进度规范不再把阶段状态作为主记录；`bun run typecheck`、`bun run build` 通过。

## 策略

- TDD：不适用；本次修改的是 agent 提示词和 Markdown 工作流规范，不引入运行时代码。
- Worktree：当前目录不是 Git 仓库，使用当前目录串行修改；并行 worker 只更新各自声明文件，不能写共享 ledger。
