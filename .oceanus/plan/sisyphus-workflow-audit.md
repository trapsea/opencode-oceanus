# Sisyphus 工作流审计计划

## 策略

- 类型：只读非代码分析。
- TDD：不适用；无生产代码变更。
- Worktree：不创建；使用当前工作区只读检查。
- 设计依据：`.oceanus/spec/sisyphus-workflow-audit.md`。

## 任务图

### AUDIT-1：核对流程事实

- Wave：1
- Depends on：无
- Files：`src/agents/sisyphus.ts`、`src/skills/sisyphus-*.ts`、`src/agents/*.ts`、`src/index.ts`、`src/skills/index.ts`
- 目标：核对六阶段定义、角色、产物、门禁、CBM/ledger/任务调度证据。
- 验证：每项事实带文件路径和行号；无代码修改。

### AUDIT-2：核对文档与实现漂移

- Wave：1
- Depends on：无
- Files：`README.md`、`docs/**/*.md`、`scripts/verify-dist-skills.ts`、`.oceanus/spec/**/*.md`
- 目标：找出阶段数量、Skill 数量、运行时保证和历史文档之间的不一致。
- 验证：形成漂移清单并区分已证实与不确定项；无代码修改。

### AUDIT-3：形成审核矩阵与优化路线

- Wave：2
- Depends on：AUDIT-1、AUDIT-2
- Files：无仓库文件（最终回答）
- 目标：按用户/Agent/自动验证分类审核点，评估瓶颈并按优先级提出收益、代价、风险。
- 验证：覆盖全部验收标准，包含当前缺失的最终人工验收结论。

### AUDIT-4：独立质量复核

- Wave：3
- Depends on：AUDIT-3
- Files：无仓库文件（复核意见）
- 目标：检查结论是否把 Prompt 约束误写成运行时能力，是否遗漏边界和证据。
- 验证：@oracle 独立指出需修正的事实或风险；无代码修改。

## 计划门禁

- Momus：任务为只读低风险分析，跳过复杂实现门禁；理由是没有执行阶段、无代码写入、无依赖变更。跳过不代表已获得 `OKAY`。
- 用户策略确认：已确认无 TDD、无 Worktree、只读当前工作区。
