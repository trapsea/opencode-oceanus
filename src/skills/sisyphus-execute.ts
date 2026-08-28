import type { SkillDefinition } from './types';

const SISYPHUS_EXECUTE_SKILL: SkillDefinition = {
  name: 'sisyphus-execute',
  description:
    'Phase 4 — Execute: implement task-by-task, dispatch independent work in parallel with the native subagent tool (background: true), keep dependent tasks waiting for terminal results, reconcile outputs, and keep the todo list in sync. Loaded by the sisyphus agent at the start of the execute phase.',
  slash: true,
  content: `---
name: sisyphus-execute
input: Momus OKAY 的 plan
owner: Sisyphus 主 Agent；workers 仅持有显式分配的文件范围
output: 实现与证据
entry: plan 放行
exit: 任务终态
failure: 标记失败并重规划
verification: 测试与 ledger
humanReview: conditional
description: Phase 4 of the Sisyphus workflow — Execute. Implement task-by-task, dispatch independent work in parallel with the native subagent tool (background: true), keep dependent tasks waiting for terminal results, and keep the todo list in sync.
---

# Sisyphus Phase 4 — Execute

## Goal
Sisyphus 主 Agent 持有计划、调度、ledger 与验收上下文；仅将无冲突的明确任务条件委派给 workers。

Implement the plan reliably: parallel where safe, serial where dependent, and fully tracked.

## Steps
1. **Load the plan and ledger** — load the plan from \`.oceanus/plan/\` and its matching \`.oceanus/progress/<plan-name>.md\`; compute the ready set (dependencies terminal, wave eligible).
2. **Dispatch in parallel** — for ready tasks with non-overlapping \`Files\` scopes and no shared state, issue multiple independent \`subagent(..., background: true)\` calls in the same turn (each with a distinct \`lane_key\`). Never serialize a ready batch on progress-ledger updates.
3. **Wait only when dependent** — do not block on a background task unless the next step truly needs its result.
4. **Update before dispatch** — immediately before dispatching each task, update its ledger row from \`pending\` to \`in_progress\`, including worker/session and timestamp. This ledger write is orchestrator-owned and serialized.
5. **Reconcile and update after each task** — when any task returns, integrate its result, run or verify its declared validation, then immediately update that task row to \`completed\`, \`failed\`, or \`blocked\`, recording evidence, timestamp, and notes. Do this for every task, including parallel tasks, without waiting for the rest of the Wave to finish.
6. **Sync the todo list** — keep in-memory todo and the ledger consistent: register plan tasks as \`pending\`, mark the current task \`in_progress\` before dispatching, and mark it \`completed\`/\`failed\`/\`blocked\` only after its terminal result and validation evidence are in.

## Plan-Change & Re-plan Gate

Ordinary execution does **not** re-invoke @metis or @momus on every task — 普通执行不重复调用 @metis 或 @momus；仅当 plan 需要变更时才会触发。 They are only touched when the plan itself must change.

1. **Route re-planning according to the kind of change** — if requirements or acceptance criteria change, pause and first re-run @metis to analyze the new requirements, risks, boundaries, counterexamples, and criteria; then return to plan, revise it, and 重新 call @momus. If only the \`Files\` scope, dependencies, task structure, or a failure-driven re-plan changes, return directly to plan, revise it, and re-run @momus without unnecessarily repeating @metis.
2. **Only @momus OKAY lets execution continue** — after any re-planning, the revised plan must pass @momus review. Only when @momus returns OKAY may execution resume; a REJECT means further revision, not execution.
3. **Never fake the gate** — do not invent or fabricate a gate result. If @momus was not actually run on the revised plan, record that honestly and do not claim it passed.

## Failing-First Discipline

Apply this to every code change with a test seam; it turns "write tests first" from an intent into an enforced execution rule.

1. **RED → GREEN → SURFACE** — for each implementation change:
   - RED: write/run a failing test first and capture the failing output.
   - GREEN: implement until that test passes and capture the passing output.
   - SURFACE: verify against a real surface (CLI output, live endpoint, manual QA, built artifact), not just green tests.
2. **Pin existing behavior before changing it** — before modifying existing behavior, first write a characterization test that captures the current behavior, then change it.
3. **No production-first** — if you already wrote production code instead of the test: STOP, revert, write the test, redo.
4. **Completion requires two proofs per scenario** — a code proof (RED output + GREEN output of the same test) plus a real-surface artifact. Passing tests alone do not make a task complete.
5. **Exemption whitelist** (may skip RED→GREEN, but record the reason in Findings/ledger) — pure formatting, pure comments, dependency upgrades with no behavior change, pure renames.

## Checklist
- [ ] Ready set computed from the plan
- [ ] Independent tasks dispatched in parallel (\`subagent(..., background: true)\`, distinct lane_key per task)
- [ ] Dependent tasks waited on terminal results
- [ ] Results reconciled and conflicts resolved
- [ ] Ledger updated before dispatch and after every task terminal result
- [ ] Todo list matches task state
- [ ] Failing-first applied: RED→GREEN captured per change, existing behavior pinned before changes
- [ ] Each scenario has two proofs: code proof (RED+GREEN) and a real-surface artifact
- [ ] Substantive changes (requirements/Files/dependencies/acceptance) or re-planning routed back to plan and re-passed through @momus before continuing

## Rules
- Use the real background parameter: \`subagent(..., background: true)\` with a distinct \`lane_key\` per task.
- Poll background tasks explicitly with \`task_status\` / \`task_result\`; host facts take priority over any local observation. Do not rely on queue notifications — completion is never pushed by default, and a task must never be treated as terminal without a query.
- Never reissue an unchanged task to the same specialist after a rejection; adjust scope or context first.
- Parallel background tasks are allowed only when write scopes do not conflict.
- Parallel workers must not write the shared progress ledger; the orchestrator serializes ledger updates so task records cannot overwrite one another.
- **CBM 边界**：高风险公共符号修改前先做 trace/impact（cbm_trace / cbm_query 分析影响面）；普通机械修改不强制查询；修改后影响面由 Review 阶段复查。
- In shared-worktree mode, workers must not run \`git add\`/\`commit\`/\`reset\`, branch or worktree operations, or edit files outside their declared \`Files\`.
- Follow the Failing-First Discipline above; do not skip RED→GREEN unless the change matches the exemption whitelist and the reason is recorded.
- Never claim a task complete on passing tests alone; a real-surface artifact is required.
- Requirement or acceptance changes re-run @metis before plan revision; Files/dependency/task-structure changes and failure re-planning may return directly to plan. Every revised plan must pass an actual @momus OKAY before continuing.
`,
};

export { SISYPHUS_EXECUTE_SKILL };
