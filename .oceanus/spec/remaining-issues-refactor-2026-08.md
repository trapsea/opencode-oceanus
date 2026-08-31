# Oceanus 剩余问题分 Wave 修复设计

## 目标

基于当前工作区逐项修复 docs/prompt-workflow-review-2026-08.md 中仍存在或部分存在的问题。已完成的问题 1（sections 化）和 2（Workflow/Verify 编号）不重复实施，但必须保留并回归验证。

## 范围

- 处理问题 3-18：协议重复、语言与格式、双门禁、Metis 触发、Oceanus/Sisyphus 边界、运行时守卫、影响面预估、Finish 幽灵引用、证据分级、Review CBM 降级、禁用 Agent 过滤、杂项、CBM CLI 参数和 daemon 冷启动状态。
- 保留现有未提交改动；不回滚、不覆盖与本任务无关的工作区变化。
- 问题 17 与 18 联合设计和验证。

## 非目标

- 不引入 team mode、council、长期 memory、ACP 或完整 BackgroundJobBoard。
- 不修改已完成的工具安全边界，除非 CBM CLI 参数迁移需要直接影响。
- 不把 CBM advisory 证据升级为权限或完成事实。

## 已确认决策

- 分 Wave 执行，每个 Wave 完成后运行针对性测试。
- 启用 SDD，流程文件位于 `.oceanus/`。
- 普通 Prompt/Skill 文本改动保留现有中英结构，但同一文件内统一职责，工具参数示例与说明正文分开。
- CBM 所有失败保持 fail-open；`starting`、`stale`、`failed` 必须可区分。

## 风险与边界

- 工作区已有未提交改动，测试与 diff 审查必须区分本次改动和基线改动。
- CBM daemon 当前曾出现 30 秒接入超时，真实 daemon 验证可能受环境影响；必须使用 mock/注入测试覆盖状态机，并诚实记录真实 Host 限制。
- OpenCode beta CLI 参数可能同时存在旧版和新版，迁移必须保留兼容回退，不得静默误报成功。

## 验收标准

1. 公共协议、Metis 触发、终态和运行时守卫有单一来源或明确职责边界。
2. 双门禁能获取并记录 `human: APPROVED/PENDING/REJECTED`，Execute 不得绕过人工批准。
3. Plan 声明 evidence tier，Execute/Review 按 tier 验证。
4. Finish 不再引用未定义的 `decideFinish`，可依据 Review、矩阵、ledger 和门禁状态自包含判定。
5. CBM CLI 使用新版参数通道并保留兼容策略；daemon `starting` 不再被立即等同于 failed。
6. 所有受影响测试、类型检查和构建通过；真实 Host/CLI 无法运行时标注降级证据。
