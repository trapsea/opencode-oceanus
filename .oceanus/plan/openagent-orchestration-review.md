# OpenAgent 与 Oceanus Agent 编排复核计划

## 策略

- 交付类型：只读研究报告，不修改 `src/**` 实现。
- 验证策略：源码/官方文档证据索引、结论一致性、路径/URL 自检；不新增代码 TDD。
- 工作区：共享工作区、单 writer；worker 不执行 Git 操作，不修改报告范围外文件。

## 文件

- `docs/openagent-orchestration-review.md`：最终中文详细对比报告。
- `.oceanus/spec/openagent-orchestration-review.md`：已批准范围与决策。
- `.oceanus/progress/openagent-orchestration-review.md`：任务账本。

## 任务

### openagent-review-1-report（Wave 1）

- 目标：依据已完成的 Oceanus 源码梳理与 `code-yeongyu/oh-my-openagent` 官方文档研究，撰写详细对比报告。
- Files：`docs/openagent-orchestration-review.md`。
- Depends on：无。
- 验证：报告覆盖注册/路由、task、权限、prompt、模型、reload、hooks、并行/恢复；每个关键判断标注证据和不确定性；给出 P0/P1/P2 路线与不建议移植项。

### openagent-review-2-final-check（Wave 2）

- 目标：主协调器审阅报告与当前源码/既有三方对比文档，检查事实、链接、文件路径、许可证措辞和范围边界。
- Files：只读检查；必要时只修复 `docs/openagent-orchestration-review.md`。
- Depends on：openagent-review-1-report。
- 验证：关键路径 grep/read、URL/仓库名称自检、git status 审查；所有账本任务进入终态。
