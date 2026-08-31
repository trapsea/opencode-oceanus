import type { SkillDefinition } from './types';

const SISYPHUS_PLAN_SKILL: SkillDefinition = {
  name: 'sisyphus-plan',
  description:
    'Phase 3 — Plan: consume Intake and the approved brainstorm spec, map the files, right-size tasks into bite-sized steps, save the plan to .oceanus/plan/, gate it through @momus review before execute, and consume the consolidated approval decisions (TDD and worktree strategy) instead of re-asking the user. Loaded by the sisyphus agent at the start of the plan phase.',
  slash: true,
  content: `---
name: sisyphus-plan
input: intake_report 与 spec
owner: Sisyphus（主 Agent；Momus 仅条件委派并只读审查）
output: plan 与 Momus verdict
entry: spec 已批准
exit: Momus OKAY 且总批准有效（human APPROVED via consolidated）后进入 execute
failure: REJECT 不得进入 execute
verification: 计划状态可审计
humanReview: required
description: Phase 3 of the Sisyphus workflow — Plan. Consume Intake and the approved brainstorm spec, map files, right-size tasks into bite-sized steps, save the plan to .oceanus/plan/, gate it through @momus review before execute, and consume the consolidated approval decisions (TDD and worktree strategy) instead of re-asking the user.
---

# Sisyphus Phase 3 — Plan

## Goal
Sisyphus 主 Agent 持有 Intake/spec 上下文与计划写入权；仅按复杂计划门禁条件委派 @momus。

Turn the approved spec into a bite-sized, dependency-aware implementation plan, and gate that plan through an independent @momus review before any complex task reaches execute.

## Steps
1. **Consume Intake and brainstorm output** — load the Intake handoff and approved spec; preserve their goal, scope, acceptance criteria, risks, constraints, and decisions while translating them into executable tasks.
2. **Map files** — identify every file that must change and how they relate.
3. **Right-size tasks（2-8 小时粒度）** — 按功能边界与依赖顺序拆分任务，每个任务预估 2-8 小时工作量、可独立完成并验证，带唯一 Task ID、明确所有权、依赖、文件范围和验证方式。不要按过细的微步骤拆分（不采用 2-5 分钟粒度）；一个任务应对应一个完整功能切片。若某任务预估超过 8 小时则按功能再拆，小于 2 小时的相邻同依赖任务可合并。
4. **Initialize the task ledger（仅 SDD 模式）** — SDD 开启时创建 \`.oceanus/progress/<plan-name>.md\`，每个任务一行、初始 \`pending\`，记录 Task ID、Wave、Depends on、Files、Worker/Session、Validation、Updated。SDD 关闭时不创建任何文件，任务状态用会话内 todo（\`todowrite\`）维护。
5. **Write the plan（仅 SDD 模式）** — SDD 开启时保存到 \`.oceanus/plan/\`，记录每任务的目标、文件、依赖与预期验证证据；SDD 关闭时计划只在会话内呈现，不落盘。
 6. **Call @momus before execute（Standard/Architecture）** — once the plan, dependencies, Files scope, and ledger are complete, invoke \`@momus\` to review the plan. 委派时要求按 BLOCKER/SUGGESTION 分级输出，REJECT 必须附最小修订集（逐条修改建议 + 验证方式）；复审委派 prompt 携带 round=N、前轮 BLOCKER 清单与逐条落实证据。Plan 先由 Sisyphus 计算并记录 \`impact_estimate\`；缺失或覆盖不足时必须补齐估计或记录未决风险，Momus 只检查覆盖，不代替计算。**Momus 审查最多 3 轮，每轮尽量全面（一次性覆盖下述全部检查维度），避免多轮返工**；第 3 轮仍 \`REJECT\` 时停止自动重试，按 3 轮中断上报模板用 \`question\` 上报（当前状态摘要 / 原因 / 恰好 2-3 个方案 / 推荐项）。Momus must check:
   - **Dependency order** — are all dependencies before their dependents, acyclic and terminal-ready?
   - **Scope overreach** — does each task's \`Files\` scope stay inside its ownership and avoid conflicts?
   - **Test / acceptance coverage** — does every task carry a testable success criterion and validation evidence that covers it?
   - **Step executability** — is every step small, independently completable, and concretely actionable by a worker?
   - **Unresolved decisions** — are any blocking decisions still open that would block or invert a task?
   - **Impact surface（影响面预估）** — 对计划声明的修改文件/公共符号排查计划外受影响面：先复用 metis research_brief 与 plan 中已记录的 CBM 事实结论（符号/调用链），只对未覆盖的符号做增量查询**（cbm_search_graph 定位 → cbm_trace 查调用方/被调用方 → 必要时 cbm_code 读源码）；发现计划未声明的受影响调用方/契约 → REJECT 并列出具体符号；预估结论（受影响符号与差异）记入 plan status 供 Review 对比。momus 只查询、不重建索引；CBM 不可用时标注不确定性，不虚构影响面。复用已有结论不损害 momus 判断独立性——复用的是事实查询结果，不是评估结论。
 Record Momus's verdict (\`OKAY\` or \`REJECT\`), the issue list, the revision round number, the verification timestamp, and the impact-surface estimate conclusion（影响面预估结论：受影响符号与差异）。SDD 开启时记入 \`.oceanus/plan/<name>.md\`（或对应 plan status）；SDD 关闭时在会话内向用户呈现 verdict 与问题清单即可。Momus \`OKAY\` is necessary but insufficient: 人工批准沿用 Brainstorm 单次总批准（consolidated approval，plan 阶段不重复提问），gate status 记录 human: { status: 'APPROVED', via: 'consolidated' }；Momus OKAY + 有效总批准两个门禁（both gates）齐备才进 execute（Trivial 任务除外）。
 7. **Re-analyze changed inputs** — if the Plan changes after approval: 需求或验收标准变化 → invalidate 总批准，重新总批准（先经 @metis 重析新需求、recompute \`impact_estimate\`、修订 plan，再 re-run @momus 与 human \`question\`）；仅 Files/依赖/任务结构变化或失败重规划 → 不重新提问用户，仅重走 @momus（metis 与 momus 均计入各自 3 轮上限）。
 8. **Consume the consolidated approval decisions** — TDD 与 Worktree 策略沿用 Brainstorm 总批准中的决策（默认值或用户自定义覆盖），不再单独提问；总批准中自定义遗漏的项已由 Brainstorm 回落默认值并记录，plan 阶段不补问：
   - **TDD 推荐规则**（总批准呈现时依据）：预估开发 >5 天**或功能较复杂**（高风险、多模块耦合、难以回归验证）→ 推荐 TDD（测试先行，配合 execute 阶段 Failing-First 纪律）；否则 → 不推荐（先开发功能，完成后再补测试验证）。
   - **Worktree 策略**（总批准呈现时依据）：per-task 隔离 vs 共享 worktree，尊重用户总批准中的显式选择；选择 per-task 隔离时，execute 阶段按 Worktree Lifecycle 执行（创建 → 基线验证 → 隔离执行 → 合并回收 → 清理）。
   Respect the user's explicit choices recorded in the consolidated approval.

## Momus Review Gate
- **Complex tasks must pass review**: any task that touches multiple files, has cross-task dependencies, or carries real risk must not proceed to execute without an \`@momus\` review. Sisyphus must call \`@momus\` after finishing the task breakdown, dependencies, Files scope, validation, and ledger.
- **Record the verdict**: persist the \`OKAY\`/\`REJECT\` verdict, the issues raised, the revision round, and the verification time into \`.oceanus/plan/<name>.md\` (or the matching plan status) so execute and review can audit it.
 - **REJECT must loop back（≤3 轮）**: on \`REJECT\`, do not enter execute. Return to plan revision, 按最小修订集逐条落实 @momus 的修改建议（不自行发挥），然后再次调用 \`@momus\` 复审 — 每轮审查尽量全面，避免反复返工。最多 3 轮：第 3 轮仍 \`REJECT\` 时停止自动重试，按 3 轮中断上报模板用 \`question\` 上报（当前状态摘要 / 原因 / 恰好 2-3 个方案 / 推荐项）。轮内通过则 human 状态沿用总批准（APPROVED, via consolidated）；both gates allow the plan to pass（Trivial 任务除外）。
- **Simple tasks may skip, but record why**: if a task is trivially simple and review is skipped, record the skip reason and the skipped verification time in the plan status.
- **Never fake the review**: if Momus is disabled or unavailable, do not invent an \`OKAY\`. Record that the review was not performed and log the risk as an open issue in the plan status before any execute proceeds.

## Checklist
- [ ] Files mapped and related
- [ ] Tasks right-sized（2-8 小时粒度，按功能与依赖拆分）and dependency-ordered
- [ ] SDD 开启：task ledger 已初始化且所有任务 \`pending\`；SDD 关闭：使用会话内 todo、无文件落盘
- [ ] SDD 开启：plan 已保存到 \`.oceanus/plan/\`
- [ ] \`@momus\` review run on complex tasks before execute
- [ ] OKAY / REJECT verdict, issues, revision round, and verification time recorded in plan status
- [ ] Momus 影响面预估结论（受影响符号与差异）已记入 plan status，供 Review 复查对比
- [ ] REJECT sent back to revision and re-reviewed; only OKAY passes to execute
- [ ] TDD 策略已随总批准确认（plan 阶段不单独提问；自定义遗漏回落默认值，不补问）
- [ ] Worktree 策略已随总批准确认

## Rules
Gate Status: \`momus: { verdict, round, verifiedAt }\`；\`human: { status, reason, verifiedAt, via }\`（via 默认 'consolidated'，表示批准来源为 Brainstorm 单次总批准；总批准失效重新批准时更新 verifiedAt）。
Human status 只能是 \`APPROVED\`、\`NEEDS_CHANGES\`、\`CANCELLED\` 或 \`PENDING\`，通过 \`question\` 获取；沉默 remains \`PENDING\`。\`NEEDS_CHANGES\` 与 \`CANCELLED\` 必须记录 reason。Plan 变化后按步骤 7 边界处理：需求或验收标准变化才使总批准失效并重新经过 metis、Momus 与人工 question；仅 Files/依赖/任务结构变化或失败重规划不重新提问，仅重走 Momus。
- 任务粒度为 2-8 小时一个任务，按功能边界与依赖顺序拆分；超过 8 小时按功能再拆，小于 2 小时的相邻同依赖任务可合并。不可验证的任务仍需拆分。
- Record \`Wave\`, \`Depends on\`, and \`Files\` per task so the execute phase can schedule parallel background work safely.
 - Never enter execute without both \`OKAY\` from \`@momus\` and explicit human \`APPROVED\`. REJECT 时不得进入 execute.
- If Momus is disabled, do not fake the check result; record the skipped review and the risk as an open issue.
- Always honor the TDD, Worktree, and progress-ledger requirements confirmed with the user.
`,
};

export { SISYPHUS_PLAN_SKILL };
