import type { SkillDefinition } from './types';

const SISYPHUS_REVIEW_SKILL: SkillDefinition = {
  name: 'sisyphus-review',
  description:
    'Phase 4 — Review: run evidence-based review gates after each phase, route heavy review to @oracle, and verify findings before accepting them. Loaded by the sisyphus agent at the start of the review phase.',
  slash: true,
  content: `---
name: sisyphus-review
description: Phase 4 of the Sisyphus workflow — Review. Run evidence-based review gates after each phase, route heavy review to @oracle, and verify findings before accepting them.
---

# Sisyphus Phase 4 — Review

## Goal
Catch defects and design drift with evidence, not vibes, between phases.

## Steps
1. **Run review gates** — after each phase, review the actual output against the spec and plan before moving on.
2. **Verify before accepting** — for any finding, confirm it with evidence (read the code, run the check) before acting on it.
3. **Escalate heavy review to @oracle** — route high-risk architecture decisions, persistent bugs, or security-sensitive review to @oracle.
4. **Gate, don't skip** — review is a gate between phases, not an optional extra. Do not advance to execute or finish with known-unverified claims.

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
- Do not repeat evidence you already have unless the final state changed.
- If a finding cannot be verified, state that uncertainty explicitly instead of assuming.
- Run the Completion Audit before marking any task truly done; a gap (uncovered criterion) is sent back to execute, not accepted.
`,
};

export { SISYPHUS_REVIEW_SKILL };
