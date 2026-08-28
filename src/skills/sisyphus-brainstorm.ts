import type { SkillDefinition } from './types';

const SISYPHUS_BRAINSTORM_SKILL: SkillDefinition = {
  name: 'sisyphus-brainstorm',
  description:
    'Phase 2 — Brainstorm: consume the Intake handoff, explore context, clarify requirements one question at a time via the question tool, propose 2-3 approaches with a recommendation, present the design in sections, get approval, and save the spec to .oceanus/spec/. Loaded by the sisyphus agent at the start of the brainstorm phase.',
  slash: true,
  content: `---
name: sisyphus-brainstorm
description: Phase 2 of the Sisyphus workflow — Brainstorm. Consume the Intake handoff, explore context, clarify requirements one question at a time, propose 2-3 approaches with a recommendation, get design approval, and save the spec to .oceanus/spec/.
input: intake_report
owner: Sisyphus
output: approved spec
entry: Intake 完成
exit: 用户批准 spec
failure: 暂停并记录未决问题
verification: 批准与 spec 审计
humanReview: required
---

# Sisyphus Phase 2 — Brainstorm

## Goal
Turn a vague request into an approved design spec before any code is written.

## Steps
1. **Consume Intake** — load the completed Intake handoff and use its goal, scope, acceptance criteria, risks, constraints, and open questions as the starting contract; do not silently rewrite Intake decisions.
2. **Explore context** — search the codebase, read relevant files, and identify what already exists before proposing anything. 仅做必要的架构/符号定位（cbm_search_graph/cbm_trace）；不因普通文本探索触发全量索引（brainstorm 不做全量索引初始化，复用 Intake 已建索引）。
2. **Clarify one question at a time** — use the \`question\` tool with a small bounded set of options (and custom input) to pin down requirements. Resolve one ambiguity per turn; do not batch-load the user with questions.
 3. **条件使用 @metis** — 完成 Intake 且澄清后仍存在未决方案选择时，只有 Sisyphus 明确需要独立分析才委派 \`@metis\`，使用 \`SOLUTION_ANALYSIS\` 模式。复杂度、多文件或高风险本身不触发；否则记录跳过原因。
4. **Propose 2-3 approaches** — each with a clear recommendation and the trade-offs (quality, speed, cost, risk), revised in light of @metis's analysis.
5. **Present the design in sections** — get explicit approval on the direction before writing any code.
6. **Save the approved spec** — write the design to \`.oceanus/spec/<name>.md\` so later phases can read it. Absorb @metis's analysis into the spec rather than leaving it only in context: the spec must include a "Metis 分析" section covering 需求缺口 / 风险 / 边界与非目标 / 反例与边界条件 / 验收标准 (or explicitly record when @metis was skipped and why).

## Checklist
- [ ] Context explored (files read, not guessed)
- [ ] Ambiguities resolved via \`question\`, one at a time
- [ ] 仅按未决方案选择且 Sisyphus 明确需要独立分析的条件调用 @metis，否则记录理由
- [ ] 2-3 approaches presented with a recommendation
- [ ] Design approved by the user
- [ ] Spec saved under \`.oceanus/spec/<name>.md\` including the Metis 分析 fields

## Rules
- Never write implementation code during brainstorm.
- 若满足条件，Run @metis **before** finalizing the approach and before presenting the design for approval; it belongs after explore/clarify and before the proposal is fixed.
- When @metis is disabled, do not claim the pre-proposal analysis was completed; record the degradation: mark the Metis 分析 section as "Metis 已禁用，未执行分析" and state the residual risk honestly.
- Be honest about skipped or disabled analysis: if @metis was skipped for a simple task, write the skip reason; if it was disabled, say so instead of implying coverage.
- If the request is already precise and low-risk, propose the design directly without gratuitous questioning.
- If the request is vague, ask before assuming.
`,
};

export { SISYPHUS_BRAINSTORM_SKILL };
