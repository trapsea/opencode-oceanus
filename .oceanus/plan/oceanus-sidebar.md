# Oceanus Sidebar 实现计划

## 已确认策略

- TDD：先补可自动验证的 sidebar 数据整理测试，再做文档/必要实现调整。
- Worktree：共享工作区；任务文件范围完全不重叠，并行任务不得修改 ledger、运行 git 操作或越界编辑。
- 不实现 preset；模型切换仍不在本次范围内。

## 任务图

### Wave 1

#### sidebar-tests

- **目标**：为模型格式化、agent 排序/活动状态和缺省模型文本建立单元测试；如必要，最小化导出纯函数供测试使用。
- **Files**：`src/tui.test.ts`、`src/tui.tsx`（仅测试所需的纯函数导出调整）
- **Depends on**：无
- **Worker**：@fixer
- **验证**：针对测试文件运行 Bun 测试；不得改动 sidebar 视觉结构。

#### sidebar-ux-review

- **目标**：检查现有 sidebar 是否符合 Oceanus 标题、agent 模型、活动状态和降级显示要求；仅在必要时修正视觉/交互实现。
- **Files**：`src/tui.tsx`
- **Depends on**：无（与 `sidebar-tests` 共享文件，故实际执行时串行，避免共享工作区冲突）
- **Worker**：@designer
- **验证**：类型检查与构建；人工审阅布局和 OpenCode TUI slot API 使用。

#### sidebar-docs

- **目标**：补充 README 双入口安装配置、sidebar 行为和启用 observer 的说明。
- **Files**：`README.md`
- **Depends on**：无
- **Worker**：@fixer
- **验证**：Markdown 内容检查；不得改动代码。

### Wave 2

#### sidebar-verification

- **目标**：串行整合全部变更并执行最终检查。
- **Files**：无（只读验证）
- **Depends on**：`sidebar-tests`、`sidebar-ux-review`、`sidebar-docs`
- **Worker**：Sisyphus
- **验证**：`bun test`、`bun run typecheck`、`bun run build`、`git diff --check`。
