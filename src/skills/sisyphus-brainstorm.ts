import type { SkillDefinition } from './types';

const SISYPHUS_BRAINSTORM_SKILL: SkillDefinition = {
  name: 'sisyphus-brainstorm',
  description:
    'Phase 1 — Brainstorm: explore context, clarify requirements one question at a time via the question tool, propose 2-3 approaches with a recommendation, present the design in sections, get approval, and save the spec to .oceanus/spec/. Loaded by the sisyphus agent at the start of the brainstorm phase.',
  slash: true,
  content: `---
name: sisyphus-brainstorm
description: Phase 1 of the Sisyphus workflow — Brainstorm. Explore context, clarify requirements one question at a time, propose 2-3 approaches with a recommendation, get design approval, and save the spec to .oceanus/spec/.
---

# Sisyphus Phase 1 — Brainstorm

## Goal
Turn a vague request into an approved design spec before any code is written.

## Steps
1. **Explore context** — search the codebase, read relevant files, and identify what already exists before proposing anything.
2. **Clarify one question at a time** — use the \`question\` tool with a small bounded set of options (and custom input) to pin down requirements. Resolve one ambiguity per turn; do not batch-load the user with questions.
3. **Run @metis on complex tasks before finalizing the proposal** — for tasks that are ambiguous, high-risk, multi-file, or whose solution is not yet decided, delegate \`@metis\` with the requirements and the explored context as input before fixing the approach. @metis must output: 需求缺口（spec/plan 未覆盖的目标、边界与验收标准）、风险（最可能出错或成本最高的点）、边界/非目标（明确不做什么、不可触达的范围）、反例/边界条件（需显式处理的输入、失败与空场景）、可验证的验收标准（可测成功判据）。Simple, low-risk tasks may skip @metis, but must write the explicit skip reason.
4. **Propose 2-3 approaches** — each with a clear recommendation and the trade-offs (quality, speed, cost, risk), revised in light of @metis's analysis.
5. **Present the design in sections** — get explicit approval on the direction before writing any code.
6. **Save the approved spec** — write the design to \`.oceanus/spec/<name>.md\` so later phases can read it. Absorb @metis's analysis into the spec rather than leaving it only in context: the spec must include a "Metis 分析" section covering 需求缺口 / 风险 / 边界与非目标 / 反例与边界条件 / 验收标准 (or explicitly record when @metis was skipped and why).

## Checklist
- [ ] Context explored (files read, not guessed)
- [ ] Ambiguities resolved via \`question\`, one at a time
- [ ] @metis invoked on complex tasks (or skipped with an explicit reason) before the proposal was finalized
- [ ] 2-3 approaches presented with a recommendation
- [ ] Design approved by the user
- [ ] Spec saved under \`.oceanus/spec/<name>.md\` including the Metis 分析 fields

## Rules
- Never write implementation code during brainstorm.
- Run @metis **before** finalizing the approach and before presenting the design for approval; it belongs after explore/clarify and before the proposal is fixed.
- When @metis is disabled, do not claim the pre-proposal analysis was completed; record the degradation: mark the Metis 分析 section as "Metis 已禁用，未执行分析" and state the residual risk honestly.
- Be honest about skipped or disabled analysis: if @metis was skipped for a simple task, write the skip reason; if it was disabled, say so instead of implying coverage.
- If the request is already precise and low-risk, propose the design directly without gratuitous questioning.
- If the request is vague, ask before assuming.
`,
};

export { SISYPHUS_BRAINSTORM_SKILL };
