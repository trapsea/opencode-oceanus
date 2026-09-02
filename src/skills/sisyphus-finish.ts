import type { SkillDefinition } from './types';

type ReviewStatus = 'accepted' | 'pending' | 'rejected' | 'missing';
type CompletionStatus = 'green' | 'red' | 'incomplete';
type LedgerStatus = 'complete' | 'failed' | 'blocked' | 'pending';
type MomusStatus = 'OKAY' | 'REJECT' | 'PENDING' | 'missing' | 'waived';
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
  if (input.momus !== 'OKAY' && input.momus !== 'waived') gaps.push(`Momus ${input.momus}`);
  if (input.human !== 'APPROVED') gaps.push(`human ${input.human}`);
  if (input.evidence !== 'fresh') gaps.push(`evidence ${input.evidence}`);
  return { complete: gaps.length === 0, gaps };
}

const SISYPHUS_FINISH_SKILL: SkillDefinition = {
  name: 'sisyphus-finish',
  description: 'Phase 6 — Finish：依据 Review、Completion Matrix、ledger 与 Gate Status 自包含判定交付状态；worktree 模式下执行需求级合并收尾。',
  slash: true,
  content: `---
name: sisyphus-finish
description: Phase 6 — Finish：依据 Review、Completion Matrix、ledger 与 Gate Status 自包含判定交付状态；worktree 模式下执行需求级合并收尾。
input: Review 报告、Ledger 与 workspaceRef
owner: Sisyphus
output: 最终交付摘要
entry: Review 报告已生成
exit: 依据报告完成汇总
failure: 报告缺失或有缺口则如实说明
verification: 只读检查 Review 报告完整性；worktree 模式追加合并清理
humanReview: none
---

# Sisyphus Phase 6 — Finish

Sisyphus 主 Agent 持有最终交付上下文；不委派任何 agent。

SDD 开启时读取固定路径 Review v1 报告、Ledger 与 workspaceRef；SDD 关闭时使用会话内的 review 结论与任务状态。Finish 必须调用并遵守导出的 decideFinish 纯函数，严格默认拒绝：仅当六类输入同时精确为 Review accepted（Review 报告存在）、Completion Matrix green（全绿）、ledger complete（无 failed/blocked/pending）、Momus OKAY 或用户豁免 waived（waived 仅当用户在执行配置批问中关闭 Momus 审核且 plan status 已记录 SKIPPED_BY_USER 时有效，不得伪造）、human APPROVED、evidence fresh 时才判定完成（human APPROVED 指有效的 Brainstorm 方案总批准，即 plan gate status 中 human: { status: 'APPROVED', via: 'consolidated' }；需求或验收标准变化且未重新执行两问时视为失效）。Review 报告缺失、Completion Matrix 未全绿、ledger 存在 failed、ledger 存在 blocked、ledger 存在 pending、Gate Status 为 PENDING、Review 非 accepted、Momus 非 OKAY 且无有效豁免、human 非 APPROVED 或 evidence stale/missing 均不得宣称完成。任一条件不满足都必须明确输出缺口和不确定性（包括具体状态与缺失证据）。Finish 不测试、不构建、不调用 CBM、不委派 subagent；除 worktree 收尾外不修改文件——worktree 模式（需求级）下，decideFinish 判定 complete 后由 orchestrator 将 \`.worktrees/<plan-name>\` 一次性合并回主工作区（优先 \`git merge\`，冲突由 orchestrator 亲自解决，不推给 worker）并删除 worktree 与临时分支；判定 incomplete 或 review 未通过时保留 worktree 以便恢复，并如实报告未合并状态。合并与清理是 finish 唯一允许的写操作。
`,
};

export { SISYPHUS_FINISH_SKILL };
