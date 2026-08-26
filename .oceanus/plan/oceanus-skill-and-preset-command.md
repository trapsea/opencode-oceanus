# Oceanus Skill 与 preset Command 实现计划

## 已确认策略

- TDD：测试先行。
- Worktree：共享当前工作区；执行阶段串行集成，worker 不执行 git 操作、不修改声明范围外文件。

## 文件关系

- `src/config/loader.ts`、`src/config/presets.ts`：已有配置读取、合并和原子写入能力，优先复用。
- `src/skills/types.ts`、`src/skills/index.ts`：skill 定义与注册入口。
- `src/index.ts`：主插件 agent、skill、command 注入入口。
- `src/tui.tsx`：当前包含旧的 TUI `/preset` 注册；移除 command，保留 sidebar。
- `src/tui-preset.test.ts`：旧 TUI command 辅助函数测试；切换后删除不再需要的测试或迁移有效断言。
- 新增 command 测试覆盖命令解析/反馈与注册逻辑。

## 任务

### OCEANUS-001：补充原生 preset command 的测试基线

- Wave：1
- Depends on：无
- Files：`src/commands.test.ts`（新增）、必要时 `src/config/presets.test.ts`
- 目标：定义无参数列出 preset、有参数成功切换、未知 preset 拒绝、写入失败反馈等验收行为。
- 验证：`bun test src/commands.test.ts` 先得到预期失败，证明测试覆盖尚未实现的行为。

### OCEANUS-002：新增 Oceanus 配置 skill 定义

- Wave：1
- Depends on：无
- Files：`src/skills/opencode-oceanus.ts`（新增）、`src/skills/index.ts`
- 目标：按已批准设计提供完整 frontmatter 与 Oceanus 配置说明，并加入注入列表。
- 验证：skill 定义测试或静态断言确认名称、描述和关键路径/用法存在。

### OCEANUS-003：实现主插件 command 注入

- Wave：2
- Depends on：OCEANUS-001、OCEANUS-002
- Files：`src/index.ts`、必要时 `src/commands.ts`（新增）
- 目标：通过 `ctx.command.transform` 注册 `preset`，复用配置逻辑，支持列表、切换、未知名称和异常反馈，并 reload command/skill。
- 验证：`bun test src/commands.test.ts`、`bun run typecheck`。

### OCEANUS-004：移除旧 TUI preset command 并保留 sidebar

- Wave：3
- Depends on：OCEANUS-003
- Files：`src/tui.tsx`、`src/tui-preset.test.ts`
- 目标：删除 TUI keymap 中的 `/preset` 注册及其专用逻辑/测试，避免原生命令重复；保留 sidebar 和其他展示测试。
- 验证：grep 确认 `src/tui.tsx` 不再注册 `preset`，`bun test` 全量通过。

### OCEANUS-005：全量验证与构建

- Wave：4
- Depends on：OCEANUS-004
- Files：无新增修改范围（仅验证；若失败创建修复任务）
- 目标：确认类型、测试、构建和产物声明均正常。
- 验证：`bun run typecheck`、`bun test`、`bun run build`。

### OCEANUS-006：修正 command 反馈与覆盖提示

- Wave：3（评审修复，插入全量验证前）
- Depends on：OCEANUS-003、OCEANUS-004
- Files：`src/index.ts`
- 目标：按 OpenCode v2 command 官方用法传递 `prompt` 与 `delivery`；捕获未知 preset/写入异常并反馈；成功信息明确仅更新用户级配置、项目级 preset 可能覆盖结果，并提示 reload/新会话。
- 验证：`bun run typecheck`、`bun test`。
