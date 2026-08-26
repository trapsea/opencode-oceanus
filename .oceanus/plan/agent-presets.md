# Agent Preset 实现计划

## 策略

- TDD：先为纯配置合并、配置持久化和命令选择行为编写测试，再实现。
- Worktree：共享工作区；任务按文件所有权执行，worker 不执行 git add/commit/reset 或 worktree 操作。
- 验证：`bun test`、`bun run typecheck`、`bun run build`。

## 任务图

### agent-presets-1（Wave 1）
- 目标：扩展 preset schema，并实现当前 preset 与显式 agents 的合并解析。
- Files：`src/config/schema.ts`、`src/config/loader.ts`、`src/config/utils.ts`、新增配置测试文件。
- Depends on：无。
- 验证：配置 schema 测试覆盖字段、项目/用户优先级、显式 agents 覆盖 preset、未知 preset 回退。

### agent-presets-2（Wave 2）
- 目标：让 agent 定义应用完整 preset/override 字段，并保持 v2 可映射字段行为。
- Files：`src/agents/index.ts`、必要的 agent 类型文件、agent 测试。
- Depends on：agent-presets-1。
- 验证：agent 构造测试检查 model、temperature、prompt、description、color 及完整配置保留/映射策略。

### agent-presets-3（Wave 2）
- 目标：实现用户级配置的安全读写及 preset 选择纯逻辑。
- Files：`src/config/loader.ts` 或新增 `src/config/presets.ts`、对应测试文件。
- Depends on：agent-presets-1。
- 验证：JSON/JSONC 写入、已有配置保留、路径优先级、写入错误测试。

### agent-presets-4（Wave 3）
- 目标：在 TUI 中注册 `/preset`，展示并选择预设，持久化后反馈 reload/新会话提示。
- Files：`src/tui.tsx`、TUI 命令测试或可测试纯函数文件。
- Depends on：agent-presets-3。
- 验证：typecheck 与命令选择/无预设/未知预设行为测试；手工检查 slash completion 与 toast。

### agent-presets-5（Wave 4）
- 目标：更新 README 配置示例和使用说明，完成集成回归验证。
- Files：`README.md`、必要的测试修正。
- Depends on：agent-presets-2、agent-presets-4。
- 验证：`bun test`、`bun run typecheck`、`bun run build` 全部通过。

### agent-presets-6（Wave 4）
- 目标：修复完整 override 字段静默丢失问题，映射 v2 支持的 displayName/options/permission/orchestratorPrompt，并对无法映射字段给出明确处理。
- Files：`src/agents/oceanus.ts`、`src/agents/index.ts`、`src/index.ts`、对应测试。
- Depends on：agent-presets-2、agent-presets-4。
- 验证：字段映射测试、typecheck、全量测试和 build。
