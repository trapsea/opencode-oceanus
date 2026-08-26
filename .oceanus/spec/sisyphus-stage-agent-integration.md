# Sisyphus 阶段 Agent 分工集成设计

## 目标

把 `metis`/`momus` 从 Sisyphus 总提示词中的软性说明，落实到各阶段 skill 的步骤、输入、输出和门禁中，形成可执行、可审计的五阶段职责链。

## 阶段职责

- **brainstorm**：`sisyphus` 负责需求澄清和方案决策；复杂任务先调用只读 `metis`，将需求缺口、风险、边界、反例和验收标准吸收进最终 `.oceanus/spec/`。`explorer`/`librarian`/`observer`/`oracle` 按需提供证据。
- **plan**：`sisyphus` 负责文件映射、任务拆分、依赖、Wave、TDD、Worktree 和 ledger；计划形成后调用只读 `momus`，将 `OKAY/REJECT`、问题和修订轮次写入 plan 状态；`REJECT` 不得进入 execute。
- **execute**：`sisyphus` 负责调度和事实验证，`fixer`/`designer` 负责有界实现；需求或验收标准变化时先重新调用 `metis`，再修订 plan 并调用 `momus`；仅计划结构调整或执行失败需要重规划时，可修订 plan 后重新调用 `momus`。
- **review**：`sisyphus` 负责证据化审查和 Completion Audit；`oracle` 负责高风险架构/复杂代码独立审查；`momus` 不作为默认实现审查者，避免与 oracle 职责重叠。
- **finish**：`sisyphus` 负责最终测试、构建、ledger 收口和不确定性报告，默认不再调用方案 Agent。

## 产物与门禁

- spec 必须包含 Metis 分析摘要或明确记录其被禁用/跳过及原因。
- plan 必须包含 Momus verdict、问题清单、修订轮次或明确记录其被禁用/跳过及原因。
- 需求/验收标准发生变化时，必须先重新获得 Metis 分析，再回到 plan 并重新获得 Momus `OKAY`；仅计划结构调整时回到 plan 并重新获得 Momus `OKAY`。
- Agent 被配置禁用时，工作流不得声称已经完成对应分析或检查。
- 所有门禁均为 Sisyphus prompt/skill 工作流约束，不实现插件级自动 supervisor。

## 非目标

- 不新增 runtime Hook 自动启动监督 Agent。
- 不让 Momus 替代 Oracle 的代码/架构 Review。
- 不改变 task 宿主生命周期、preset reload 或 Agent 模型策略。
