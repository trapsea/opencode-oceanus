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
1. **Load the plan and ledger** — SDD 开启时从 \`.oceanus/plan/\` 与 \`.oceanus/progress/<plan-name>.md\` 加载；SDD 关闭时使用会话内计划与 todo。compute the ready set (dependencies terminal, wave eligible)。
2. **Dispatch in parallel** — for ready tasks with non-overlapping \`Files\` scopes and no shared state, issue multiple independent \`subagent({ agent, description, prompt, background })\` calls in the same turn (each with a lane marker in description). Never serialize a ready batch on progress-ledger updates.
3. **Wait only when dependent** — do not block on a background task unless the next step truly needs its result.
4. **Update before dispatch（SDD 模式）** — SDD 开启时，派发前把该任务 ledger 行从 \`pending\` 更新为 \`in_progress\`（含 worker/session 与时间戳），ledger 由 orchestrator 串行写入。SDD 关闭时用 \`todowrite\` 同步 todo 即可，不写文件。
5. **Reconcile and update after each task** — when any task returns, integrate its result, run or verify its declared validation, then immediately record \`completed\`/\`failed\`/\`blocked\`（SDD 模式写入 ledger 行，含证据、时间戳、备注；非 SDD 更新 todo）。Do this for every task, including parallel tasks, without waiting for the rest of the Wave to finish.
6. **Sync the todo list** — keep in-memory todo and the ledger (SDD 模式) consistent: register plan tasks as \`pending\`, mark the current task \`in_progress\` before dispatching, and mark it \`completed\`/\`failed\`/\`blocked\` only after its terminal result and validation evidence are in.

## Worktree Lifecycle（per-task 隔离模式；是否开启由用户在 plan 阶段决定）

参考 Superpowers 的 worktree 生命周期：检测 → 创建 → 基线验证 → 隔离执行 → 合并回收 → 清理。共享 worktree 模式跳过本节，直接在当前目录按 Files 所有权执行。

1. **检测复用** — 派发前先检查 \`.worktrees/<task-id>\` 是否已存在（中断恢复场景）；存在则复用并核对任务 Files 一致，不重复创建。
2. **创建** — 为每个需要隔离的任务创建 worktree（默认 \`.worktrees/<task-id>\`，从当前分支切出临时分支），创建动作只由 orchestrator 执行，worker 不得自行创建/切换。
3. **基线验证** — worktree 内完成依赖安装后运行现有测试确认绿色基线；基线失败则该任务不派发，报告并回到 plan 处理。
4. **隔离执行** — worker 在其 worktree 内只改声明 \`Files\`；SDD 流程文档（\`.oceanus/\`）一律写主工作区，worktree 内不写。
5. **合并回收（orchestrator 串行）** — 任务终态且验证通过后，由 orchestrator 按依赖顺序将 worktree 变更合并回主工作区（优先 \`git merge\`，冲突由 orchestrator 亲自解决，不推给 worker）；同 wave 多个 worktree 合并必须串行进行。
6. **清理** — 合并完成且 review 通过后，删除对应 worktree 与临时分支（\`git worktree remove\` + 分支删除）；未合并或 review 未过的 worktree 保留以便恢复。清理在进入 finish 之前完成，finish 保持只读。

## Plan-Change & Re-plan Gate

Ordinary execution does **not** re-invoke @metis or @momus on every task — 普通执行不重复调用 @metis 或 @momus；仅当 plan 需要变更时才会触发。 They are only touched when the plan itself must change.

1. **Route re-planning according to the kind of change** — if requirements or acceptance criteria change, pause and first re-run @metis to analyze the new requirements, risks, boundaries, counterexamples, and criteria; then return to plan, revise it, and 重新 call @momus. If only the \`Files\` scope, dependencies, task structure, or a failure-driven re-plan changes, return directly to plan, revise it, and re-run @momus without unnecessarily repeating @metis.
2. **Only @momus OKAY lets execution continue** — after any re-planning, the revised plan must pass @momus review (计入 momus 3 轮上限). Only when @momus returns OKAY may execution resume; a REJECT means further revision, not execution。第 3 轮仍 REJECT 时停止并向用户上报请求裁决。
3. **Never fake the gate** — do not invent or fabricate a gate result. If @momus was not actually run on the revised plan, record that honestly and do not claim it passed.

## Failing-First Discipline

Apply this to every code change with a test seam; it turns "write tests first" from an intent into an enforced execution rule. **当用户在 plan 阶段选择不推荐 TDD（先功能后测试）时**，RED→GREEN 顺序放宽为：先实现功能，完成后再编写并运行测试验证（仍需捕获测试输出证据 + 真实制品两份证明）；高风险行为变更仍建议先写 characterization test 固定现有行为。

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
- [ ] Independent tasks dispatched in parallel (\`subagent({ agent, description, prompt, background: true })\`, distinct lane marker per task)
- [ ] Dependent tasks waited on terminal results
- [ ] Results reconciled and conflicts resolved
- [ ] SDD 模式：ledger 在派发前与每任务终态后更新；非 SDD：todo 与任务状态一致
- [ ] Todo list matches task state
- [ ] Failing-first applied: RED→GREEN captured per change, existing behavior pinned before changes
- [ ] Each scenario has two proofs: code proof (RED+GREEN) and a real-surface artifact
- [ ] 修复/重试循环 ≤3 轮，第 3 轮失败即上报用户
- [ ] Worktree 模式：基线验证通过后才派发；任务终态后串行合并回主工作区；review 通过后已清理 worktree 与临时分支
- [ ] Substantive changes (requirements/Files/dependencies/acceptance) or re-planning routed back to plan and re-passed through @momus before continuing

## Rules
- Use the real background parameter: \`subagent({ agent, description, prompt, background: true })\` with a distinct lane marker in description per task.
- Poll background tasks explicitly with \`task_status\` / \`task_result\` and cancel obsolete ones with \`task_cancel\`; host facts take priority over any local observation — the plugin's task metadata is only an index and never a substitute for host fact. Do not rely on queue notifications — completion is never pushed by default, and a task must never be treated as terminal without a query.
- Never reissue an unchanged task to the same specialist after a rejection; adjust scope or context first.
- **修复循环上限统一 3 轮**：单个任务的失败修复/重派遣最多 3 轮；第 3 轮仍失败则标记 blocked 并向用户上报，不再自动重试。
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
