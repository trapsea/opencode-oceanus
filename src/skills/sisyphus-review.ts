import type { SkillDefinition } from './types';

const SISYPHUS_REVIEW_SKILL: SkillDefinition = {
  name: 'sisyphus-review',
  description:
    '第 5 阶段——审查：每个阶段结束后执行基于证据的审查门禁，将高强度审查交给 @oracle，并在接受任何发现前用证据核实。由 sisyphus agent 在审查阶段开始时加载。',
  slash: true,
  content: `---
name: sisyphus-review
input: 实现、plan、evidence、tests 与 completionMatrix
owner: Sisyphus 主 Agent（subagent 只读；Oracle 仅条件委派）
output: review 报告
entry: execute 完成
exit: 验收证据齐全
failure: 缺口退回 execute
verification: 主流程测试与 evidence 审查
humanReview: conditional
description: Sisyphus 工作流的第 5 阶段——审查。每个阶段结束后执行基于证据的审查门禁，将高强度审查交给 @oracle，并在接受任何发现前用证据核实。
---

# Sisyphus 第 5 阶段——审查

## 目标
Sisyphus 主 Agent 持有 spec/plan/diff/evidence 上下文与最终门禁；仅对高风险架构、持续故障或安全敏感问题条件委派 @oracle。

在阶段之间使用证据而非直觉发现缺陷和设计偏移。

## 步骤
0. **当前目录范围**——审查始终针对当前目录中的实际 diff 执行；不创建或合并隔离工作区。
1. **审查查询前规划 CBM 预算**——先根据实际 diff 分类：纯文档 diff（仅 Markdown、注释或文案，且不影响代码契约）跳过 \`cbm_index\`，记录 \`cbm: skipped (docs-only)\`。其余 diff 在 Review 开始直接调用 \`cbm_index\` 重建索引，成功后再执行查询：首次尝试最多 30 秒；若状态为 starting/in-progress 或超时，最多再重试一次、最多 60 秒；总预算严格为 90 秒。成功后再进入影响面复查。预算耗尽、失败或工具不可用时记录 \`cbm: stale\`，改用 grep/read 与手工 diff 复查，记录降级证据但不得阻断 Review。
2. **在实际 diff 上重新检查影响面**——用 \`cbm_trace\`/\`cbm_detect_changes\` 对实际 diff 再次排查影响面；以实际代码为准，不用 plan 期预估替代复查。优先增量检测并复用已覆盖的符号结论，只对未覆盖符号做增量 trace。
3. **与 momus 预估对比**——将复查结果与 plan status 中 momus 的影响面预估对比（Momus 审核=关时无预估可对比，跳过该对比并记录 \`momus: skipped\`）：一致 → 记为验证证据；不一致（新调用方受影响/预估遗漏）→ 解释差异或退回 execute。同时将每任务实际实现 diff 行数与 plan 预估行数对比，偏差显著（如 >50%）记为 plan 质量信号（不阻断门禁）。
4. **执行审查门禁**——每个阶段结束后，在继续之前根据 spec 和 plan 审查实际输出。
5. **接受前验证**——对于任何发现，在采取行动前用证据（阅读代码、运行检查）确认它。
6. **将高强度审查升级给 @oracle**——将高风险架构决策、持续性故障或安全敏感审查交给 @oracle。
7. **执行门禁，不要跳过**——审查是阶段之间的门禁，而非可选附加项。已知声明未经验证时，不得推进到 execute 或 finish。

## 审查职责

Review subagent 只读检查，不修改代码、不运行 task；测试由 Review 主流程执行。Momus 审查 evidence、tests 与 completionMatrix，不默认替代代码审查。SDD 开启时报告写入 \`.oceanus/review/Review v1.md\`；SDD 关闭时 review 结论在会话内呈现，不落盘。

- **Sisyphus** 负责 spec/plan/diff 审查、测试验证和完成审计；采取行动前用证据验证每项发现。
- **@oracle** 负责高风险架构审查、复杂故障诊断和独立代码审查。将高强度或独立审查交给 @oracle，而不是自行执行。
- **Momus 不是默认的实现或代码审查 agent**——Momus 审查 plan（第 3 阶段），而不是代码，且不能替代 @oracle 进行独立代码审查。
- **咨询性发现不会转移职责**——如果某项发现仅检查实现是否偏离 plan，将其记录为咨询性发现，并保持上述主要审查职责不变。

## 完成矩阵（固定格式）
审查报告必须逐行使用 \`criterion -> evidence -> status -> gap/next action\`：
\`\`\`markdown
| criterion | evidence（命令/输出或当前 diff 状态） | status | gap / next action |
|---|---|---|---|
\`\`\`
逐条覆盖 Spec acceptance criteria、Plan 每个 Task acceptance criteria，以及测试、构建、real-surface 证据；缺口必须具体指出缺哪个准则和证据，并回退 execute，不得只写 \`review failed\`。
## 完成审计（覆盖矩阵）

在接受任何任务或场景确实完成之前，执行完成审计：将每项成功标准作为一行，将收集到的证据作为这些行的覆盖情况。

1. **构建矩阵**——对于每个计划中的任务/场景，列出其成功标准（行）和收集到的证据（测试、人工 QA、CLI/实时输出、代码审查、构建产物）。
2. **要求覆盖**——每项准则至少必须由一条可验证证据覆盖。没有证据的准则就是缺口。
3. **将不确定性视为未达成**——如果无法用证据确认某项准则，即使工作看似完成，也不能视为完成。绝不接受口头的“已完成”。
4. **报告缺口**——存在任何缺口时，不得将任务标记为完成；列出缺失准则并退回 execute，以补充证据或完成实现。按 evidence tier 审计：Tier 1（可复现测试/构建输出）优先，Tier 2（绑定当前 diff 的人工代码审查/CLI 输出）可覆盖其余准则，Tier 3（口头或未绑定状态的声明）不计入证据。任何缺口都退回 execute，最多 3 轮；第 3 轮仍有未覆盖准则时停止自动重试，按 3 轮中断上报模板用 \`question\` 上报（模板须含推荐项及理由）。
5. **证据必须可审计**——优先将每条证据绑定到其时间点/git 状态；如果代码发生变化，旧证据即已过时，必须针对当前状态重新记录，绝不将其重新粘贴或生成后当作新证据。
6. **矩阵全绿才算完成**——每项准则都有证据时，任务才真正完成；否则仍未完成。

## 检查清单
- [ ] 已根据 spec 和 plan 审查输出
- [ ] 已用证据验证发现
- [ ] 在必要时已将高强度审查升级给 @oracle
- [ ] 仅在门禁通过后推进阶段
- [ ] 已执行完成审计：每项准则均有证据覆盖（矩阵全绿）

## 规则
- 审查是阶段之间的门禁，而非可选附加项。
- 除非最终状态发生变化，否则不要重复已有证据。
- 如果某项发现无法验证，应明确说明不确定性，而不是自行假定。
- **CBM 边界**：对变更入口与影响面做独立验证——按步骤 1-3 复查流程执行（重建索引 → 对实际 diff 再次排查 → 与 momus 预估对比，一致记为验证证据、不一致解释或退回 execute）；CBM 不可用时明确记录降级证据。
- **CBM 预算与 fail-open**：纯文档 diff 不初始化；非文档 diff 遵守 30s + 最多一次 60s 重试、总预算 90s。失败只标记 \`cbm: stale\` 并用 grep/read+手工 diff 继续，不能把 CBM 故障当作 Review 失败。
- 在将任何任务标记为真正完成前执行完成审计；缺口（未覆盖准则）应退回 execute，不得接受。
`,
};

export { SISYPHUS_REVIEW_SKILL };
