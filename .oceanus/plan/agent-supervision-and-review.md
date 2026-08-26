# Agent 监督、方案分析与检查实施计划

## 策略

- TDD：先补 Agent/权限/prompt 契约测试，再实现。
- 工作区：共享工作区、单 writer 串行；不创建 worktree、不执行 Git 操作、不修改无关功能。
- 默认：`metis`/`momus` 启用；六个只读 Agent 使用默认硬权限矩阵，配置可覆盖。

## 文件关系

- `src/agents/metis.ts`、`src/agents/momus.ts`：新增只读专家定义。
- `src/agents/index.ts`、`src/config/constants.ts`：扩展 Agent 名称、工厂、默认模型/启停集合。
- `src/agents/oceanus.ts`：新增 metis/momus 路由描述、触发条件和能力边界。
- `src/agents/sisyphus.ts`：新增复杂任务 metis→momus→execute 门禁协议。
- `src/index.ts`：把默认只读权限映射到 Agent v2 permissions，同时保留用户配置覆盖。
- `src/agents/index.test.ts`、必要的 config 测试：契约与回归。
- `README.md`、`docs/three-way-capability-comparison.md`：同步 Agent 清单和当前能力/路线状态。

## 任务

### agent-review-1-contract-tests（Wave 1）

- 目标：先补 metis/momus 注册、默认启用/disabled_agents、只读权限和 prompt 门禁契约测试。
- Files：`src/agents/index.test.ts`、必要的 `src/config/*.test.ts`。
- Depends on：无。
- 验证：测试在实现前按预期失败或暴露缺失 API；现有 Agent 测试不被破坏。

### agent-review-2-implementation（Wave 2）

- 目标：实现 metis/momus、扩展 Agent 聚合和默认只读权限矩阵，更新 Oceanus/Sisyphus 编排 prompt；保持 oracle 职责和 preset reload 不变。
- Files：`src/agents/metis.ts`、`src/agents/momus.ts`、`src/agents/index.ts`、`src/config/constants.ts`、`src/agents/oceanus.ts`、`src/agents/sisyphus.ts`、`src/index.ts`。
- Depends on：agent-review-1-contract-tests。
- 验证：专项 Agent/config 测试转绿、类型检查通过；复杂任务门禁明确为 prompt 协议，不伪造运行时自动监督。

### agent-review-3-docs（Wave 3）

- 目标：更新 Agent 清单、对比文档和使用边界，明确 metis/momus 默认启用、只读、复杂任务门禁及可跳过条件。
- Files：`README.md`、`docs/three-way-capability-comparison.md`。
- Depends on：agent-review-2-implementation。
- 验证：文档名称/角色/默认启用状态与源码常量和测试一致。

### agent-review-4-final-regression（Wave 4）

- 目标：全量回归并审查 diff，确认无旧 Agent 清单遗漏、无权限误配、无未关闭账本任务。
- Files：只读检查。
- Depends on：agent-review-3-docs。
- 验证：`bun test`、`bun run typecheck`、`bun run build`、Agent 名称 grep、账本终态检查。
