import type { SkillDefinition } from './types';

const SISYPHUS_EXECUTE_SKILL: SkillDefinition = {
  name: 'sisyphus-execute',
  description:
    'Phase 3 — Execute: implement task-by-task, dispatch independent work in parallel with task(run_in_background=true), keep dependent tasks waiting for terminal results, reconcile outputs, and keep the todo list in sync. Loaded by the sisyphus agent at the start of the execute phase.',
  slash: true,
  content: `---
name: sisyphus-execute
description: Phase 3 of the Sisyphus workflow — Execute. Implement task-by-task, dispatch independent work in parallel with task(run_in_background=true), keep dependent tasks waiting for terminal results, and keep the todo list in sync.
---

# Sisyphus Phase 3 — Execute

## Goal
Implement the plan reliably: parallel where safe, serial where dependent, and fully tracked.

## Steps
1. **Load the plan and ledger** — load the plan from \`.oceanus/plan/\` and its matching \`.oceanus/progress/<plan-name>.md\`; compute the ready set (dependencies terminal, wave eligible).
2. **Dispatch in parallel** — for ready tasks with non-overlapping \`Files\` scopes and no shared state, issue multiple independent \`task(..., run_in_background=true)\` calls in the same turn. Never serialize a ready batch on progress-ledger updates.
3. **Wait only when dependent** — do not block on a background task unless the next step truly needs its result.
4. **Update before dispatch** — immediately before dispatching each task, update its ledger row from \`pending\` to \`in_progress\`, including worker/session and timestamp. This ledger write is orchestrator-owned and serialized.
5. **Reconcile and update after each task** — when any task returns, integrate its result, run or verify its declared validation, then immediately update that task row to \`completed\`, \`failed\`, or \`blocked\`, recording evidence, timestamp, and notes. Do this for every task, including parallel tasks, without waiting for the rest of the Wave to finish.
6. **Sync the todo list** — keep in-memory todo and the ledger consistent: register plan tasks as \`pending\`, mark the current task \`in_progress\` before dispatching, and mark it \`completed\`/\`failed\`/\`blocked\` only after its terminal result and validation evidence are in.

## Checklist
- [ ] Ready set computed from the plan
- [ ] Independent tasks dispatched in parallel (\`run_in_background=true\`)
- [ ] Dependent tasks waited on terminal results
- [ ] Results reconciled and conflicts resolved
- [ ] Ledger updated before dispatch and after every task terminal result
- [ ] Todo list matches task state

## Rules
- Use the real background parameter: \`task(..., run_in_background=true)\` — not \`background: true\`.
- Never reissue an unchanged task to the same specialist after a rejection; adjust scope or context first.
- Parallel background tasks are allowed only when write scopes do not conflict.
- Parallel workers must not write the shared progress ledger; the orchestrator serializes ledger updates so task records cannot overwrite one another.
- In shared-worktree mode, workers must not run \`git add\`/\`commit\`/\`reset\`, branch or worktree operations, or edit files outside their declared \`Files\`.
`,
};

export { SISYPHUS_EXECUTE_SKILL };
