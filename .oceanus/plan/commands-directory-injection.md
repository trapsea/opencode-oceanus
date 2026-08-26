# Commands 目录化与注入实施计划

## 策略

- TDD：先增加聚合与注册契约测试，再实现目录拆分。
- 工作区：共享工作区；本次单 writer 串行执行，不创建 worktree、不执行 Git 操作、不修改无关未提交文件。
- 验证：专项 commands 测试 → 全量 `bun test` → `bun run typecheck` → `bun run build`。

## 文件关系

- `src/commands/index.test.ts`：先行定义聚合工厂和 command 形状契约。
- `src/commands/types.ts`：command 定义、调用和注入依赖的最小类型。
- `src/commands/preset.ts`：迁移现有 preset 逻辑与工厂。
- `src/commands/index.ts`：聚合 command 工厂并导出公共 API。
- `src/index.ts`：从聚合工厂获取数组并逐个注入 `ctx.command.transform`。
- `src/commands.ts`：删除旧单文件实现；现有 `./commands` 导入由目录 `index.ts` 接管。

## 任务

### commands-1-contract-tests（Wave 1）

- 目标：先增加目录化 command 聚合和 v2 注册契约测试，覆盖 command 数组、`preset` 名称/定义形状以及依赖注入调用。
- Files：`src/commands/index.test.ts`。
- Depends on：无。
- 验证：测试先运行，预期在实现完成前失败或无法导入，记录失败原因；不得修改生产代码。

### commands-2-directory-implementation（Wave 2）

- 目标：将旧 `commands.ts` 拆入目录结构，建立类型、preset 模块和聚合工厂；修改插件入口遍历注入所有 commands，保持现有 preset 行为和 reload/reply 依赖注入。
- Files：`src/commands/types.ts`、`src/commands/preset.ts`、`src/commands/index.ts`、`src/index.ts`、删除 `src/commands.ts`。
- Depends on：commands-1-contract-tests。
- 验证：commands 专项测试、现有 preset 测试、类型检查通过；入口不再直接引用 `createPresetCommand`。

### commands-3-final-regression（Wave 3）

- 目标：审查 diff 和目录聚合扩展点，运行全量验证，确保无旧导入、无重复注册、无未关闭任务。
- Files：只读检查；必要时仅修复 commands 相关测试/文档。
- Depends on：commands-2-directory-implementation。
- 验证：`bun test`、`bun run typecheck`、`bun run build`、grep 旧导入、git diff/status 审查；所有账本任务进入终态。
