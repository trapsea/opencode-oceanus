import type { SkillDefinition } from './types';

const SISYPHUS_EXECUTE_SKILL: SkillDefinition = {
  name: 'sisyphus-execute',
  description:
    'Phase 4 of the Sisyphus workflow — Execute. Implement task-by-task, dispatch independent work in parallel with the native subagent tool (background: true), keep dependent tasks waiting for terminal results, reconcile outputs, and keep the todo list in sync.',
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
description: Phase 4 of the Sisyphus workflow — Execute. Implement task-by-task, dispatch independent work in parallel with the native subagent tool (background: true), keep dependent tasks waiting for terminal results, reconcile outputs, and keep the todo list in sync.
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
5. **Reconcile and update after each task** — when any task returns, integrate its result, run or verify its declared validation, then immediately record \`completed\`/\`failed\`/\`blocked\`（SDD 模式写入 ledger 行，含证据、时间戳、备注；非 SDD 更新 todo）。同时记录该任务**实际实现代码 diff 行数**（git diff --stat 或等价方式，测试代码不计入），与 plan 预估行数一并写入备注，供 review 对比。Do this for every task, including parallel tasks, without waiting for the rest of the Wave to finish.
6. **Sync the todo list** — keep in-memory todo and the ledger (SDD 模式) consistent: register plan tasks as \`pending\`, mark the current task \`in_progress\` before dispatching, and mark it \`completed\`/\`failed\`/\`blocked\` only after its terminal result and validation evidence are in.
7. **串行 Wave 的条件会话复用** — 串行相邻 wave **默认全新派发**（干净上下文 + 编排者蒸馏的上轮结果 brief，保留纠错机会）。仅当同时满足：①同专家且相邻串行 wave；②Files 范围强重叠或 brief 高度重复；③连续复用 ≤3 轮（累计上下文可控）——才用 \`task_revive({ task_id, prompt })\` 续用上一 wave 的 session。只读 agent（research/分析/复审）优先复用；带写权限的 worker 复用前必须确认上轮已终态且无部分完成的写改动（副作用重跑风险）。复用需会话保留已启用（task_revive 配置，默认关闭），未启用时一律全新派发。复用决策与理由记入 ledger/todo 备注；无论是否复用，编排者都把上一 wave 结果蒸馏进下一个 brief，保证随时可回退到全新派发。

## Current-directory execution

All orchestrators and workers always use the current directory. Parallel workers are allowed only within a Wave when \`Files\` scopes are completely non-overlapping and there is no shared state, resource, or generated-directory interaction. Workers must not run \`git add\`, \`git commit\`, \`git reset\`, branch, or isolated-workspace operations, and must not edit outside their declared \`Files\`.

## Plan-Change & Re-plan Gate

Ordinary execution does **not** re-invoke @metis or @momus on every task — 普通执行不重复调用 @metis 或 @momus；仅当 plan 需要变更时才会触发。 They are only touched when the plan itself must change.

1. **Route re-planning according to the kind of change** — 需求或验收标准变化 → 配置批问与方案总批准一并失效、重新执行两问：pause and first re-run @metis to analyze the new requirements, risks, boundaries, counterexamples, and criteria（Metis 审核=开时；关闭时跳过并记录）; then return to plan, revise it, and 重新 call @momus（开启时）与 human \`question\`。仅 Files/依赖/任务结构变化或失败重规划 → 不重新提问用户，仅重走 @momus（仅 Momus 审核=开时）：return directly to plan, revise it, and re-run @momus without unnecessarily repeating @metis.
2. **Only @momus OKAY lets execution continue** — after any re-planning, the revised plan must pass @momus review (计入 momus 3 轮上限). Only when @momus returns OKAY may execution resume; a REJECT means further revision, not execution。第 3 轮仍 REJECT 时停止自动重试，按 3 轮中断上报模板用 \`question\` 上报（模板须含推荐项及理由）。
3. **Never fake the gate** — do not invent or fabricate a gate result. If @momus was not actually run on the revised plan, record that honestly and do not claim it passed.

## Failing-First Discipline

Apply this to every code change with a test seam; it turns "write tests first" from an intent into an enforced execution rule. **组合优先级**：本节与 Execute Evidence Tier 的 strict 档同时适用时，按下方组合矩阵执行——TDD 开关决定 RED 是否可得，tier 决定证据下限；任何组合下都不得伪称证据。

**TDD × Evidence Tier 组合矩阵**：
- **strict + TDD on**：同一变更状态上的 RED + GREEN + real-surface（现状不变）。
- **strict + TDD off**（用户在执行配置批问中关闭 TDD）：行为变更必须先写 characterization test 固定现有行为作为基线证据，再实现；完成以绑定最终 diff 状态的 GREEN + real-surface 两份证明判定，**不得伪称存在 RED 证据**。
- **light / exempt**：按各档既有规则执行。

1. **RED → GREEN → SURFACE** — for each implementation change（TDD off 时按矩阵改为：基线 → 实现 → GREEN → SURFACE）:
   - RED: write/run a failing test first and capture the failing output.
   - GREEN: implement until that test passes and capture the passing output.
   - SURFACE: verify against a real surface (CLI output, live endpoint, manual QA, built artifact), not just green tests.
2. **Pin existing behavior before changing it** — before modifying existing behavior, first write a characterization test that captures the current behavior, then change it.
3. **No production-first**（仅 TDD on 时适用）— if you already wrote production code instead of the test: STOP, revert, write the test, redo. TDD off 时本条不触发回退义务，但行为变更的 characterization 基线义务仍然适用。
4. **Completion requires two proofs per scenario** — a code proof (TDD on: RED output + GREEN output of the same test; TDD off: characterization baseline + final-state GREEN) plus a real-surface artifact. Passing tests alone do not make a task complete.
5. **Exemption whitelist** (may skip RED→GREEN, but record the reason in Findings/ledger) — pure formatting, pure comments, dependency upgrades with no behavior change, pure renames.

## Execute Evidence Tier

每个任务在进入终态前必须声明且执行一个 evidence tier；Execute 仍必须具备有效方案总批准，Momus 审核=开时另需实际的 Momus \`OKAY\`（关闭时以 plan status 的 SKIPPED_BY_USER 记录为准），不能以证据档位替代任一门禁。

1. **strict**（默认用于公共符号、接口、路由、配置契约或其它高风险变更）：必须同时记录同一变更状态上的 \`RED\`、\`GREEN\` 与 \`real-surface\` 证据；TDD off 时按 Failing-First 组合矩阵以 characterization 基线替代 RED，禁止伪称 RED。real-surface 必须来自 CLI 输出、live endpoint、手工 QA 或构建制品，而不是测试通过的复述。
2. **light**（低风险且不触及公共符号）：允许 \`test-after\`，但仍必须运行并记录测试结果；不得伪称存在 RED 或 real-surface 证据。
3. **exempt**：只限白名单中的纯格式、纯注释、无行为变化的依赖升级或纯重命名；必须在 Findings/ledger 写明具体白名单项与跳过理由，仍需记录可审计的验证结果。

证据必须绑定时间点与当前代码状态（优先 git state、提交或等价快照）。缺失任一 tier 要求，或证据对应的代码状态已改变而变 stale，任务保持未完成并退回补证；不得复用旧输出。发现公共符号或高风险影响时，必须升级为 strict，并在继续执行前补齐 strict 证据。

## Checklist
- [ ] Ready set computed from the plan
- [ ] Independent tasks dispatched in parallel (\`subagent({ agent, description, prompt, background: true })\`, distinct lane marker per task)
- [ ] Dependent tasks waited on terminal results
- [ ] Results reconciled and conflicts resolved
- [ ] SDD 模式：ledger 在派发前与每任务终态后更新；非 SDD：todo 与任务状态一致
- [ ] Todo list matches task state
- [ ] 串行 Wave 复用决策已记录：默认全新派发；仅同专家+相邻串行+上下文强耦合且连续 ≤3 轮时 task_revive 复用（写入 worker 复用前已确认上轮终态无半成品写改动）
- [ ] Failing-first applied: RED→GREEN captured per change, existing behavior pinned before changes
- [ ] Each scenario has two proofs: code proof (TDD on: RED+GREEN; TDD off: characterization baseline + final-state GREEN) and a real-surface artifact
- [ ] Execute evidence tier 已声明：strict=RED+GREEN+real-surface，light=test-after+测试，exempt=白名单+理由
- [ ] Evidence 完整且绑定当前状态；缺失或 stale 不得通过，公共符号/高风险变更已升级 strict
- [ ] 修复/重试循环 ≤3 轮，第 3 轮失败停止自动重试并按 3 轮中断上报模板用 \`question\` 上报用户
- [ ] All work is executed in the current directory; workers use only declared non-overlapping \`Files\` and perform no git, branch, or isolated-workspace operations
- [ ] Substantive changes (requirements/Files/dependencies/acceptance) or re-planning routed back to plan and re-passed through @momus before continuing

## Rules
- Use the real background parameter: \`subagent({ agent, description, prompt, background: true })\` with a distinct lane marker in description per task.
- Poll background tasks explicitly with \`task_status\` / \`task_result\` and cancel obsolete ones with \`task_cancel\`; host facts take priority over any local observation — the plugin's task metadata is only an index and never a substitute for host fact. Do not rely on queue notifications — completion is never pushed by default, and a task must never be treated as terminal without a query.
- Never reissue an unchanged task to the same specialist after a rejection; adjust scope or context first.
- **修复循环上限统一 3 轮**：单个任务的失败修复/重派遣最多 3 轮；第 3 轮仍失败则标记 blocked 并停止自动重试，按 3 轮中断上报模板用 \`question\` 上报。
- **探索性尝试循环上限**：同一目标的探索性尝试（环境/实例启动、隔离环境搭建、绕行 workaround、探测性命令）连续失败达 3 次必须停止换路：回到 plan 重估前提，或按 3 轮中断上报模板上报（模板须含推荐项及理由）；不得无限换姿势重试。
- Parallel background tasks are allowed only when write scopes do not conflict.
- Parallel workers must not write the shared progress ledger; the orchestrator serializes ledger updates so task records cannot overwrite one another.
- **CBM 边界**：高风险公共符号修改前先做 trace/impact（cbm_trace / cbm_query 分析影响面）；普通机械修改不强制查询；修改后影响面由 Review 阶段复查。
- Workers must not run \`git add\`/\`commit\`/\`reset\`, branch or isolated-workspace operations, or edit files outside their declared \`Files\`.
- Follow the Failing-First Discipline above; do not skip RED→GREEN unless the change matches the exemption whitelist and the reason is recorded.
- Never claim a task complete on passing tests alone; a real-surface artifact is required.
- Requirement or acceptance changes re-run @metis before plan revision; Files/dependency/task-structure changes and failure re-planning may return directly to plan. Every revised plan must pass an actual @momus OKAY before continuing.
- Plan-Change 后：需求或验收标准变化 → 旧的 Momus \`OKAY\` 与配置批问/方案总批准均失效，重新执行两问并重走 Momus（开启时）后才可恢复 Execute；仅 Files/依赖/任务结构变化或失败重规划 → 两问不失效、不重新提问，仅重走 @momus（Momus 审核=开时）。
`,
};

export { SISYPHUS_EXECUTE_SKILL };
