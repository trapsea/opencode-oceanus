# 删除内置 build/plan agent 实现计划

## 策略

- TDD：本次不新增测试；使用类型检查和构建验证插件 API 调用。
- Worktree：使用当前共享工作区，不创建额外 worktree。

## 任务

### remove-built-in-agents

- **Wave**：1
- **Depends on**：无
- **Files**：`src/index.ts`
- **目标**：在 agent transform 中安全删除存在的 `build` 与 `plan`，保留现有更新、默认 agent 和 reload 流程。
- **验证**：`bun run typecheck`、`bun run build`，并检查删除逻辑位于 transform 内。
