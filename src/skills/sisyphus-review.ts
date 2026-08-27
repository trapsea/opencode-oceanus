import type { SkillDefinition } from './types';

const SISYPHUS_REVIEW_SKILL: SkillDefinition = {
  name: 'sisyphus-review',
  description:
    'Phase 5 — Review: run evidence-based review gates after each phase, route heavy review to @oracle, and verify findings before accepting them. Loaded by the sisyphus agent at the start of the review phase.',
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
description: Phase 5 of the Sisyphus workflow — Review. Run evidence-based review gates after each phase, route heavy review to @oracle, and verify findings before accepting them.
---

# Sisyphus Phase 5 — Review

## Goal
Sisyphus 主 Agent 持有 spec/plan/diff/evidence 上下文与最终门禁；仅对高风险架构、持续故障或安全敏感问题条件委派 @oracle。

Catch defects and design drift with evidence, not vibes, between phases.

## Steps
1. **Rebuild the CBM index before review queries** — at the start of Review, directly call \`cbm_index\` to rebuild the current project index; complete this before any CBM query or impact verification (do not rely on a stale index).
2. **Run review gates** — after each phase, review the actual output against the spec and plan before moving on.
3. **Verify before accepting** — for any finding, confirm it with evidence (read the code, run the check) before acting on it.
3. **Escalate heavy review to @oracle** — route high-risk architecture decisions, persistent bugs, or security-sensitive review to @oracle.
4. **Gate, don't skip** — review is a gate between phases, not an optional extra. Do not advance to execute or finish with known-unverified claims.

## Review Ownership

Review subagent 只读检查，不修改代码、不运行 task；测试由 Review 主流程执行。Momus 审查 evidence、tests 与 completionMatrix，不默认替代代码 review。报告固定写入 \`.oceanus/review/Review v1.md\`。

- **Sisyphus** owns the spec/plan/diff review, test verification, and the Completion Audit; verify each finding with evidence before acting on it.
- **@oracle** owns high-risk architecture review, complex failure diagnosis, and independent code review. Route heavyweight or independent review to @oracle rather than doing it yourself.
- **Momus is not the default implementation or code-review agent** — Momus reviews the plan (Phase 3), not code, and does not replace @oracle for independent code review.
- **Advisory findings don't shift ownership** — if a finding merely checks whether the implementation deviates from the plan, record it as advisory and keep the primary review ownership above unchanged.

## Completion Audit (Coverage Matrix)

Before accepting any task or scenario as truly done, run a completion audit: treat each success criterion as a row and the collected evidence as coverage of those rows.

1. **Build the matrix** — for each planned task/scenario, list its success criteria (rows) and the evidence gathered (tests, manual QA, CLI/live output, code review, build artifact).
2. **Require coverage** — every criterion must be covered by at least one verifiable piece of evidence. A criterion with no evidence is a gap.
3. **Treat uncertainty as not achieved** — if a criterion cannot be confirmed with evidence, it is not complete, even if work appears finished. Never accept a verbal "it's done".
4. **Report gaps** — on any gap, do not mark the task complete; list the missing criteria and send them back to execute to add evidence or finish implementation.
5. **Evidence must be auditable** — prefer binding each evidence item to its point in time / git state; if the code changed, the old evidence is stale and must be re-recorded against the current state, never re-pasted or regenerated as if it were fresh.
6. **Done only when the matrix is green** — a task is truly complete when every criterion has evidence; otherwise it remains incomplete.

## Checklist
- [ ] Output reviewed against spec and plan
- [ ] Findings verified with evidence
- [ ] Heavy review escalated to @oracle where warranted
- [ ] Phase advances only after the gate passes
- [ ] Completion audit run: every criterion covered by evidence (matrix green)

## Rules
- Review is a gate between phases, not an optional extra.
- A terminal claim is credible only when backed by \`task_status\` / \`task_result\` host facts (verified); do not accept completion claims based on queue notifications or silence.
- Do not repeat evidence you already have unless the final state changed.
- If a finding cannot be verified, state that uncertainty explicitly instead of assuming.
- **CBM 边界**：对变更入口与影响面做独立验证；CBM 不可用时明确记录降级证据。
- Run the Completion Audit before marking any task truly done; a gap (uncovered criterion) is sent back to execute, not accepted.
`,
};

export { SISYPHUS_REVIEW_SKILL };
