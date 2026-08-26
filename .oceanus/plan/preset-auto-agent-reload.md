# Preset 自动 reload 实现计划

## 策略

- TDD：先补测试，再实现。
- Worktree：共享当前工作区，任务串行集成；不执行 git 操作。

## 任务

### AUTO-RELOAD-001：补充成功/失败 reload 测试

- Wave：1
- Depends on：无
- Files：`src/commands.test.ts` 或新增 command 注入测试
- 目标：覆盖成功切换调用 reload、查询/失败不调用 reload。
- 验证：测试先按预期失败。

### AUTO-RELOAD-002：接入 agent reload

- Wave：2
- Depends on：AUTO-RELOAD-001
- Files：`src/index.ts`、必要时 `src/commands.ts`
- 目标：成功切换后调用 `ctx.agent.reload()`，更新反馈文案。
- 验证：相关测试、typecheck 通过。

### AUTO-RELOAD-003：最终验证

- Wave：3
- Depends on：AUTO-RELOAD-002
- Files：仅验证
- 目标：运行完整测试和构建。
- 验证：`bun run typecheck`、`bun test`、`bun run build`、`git diff --check`。
