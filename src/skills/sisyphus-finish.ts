import type { SkillDefinition } from './types';

type ReviewStatus = 'accepted' | 'pending' | 'rejected' | 'missing';
type CompletionStatus = 'green' | 'red' | 'incomplete';
type LedgerStatus = 'complete' | 'failed' | 'blocked' | 'pending';
type MomusStatus = 'OKAY' | 'REJECT' | 'PENDING' | 'missing';
type HumanStatus = 'APPROVED' | 'REJECTED' | 'PENDING' | 'missing';
type EvidenceStatus = 'fresh' | 'stale' | 'missing';

export interface FinishInput {
  review: ReviewStatus;
  completion: CompletionStatus;
  ledger: LedgerStatus;
  momus: MomusStatus;
  human: HumanStatus;
  evidence: EvidenceStatus;
}

export interface FinishDecision { complete: boolean; gaps: string[] }

export function decideFinish(input: FinishInput): FinishDecision {
  const gaps: string[] = [];
  if (input.review !== 'accepted') gaps.push(`Review ${input.review}`);
  if (input.completion !== 'green') gaps.push(`Completion Matrix ${input.completion}`);
  if (input.ledger !== 'complete') gaps.push(`ledger ${input.ledger}`);
  if (input.momus !== 'OKAY') gaps.push(`Momus ${input.momus}`);
  if (input.human !== 'APPROVED') gaps.push(`human ${input.human}`);
  if (input.evidence !== 'fresh') gaps.push(`evidence ${input.evidence}`);
  return { complete: gaps.length === 0, gaps };
}

const SISYPHUS_FINISH_SKILL: SkillDefinition = {
  name: 'sisyphus-finish',
  description: 'Phase 6 — Finish：依据 Review、Completion Matrix、ledger 与 Gate Status 自包含判定交付状态。',
  slash: true,
  content: `---
name: sisyphus-finish
description: Phase 6 — Finish：依据 Review、Completion Matrix、ledger 与 Gate Status 自包含判定交付状态。
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

SDD 开启时读取固定路径 Review v1 报告、Ledger 与 workspaceRef；SDD 关闭时使用会话内的 review 结论与任务状态。Finish 必须调用并遵守导出的 decideFinish 纯函数，严格默认拒绝：仅当六类输入同时精确为 Review accepted（Review 报告存在）、Completion Matrix green（全绿）、ledger complete（无 failed/blocked/pending）、Momus OKAY、human APPROVED、evidence fresh 时才判定完成（human APPROVED 指有效的 Brainstorm 单次总批准，即 plan gate status 中 human: { status: 'APPROVED', via: 'consolidated' }；需求或验收标准变化且未重新总批准时视为失效）。Review 报告缺失、Completion Matrix 未全绿、ledger 存在 failed、ledger 存在 blocked、ledger 存在 pending、Gate Status 为 PENDING、Review 非 accepted、Momus 非 OKAY、human 非 APPROVED 或 evidence stale/missing 均不得宣称完成。任一条件不满足都必须明确输出缺口和不确定性（包括具体状态与缺失证据）。Finish 不测试、不构建、不调用 CBM、不委派 subagent，也不修改文件。
`,
};

export { SISYPHUS_FINISH_SKILL };
