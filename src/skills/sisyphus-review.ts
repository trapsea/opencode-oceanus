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
1. **Rebuild the CBM index before review queries** — at the start of Review, directly call \`cbm_index\` to rebuild the current project index; execute 已修改代码，不得依赖陈旧索引，重建完成后再进入后续影响面复查与 CBM 查询。
2. **Re-check the impact surface on the actual diff** — 用 \`cbm_trace\`/\`cbm_detect_changes\` 对实际 diff 再次排查影响面（受影响调用方/被调用方/契约）；以实际代码为准，不用 plan 期预估替代复查。
3. **Compare against the momus estimate** — 将复查结果与 plan status 中 momus 的影响面预估对比：一致 → 记为验证证据；不一致（新调用方受影响/预估遗漏）→ 解释差异或退回 execute。
4. **Run review gates** — after each phase, review the actual output against the spec and plan before moving on.
5. **Verify before accepting** — for any finding, confirm it with evidence (read the code, run the check) before acting on it.
6. **Escalate heavy review to @oracle** — route high-risk architecture decisions, persistent bugs, or security-sensitive review to @oracle.
7. **Gate, don't skip** — review is a gate between phases, not an optional extra. Do not advance to execute or finish with known-unverified claims.

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
- **CBM 边界**：对变更入口与影响面做独立验证——按 Steps 1-3 复查流程执行（重建索引 → 对实际 diff 再次排查 → 与 momus 预估对比，一致记为验证证据、不一致解释或退回 execute）；CBM 不可用时明确记录降级证据。
- Run the Completion Audit before marking any task truly done; a gap (uncovered criterion) is sent back to execute, not accepted.
`,
};

export { SISYPHUS_REVIEW_SKILL };
