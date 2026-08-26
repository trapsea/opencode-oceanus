import type { SkillDefinition } from './types';

const SISYPHUS_PLAN_SKILL: SkillDefinition = {
  name: 'sisyphus-plan',
  description:
    'Phase 2 — Plan: map the files, right-size tasks into bite-sized steps, save the plan to .oceanus/plan/, and confirm TDD and worktree strategy with the user. Loaded by the sisyphus agent at the start of the plan phase.',
  slash: true,
  content: `---
name: sisyphus-plan
description: Phase 2 of the Sisyphus workflow — Plan. Map files, right-size tasks into bite-sized steps, save the plan to .oceanus/plan/, and confirm TDD and worktree strategy with the user.
---

# Sisyphus Phase 2 — Plan

## Goal
Turn the approved spec into a bite-sized, dependency-aware implementation plan.

## Steps
1. **Map files** — identify every file that must change and how they relate.
2. **Right-size tasks** — break the work into small, independently completable steps with a unique Task ID, clear ownership, dependencies, file scope, and validation.
3. **Initialize the task ledger** — create \`.oceanus/progress/<plan-name>.md\` with one row per planned task, all initially \`pending\`; record Task ID, Wave, Depends on, Files, Worker/Session, Validation, and Updated.
4. **Write the plan** — save it to \`.oceanus/plan/\`, recording per task: goal, files, dependencies, and expected validation evidence.
5. **Confirm strategy with the user** — agree on the TDD strategy (write tests first) and the Worktree strategy (per-task isolation vs. shared worktree). Respect the user's explicit choices.

## Checklist
- [ ] Files mapped and related
- [ ] Tasks right-sized and dependency-ordered
- [ ] Task ledger initialized with every task set to \`pending\`
- [ ] Plan saved under \`.oceanus/plan/\`
- [ ] TDD strategy confirmed
- [ ] Worktree strategy confirmed

## Rules
- Keep steps bite-sized; if a step cannot be validated, split it.
- Record \`Wave\`, \`Depends on\`, and \`Files\` per task so the execute phase can schedule parallel background work safely.
`,
};

export { SISYPHUS_PLAN_SKILL };
