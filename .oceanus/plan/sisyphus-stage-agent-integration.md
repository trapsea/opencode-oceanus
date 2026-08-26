# Sisyphus 阶段 Agent 分工集成计划

## 策略

- TDD：先新增 skill 内容契约测试，再按阶段顺序修改 skill。
- 工作区：当前共享工作区、单 writer 串行；不创建 worktree，不执行 Git 操作。
- 交付：只修改 Sisyphus skill、skill 契约测试及必要文档，不改变 runtime supervisor。

## 文件映射

- `src/skills/sisyphus-brainstorm.ts`：Metis 调用时机、分析字段和 spec 沉淀。
- `src/skills/sisyphus-plan.ts`：Momus verdict、REJECT 回退和 plan 状态字段。
- `src/skills/sisyphus-execute.ts`：计划变更时重新进入 plan/Momus 门禁。
- `src/skills/sisyphus-review.ts`：Sisyphus/Oracle Review 边界，Momus 不作为默认代码审查者。
- `src/skills/index.ts`、`src/skills/stages.test.ts`：skill 聚合和阶段契约测试。
- `README.md`：同步五阶段 Agent 分工和产物。

## 顺序任务

### sisyphus-stage-1-contract-tests

- Wave：1
- Depends on：无
- Files：`src/skills/stages.test.ts`
- 目标：先写失败契约，验证四个阶段 skill 分别包含 Metis、Momus、计划变更、Oracle Review 和产物门禁语义。
- 验证：新测试在实现前红灯；不修改生产 skill。

### sisyphus-stage-2-brainstorm

- Wave：2
- Depends on：sisyphus-stage-1-contract-tests
- Files：`src/skills/sisyphus-brainstorm.ts`
- 目标：把 Metis 集成到 brainstorm，要求分析进入 spec，并支持禁用/跳过记录。
- 验证：skill 契约测试对应断言转绿。

### sisyphus-stage-3-plan

- Wave：3
- Depends on：sisyphus-stage-2-brainstorm
- Files：`src/skills/sisyphus-plan.ts`
- 目标：把 Momus 集成到 plan，要求 verdict、问题、修订轮次落盘，REJECT 阻止 execute。
- 验证：skill 契约测试对应断言转绿。

### sisyphus-stage-4-execute-review

- Wave：4
- Depends on：sisyphus-stage-3-plan
- Files：`src/skills/sisyphus-execute.ts`, `src/skills/sisyphus-review.ts`
- 目标：规定计划变更时重新走 Momus；明确 Review 由 Sisyphus + Oracle 主导，Momus 不默认审代码。
- 验证：skill 契约测试对应断言转绿，类型检查通过。

### sisyphus-stage-5-docs-regression

- Wave：5
- Depends on：sisyphus-stage-4-execute-review
- Files：`README.md`
- 目标：同步阶段 Agent 分工、spec/plan 产物和门禁语义。
- 验证：文档与 skill 文案一致；运行全量测试、类型检查和构建。

## 验收标准

- 每个阶段都有明确主负责人、协作 Agent、输入、输出和跳过条件。
- Metis 结果进入 spec；Momus verdict 进入 plan 状态。
- Momus REJECT 或计划实质变化不会直接进入 execute。
- Review 不把 Momus 错写成 Oracle 的替代者。
- Agent 禁用时不伪造已完成的分析/检查。

## Review 返工补充任务

### sisyphus-stage-6-review-fixes

- Wave：6
- Depends on：sisyphus-stage-5-docs-regression
- Files：`src/skills/sisyphus-plan.ts`, `src/skills/sisyphus-execute.ts`, `src/skills/sisyphus-review.ts`, `src/agents/sisyphus.ts`, `src/skills/stages.test.ts`, `.oceanus/spec/sisyphus-stage-agent-integration.md`
- 目标：统一需求变更时 Metis→plan→Momus 的重规划语义，补充 finish 无专属 skill 的诚实说明，并增加遗漏契约测试。
- 验证：阶段契约测试、类型检查、全量测试和构建通过；Oracle 发现项全部有对应修复证据。

### sisyphus-stage-7-sidebar-config-audit

- Wave：7
- Depends on：sisyphus-stage-6-review-fixes
- Files：`src/tui.tsx`, `src/tui.test.ts`, `src/index.ts`, `src/agents/index.ts`, `src/agents/index.test.ts`（按审计结果最小修改）
- 目标：确认 sidebar 的 Agent 过滤/排序/同步能够展示 `metis`、`momus`，并确认 v2 `agent.transform` 生成的 Agent 配置包含二者；若当前实现已满足，仅补验证测试和文档证据，不做无必要改动。
- 验证：sidebar Agent 名称契约、生成 definitions/transform 注册契约、类型检查和全量测试通过；明确说明“生成配置”是运行时 v2 Agent.Info transform，而非仓库内静态 JSON 文件。
