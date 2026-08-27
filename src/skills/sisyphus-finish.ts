import type { SkillDefinition } from './types';

const SISYPHUS_FINISH_SKILL: SkillDefinition = {
  name: 'sisyphus-finish',
  description: 'Phase 6 — Finish：只读 Review 报告并完成交付汇总。',
  slash: true,
  content: `---
name: sisyphus-finish
description: Phase 6 — Finish：只读 Review 报告并完成交付汇总。
input: Review 报告、Ledger 与 workspaceRef
owner: Sisyphus
output: 最终交付摘要
entry: Review 报告已生成
exit: 依据报告完成汇总
failure: 报告缺失或有缺口则如实说明
verification: 只读检查 Review 报告完整性
humanReview: none
---

# Sisyphus Phase 6 — Finish

Sisyphus 主 Agent 持有最终交付上下文；不委派任何 agent。

只读取固定路径 Review v1 报告、Ledger 与 workspaceRef，调用 \`decideFinish\` 判定是否完成，再汇总结果与剩余不确定性。Finish 不测试、不构建、不调用 CBM、不委派 subagent，也不修改文件。
`,
};

export { SISYPHUS_FINISH_SKILL };
