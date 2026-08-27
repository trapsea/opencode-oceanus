# Sisyphus 上下文优先与条件委派设计

## 目标

让 Sisyphus 优先使用当前主会话上下文，避免把已经由主 Agent 和用户共同确认的需求再次交给 subagent 重复理解；同时保留专业能力、独立审查、大输入隔离和并行执行带来的委派收益。

## 已确认决策

- Intake 由 Sisyphus 直接完成，不再默认或强制指派 `@metis`。
- 对代码/混合任务，Sisyphus 在 Intake 直接尝试执行一次 `cbm_index`；失败、超时或 `in-progress` 时 fail-open，并记录证据和残余风险。
- `@metis` 保留，仅在 Intake 已完成后、用户澄清仍留下未决方案选择、且主 Agent明确需要独立分析时使用 `SOLUTION_ANALYSIS`；复杂度、多文件或高风险本身不是触发条件。
- 用户澄清、需求取舍、设计批准、TDD/Worktree 选择由 Sisyphus 完成。
- `@momus` 仍是复杂计划进入 Execute 前的独立门禁。
- `@oracle` 只用于高风险、复杂故障或需要独立反驳的 Review。
- Execute 只委派边界明确、可独立验证且文件范围不冲突的实现任务。
- Finish 由 Sisyphus 直接收口，不委派 subagent。
- 本轮只调整 prompt、skill、文档和契约测试，不改 task 运行时协议或引入自动路由器。

## 委派决策原则

1. 用户决策和已确认事实始终归 Sisyphus 所有。
2. 若当前上下文足以完成一次局部、低风险、紧耦合操作，则直接处理。
3. 只有在获得额外专业能力、独立视角、大输入隔离或并行产能时才委派。
4. 委派前必须说明委派理由、目标、Files、依赖、验收标准和 validation owner。
5. 不因“任务复杂”这一单一标签机械委派；判断委派收益是否超过上下文交接成本。
6. 已有有效 Intake/spec/plan 不得被同类 subagent 重复分析。
7. Brainstorm 不得仅因多文件、高风险或任务复杂就调用 Metis；只有 Intake 已完成、澄清后仍存在未决方案选择，且确实需要独立分析时才调用。

## 阶段职责

| 阶段 | 主负责人 | 条件委派 |
| --- | --- | --- |
| Intake | Sisyphus | 直接完成需求/背景分析并按任务类型执行一次 CBM；不调用 Metis |
| Brainstorm | Sisyphus | 宽范围代码探索交给 Explorer；仅在 Intake 已完成、澄清后仍有未决方案选择且需要独立视角时调用 Metis |
| Plan | Sisyphus | 复杂计划交 Momus 做独立质量门禁 |
| Execute | Sisyphus | 非平凡、边界清晰、无冲突的实现交 Fixer 并行执行 |
| Review | Sisyphus | 高风险或需独立反驳时交 Oracle；多媒体输入交 Observer |
| Finish | Sisyphus | 不委派 |

## 非目标

- 不移除 Metis、Momus、Oracle 或其他 specialist。
- 不把所有代码实现收回 Sisyphus。
- 不在本轮新增确定性运行时调度器或 Context Envelope。
