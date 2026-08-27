import type { SkillDefinition } from './types';

const SISYPHUS_PLAN_SKILL: SkillDefinition = {
  name: 'sisyphus-plan',
  description:
    'Phase 3 — Plan: consume Intake and the approved brainstorm spec, map the files, right-size tasks into bite-sized steps, save the plan to .oceanus/plan/, gate it through @momus review before execute, and confirm TDD and worktree strategy with the user. Loaded by the sisyphus agent at the start of the plan phase.',
  slash: true,
  content: `---
name: sisyphus-plan
input: intake_report 与 spec
owner: Sisyphus（主 Agent；Momus 仅条件委派并只读审查）
output: plan 与 Momus verdict
entry: spec 已批准
exit: Momus OKAY 后人工 APPROVED
failure: REJECT 不得进入 execute
verification: 计划状态可审计
humanReview: required
description: Phase 3 of the Sisyphus workflow — Plan. Consume Intake and the approved brainstorm spec, map files, right-size tasks into bite-sized steps, save the plan to .oceanus/plan/, gate it through @momus review before execute, and confirm TDD and worktree strategy with the user.
---

# Sisyphus Phase 3 — Plan

## Goal
Sisyphus 主 Agent 持有 Intake/spec 上下文与计划写入权；仅按复杂计划门禁条件委派 @momus。

Turn the approved spec into a bite-sized, dependency-aware implementation plan, and gate that plan through an independent @momus review before any complex task reaches execute.

## Steps
1. **Consume Intake and brainstorm output** — load the Intake handoff and approved spec; preserve their goal, scope, acceptance criteria, risks, constraints, and decisions while translating them into executable tasks.
2. **Map files** — identify every file that must change and how they relate.
3. **Right-size tasks** — break the work into small, independently completable steps with a unique Task ID, clear ownership, dependencies, file scope, and validation.
4. **Initialize the task ledger** — create \`.oceanus/progress/<plan-name>.md\` with one row per planned task, all initially \`pending\`; record Task ID, Wave, Depends on, Files, Worker/Session, Validation, and Updated.
5. **Write the plan** — save it to \`.oceanus/plan/\`, recording per task: goal, files, dependencies, and expected validation evidence.
6. **Call @momus before execute** — once the plan, dependencies, Files scope, and ledger are complete, invoke \`@momus\` to review the plan. Momus must check:
   - **Dependency order** — are all dependencies before their dependents, acyclic and terminal-ready?
   - **Scope overreach** — does each task's \`Files\` scope stay inside its ownership and avoid conflicts?
   - **Test / acceptance coverage** — does every task carry a testable success criterion and validation evidence that covers it?
   - **Step executability** — is every step small, independently completable, and concretely actionable by a worker?
   - **Unresolved decisions** — are any blocking decisions still open that would block or invert a task?
 Record Momus's verdict (\`OKAY\` or \`REJECT\`), the issue list, the revision round number, and the verification timestamp into \`.oceanus/plan/<name>.md\` (or the matching plan status). Momus \`OKAY\` is necessary but insufficient: obtain explicit human approval (人工批准) as \`APPROVED\`; only then may execute begin. Both gates are mandatory.
 7. **Re-analyze changed inputs** — if the Plan phase discovers a new requirement, new risk, or changed acceptance criterion, return to @metis analysis first; incorporate its results into the revised plan, then have @momus check that revision before execute.
 8. **Confirm strategy with the user** — agree on the TDD strategy (write tests first) and the Worktree strategy (per-task isolation vs. shared worktree). Respect the user's explicit choices.

## Momus Review Gate
- **Complex tasks must pass review**: any task that touches multiple files, has cross-task dependencies, or carries real risk must not proceed to execute without an \`@momus\` review. Sisyphus must call \`@momus\` after finishing the task breakdown, dependencies, Files scope, validation, and ledger.
- **Record the verdict**: persist the \`OKAY\`/\`REJECT\` verdict, the issues raised, the revision round, and the verification time into \`.oceanus/plan/<name>.md\` (or the matching plan status) so execute and review can audit it.
 - **REJECT must loop back**: on \`REJECT\`, do not enter execute. Return to plan revision, address the listed issues, and call \`@momus\` again. Keep iterating until \`OKAY\`, then obtain human \`APPROVED\`. Only both gates allow the plan to pass.
- **Simple tasks may skip, but record why**: if a task is trivially simple and review is skipped, record the skip reason and the skipped verification time in the plan status.
- **Never fake the review**: if Momus is disabled or unavailable, do not invent an \`OKAY\`. Record that the review was not performed and log the risk as an open issue in the plan status before any execute proceeds.

## Checklist
- [ ] Files mapped and related
- [ ] Tasks right-sized and dependency-ordered
- [ ] Task ledger initialized with every task set to \`pending\`
- [ ] Plan saved under \`.oceanus/plan/\`
- [ ] \`@momus\` review run on complex tasks before execute
- [ ] OKAY / REJECT verdict, issues, revision round, and verification time recorded in plan status
- [ ] REJECT sent back to revision and re-reviewed; only OKAY passes to execute
- [ ] TDD strategy confirmed
- [ ] Worktree strategy confirmed

## Rules
- Keep steps bite-sized; if a step cannot be validated, split it.
- Record \`Wave\`, \`Depends on\`, and \`Files\` per task so the execute phase can schedule parallel background work safely.
 - Never enter execute without both \`OKAY\` from \`@momus\` and explicit human \`APPROVED\`. REJECT 时不得进入 execute.
- If Momus is disabled, do not fake the check result; record the skipped review and the risk as an open issue.
- Always honor the TDD, Worktree, and progress-ledger requirements confirmed with the user.
`,
};

export { SISYPHUS_PLAN_SKILL };
