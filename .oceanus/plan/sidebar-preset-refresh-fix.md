# /preset 切换后 sidebar 刷新修复计划

Spec: `.oceanus/spec/sidebar-preset-refresh-fix.md`（已批准）

## 已确认策略

- TDD：T1 先写 ticker 行为测试（fake context + 短 tick 间隔断言 refresh 触发），再改组件实现；T2 为防御性小改，以 typecheck + 审阅验证（无现成 applyAgentDefinitions 测试 harness）。
- Worktree：共享工作区。`src/tui.tsx`、`src/index.ts`、`src/tui.test.ts` 均有用户未提交改动，全部编辑用精确 edit 叠加，禁止整文件重写，禁止 git 写操作。
- 构建：完成后 `bun run build` 刷新 dist 并 grep 标记确认产物含新逻辑。

## 任务图

### Wave 1

#### T1-sidebar-preset-ticker

- **目标**：新增导出的、依赖注入的纯单元 `createPresetWatcher({ read, intervalMs, onChange })` → 返回 `dispose()`；`read` 为 `() => string | undefined`（组件注入 `() => loadPluginConfig({directory}).preset`），interval 内部 `setInterval`。约定：`read` 抛异常或返回 undefined 时视为指纹不变（fail-open，避免瞬时读盘失败触发多余 refresh）。AgentModelPanel 消费它：mount 时创建（首次 read 结果为基线指纹，不触发 onChange）、preset 变化时调用 `refreshAgents()`、`onCleanup` 调 dispose。保留现有 agent.updated / inbox.delivered 监听作快速路径。
  - 编辑锚点基于当前工作树内容（三文件均有用户未提交改动），精确 edit 叠加。
- **Files**: `src/tui.test.ts`（新增测试）、`src/tui.tsx`
- **Depends on**: 无
- **Worker**: Sisyphus 直接执行（改动紧耦合根因上下文，委派传递成本高于收益）
- **验证**：
  - 新增纯单元测试（bun:test，真实短 timer 如 intervalMs=10 + await sleep）：a) fingerprint 变化触发 onChange；b) 同值/undefined 不触发；c) dispose 后不再触发；d) read 抛异常视为不变
  - 组件接线：typecheck 保证；行为由纯单元测试+T3 build 标记覆盖
  - `bun test src/tui.test.ts` 通过；`bun run typecheck` 通过

#### T2-clear-stale-agent-model

- **目标**：`applyAgentDefinitions` 中 `def.model` 缺失时显式清除 draft 中残留的 `agent.model`，防止 preset 间切换残留旧 model。
- **Files**: `src/index.ts`
- **Depends on**: 无（与 T1 文件不重叠，可并行）
- **Worker**: Sisyphus 直接执行
- **验证**：`bun run typecheck` 通过；代码审阅确认清除分支只影响 def.model 缺失的 agent

#### T3-build-and-evidence

- **目标**：构建产物刷新 + 收尾证据。
- **Files**: `dist/`（构建产物）
- **Depends on**: T1、T2 全部终端完成
- **Worker**: Sisyphus 直接执行
- **验证**：
  - `bun run build` 成功
  - grep 确认 `dist/tui.js` 含 createPresetWatcher ticker 标记；`dist/index.js` 含 model 清除逻辑（T2 改动经 src/index.ts 入口编入 dist/index.js，不在 dist/tui.js）
  - 全量 `bun test` 通过（覆盖"现有测试不回归"验收项）
  - 运行中的 OpenCode 需重载插件/新建会话后人工复核 sidebar 多窗口一致性——该项 executor 不可自动闭环，移交用户人工验证并在收尾报告标注。

## Momus 门禁

- R1: REJECT（ses_fbd5c4d86ffeae1BSQ6eEKmb3X）→ 4 项修订全部采纳：P1 测试机制定为可注入 watcher 纯单元；P2 T3 grep 目标分拆 dist/tui.js 与 dist/index.js；P3 补全量 bun test；P4 读失败视为指纹不变。修订时间: 2026-08-27
- R2: OKAY（ses_fbd5c4d86ffeae1BSQ6eEKmb3X，2026-08-27）。备注：undefined 语义 trade-off 已知悉接受；全量测试失败需按基线归因；read 注入沿用 props.context.location?.directory。
