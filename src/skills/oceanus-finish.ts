import type { SkillDefinition } from './types';

type ReviewStatus = 'accepted' | 'pending' | 'rejected' | 'missing';
type CompletionStatus = 'green' | 'red' | 'incomplete';
type LedgerStatus = 'complete' | 'failed' | 'blocked' | 'pending';
type EvidenceStatus = 'fresh' | 'stale' | 'missing';

export interface FinishInput {
  review: ReviewStatus;
  completion: CompletionStatus;
  ledger: LedgerStatus;
  evidence: EvidenceStatus;
}

export interface FinishDecision { complete: boolean; gaps: string[] }

export function decideFinish(input: FinishInput): FinishDecision {
  const gaps: string[] = [];
  if (input.review !== 'accepted') gaps.push(`Review ${input.review}`);
  if (input.completion !== 'green') gaps.push(`Completion Matrix ${input.completion}`);
  if (input.ledger !== 'complete') gaps.push(`ledger ${input.ledger}`);
  if (input.evidence !== 'fresh') gaps.push(`证据 ${input.evidence}`);
  return { complete: gaps.length === 0, gaps };
}

const OCEANUS_FINISH_SKILL: SkillDefinition = {
  name: 'oceanus-finish',
  category: 'phase',
  description: '阶段 6——Finish：依据审查、完成矩阵、ledger 与证据自包含判定交付状态；只做正常只读交付汇总。',
  slash: true,
  content: `---
name: oceanus-finish
category: phase
description: 阶段 6——Finish：依据审查、完成矩阵、ledger 与证据自包含判定交付状态；只做正常只读交付汇总。
input: Review 报告、Ledger 与 workspaceRef
owner: Sisyphus
output: 最终交付摘要
entry: Review 报告已生成
exit: 依据报告完成汇总
failure: 报告缺失或有缺口则如实说明
verification: 只读检查 Review 报告完整性
humanReview: none
---

# Sisyphus 阶段 6——Finish

Sisyphus 主 Agent 持有最终交付上下文；不委派任何 agent。

所有任务均在当前目录完成；finish 只做状态与交付证据汇总。

  SDD 开启时读取固定路径 Review v1 报告、Ledger 与 workspaceRef；SDD 关闭时使用会话内的 review 结论与任务状态。Finish 必须调用并遵守导出的 decideFinish 纯函数，严格默认拒绝：仅当四类输入同时精确满足 Review（accepted）、Completion Matrix（green）、ledger（complete）、evidence（fresh）时才判定完成。Oracle advisory 不是完成条件；如曾调用 Oracle，应将其建议与采纳情况作为 Review 证据的一部分记录。任一条件不满足都必须明确输出缺口和不确定性。Finish 不测试、不构建、不调用 CBM、不委派 subagent、不修改文件，只做正常只读交付汇总。
`,
};

export { OCEANUS_FINISH_SKILL };
