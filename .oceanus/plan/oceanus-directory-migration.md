# 实现计划

## Wave 1 — 路径引用迁移

- **任务**：将 Sisyphus agent、四个内置 skill 和 README 中的 旧的工作流目录 工作流路径改为 `.oceanus/`。
- **Files**：`src/agents/sisyphus.ts`、`src/skills/sisyphus-brainstorm.ts`、`src/skills/sisyphus-plan.ts`、`src/skills/sisyphus-execute.ts`、`README.md`
- **Depends on**：无
- **验证**：搜索旧路径和新路径，确认引用完整且无误。

## Wave 2 — 工程验证

- **任务**：验证类型和构建产物。
- **Files**：无新增修改
- **Depends on**：Wave 1
- **验证**：`bun run typecheck`、`bun run build`

## 策略

- TDD：不适用；本次仅修改文档字符串和提示词路径。
- Worktree：当前工作区不是 Git 仓库，按用户确认使用当前目录串行执行。
