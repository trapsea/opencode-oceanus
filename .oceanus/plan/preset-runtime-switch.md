# `/preset` 运行时切换修复计划

## 策略

- Worktree：共享当前 worktree，串行执行；禁止创建/切换 worktree、git add/commit/reset。
- 测试：用户允许先实现，但执行阶段仍遵守工作流的 RED→GREEN→SURFACE：先写/运行能锁定失败行为的测试，再改生产代码。
- 现有 `package.json` 版本修改属于用户变更，不得覆盖。

## 任务图

### preset-runtime-1（Wave 1）配置目标与命令契约

- 目标：补齐当前 location 写入、项目配置保留其他字段、最终配置选择和错误路径测试。
- Files：`src/config/presets.ts`、`src/config/loader.ts`、`src/config.test.ts`、`src/config/presets.test.ts`、`src/commands/preset.ts`、`src/commands.test.ts`
- Depends on：无
- 验证：RED→GREEN 相关 Bun 测试；项目 preset 存在时切换后最终 `loadPluginConfig` 为目标 preset；成功/查询文案不再要求新会话。

### preset-runtime-2（Wave 2）运行时 registry 重建

- 目标：让成功切换基于 fresh config 清理并重建 agent 定义，覆盖旧 model/options/permission、disabled agent，并在刷新失败时不发成功消息；对照 `node_modules/@opencode-ai/plugin/dist/promise/agent.d.ts` 核对真实 `AgentDraft`（含 `list/get/update/remove/default`，不假造 `add`），处理 transform registration 的清理/叠加。
- Files：`src/index.ts`、`src/smoke/*`（仅必要测试文件）
- Depends on：preset-runtime-1
- 验证：RED→GREEN fake host registry 行为测试，fake draft 镜像真实 API；断言 model/prompt/options/permission 更新和 disabled agent 移除；注入宿主不支持当前会话刷新时断言明确失败提示；typecheck；相关测试。

### preset-runtime-3（Wave 3）产物与回归验证

- 目标：构建 dist，验证入口产物包含修复，运行全量测试并区分已有用户变更导致的失败。
- Files：`dist/*`（由 build 生成，不手工编辑）
- Depends on：preset-runtime-2
- 验证：`bun run typecheck`、相关测试、`bun test`、`bun run build`、`test -s dist/index.js` 且 `grep`/字符串断言确认 dist 含 location 写入与 registry 刷新逻辑、`git diff`。

## Momus 门禁

- 状态：已通过门禁
- 轮次：2
- 结论：第一轮 REJECT；按 P1/P2/P3/P4 修订后 @momus 返回 OKAY
- 审查摘要：真实 AgentDraft API、fake 形状、registration 叠加、失败提示、文案、测试文件和 dist 验证均已覆盖。
- 审查时间：2026-08-27
- 时间：2026-08-27
