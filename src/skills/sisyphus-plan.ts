import { PLAN_ACCEPTANCE_RUBRIC } from '../agents/protocol';
import type { SkillDefinition } from './types';

const SISYPHUS_PLAN_SKILL: SkillDefinition = {
  name: 'sisyphus-plan',
  description:
    'Phase 3 — Plan: consume Intake and the approved brainstorm spec, map files, right-size tasks, save the plan, gate it through @momus review before execute, and consume configuration decisions without re-asking the user. Loaded by the sisyphus agent at the start of the plan phase.',
  slash: true,
  content: `---
name: sisyphus-plan
input: intake_report 与 spec
owner: Sisyphus（主 Agent；Momus 仅条件委派并只读审查）
output: plan 与 Momus verdict
entry: spec 已批准
exit: Momus 审核=开时 Momus OKAY 且方案总批准有效；关闭时仅方案总批准有效
failure: REJECT 不得进入 execute
verification: 计划状态可审计
humanReview: required
description: Phase 3 of the Sisyphus workflow — Plan. Consume Intake and the approved brainstorm spec, map files, right-size tasks, save the plan, gate it through @momus review before execute, and consume configuration decisions without re-asking the user.
---

# Sisyphus Phase 3 — Plan

## Goal
Sisyphus 主 Agent 持有 Intake/spec 上下文与计划写入权；仅按复杂计划门禁条件委派 @momus。

Turn the approved spec into a bite-sized, dependency-aware implementation plan, and gate that plan through an independent @momus review before any complex task reaches execute.

## Steps
1. **Consume Intake and brainstorm output** — load the Intake handoff and approved spec; preserve their goal, scope, acceptance criteria, risks, constraints, and decisions while translating them into executable tasks.
2. **Map files** — identify every file that must change and how they relate.
3. **Right-size tasks（行数/文件数粒度）** — 按功能边界与依赖顺序拆分任务，一个任务应对应一个完整功能切片、可独立完成并验证，带唯一 Task ID、明确所有权、依赖、文件范围、验证方式与**预估实现代码 diff 行数**。粒度上限以实现代码为准（新增+修改+删除；测试代码不计入上限但单独说明）：**普通任务 ≤2000 行且触及 ≤8 个文件；触及公共符号、跨模块契约或核心算法的高风险任务 ≤500 行**（高风险任务无论行数均单独成任务，并在 execute 阶段声明 strict evidence tier）。不要按过细的微步骤拆分；预估超上限则按功能再拆，相邻同依赖且合并后仍在上限内的小任务（如预估 <100 行）可合并。不可验证的任务仍需拆分。
4. **Initialize the task ledger（仅 SDD 模式）** — SDD 开启时创建 \`.oceanus/progress/<plan-name>.md\`，每个任务一行、初始 \`pending\`，记录 Task ID、Wave、Depends on、Files、Worker/Session、Validation、Updated。SDD 关闭时不创建任何文件，任务状态用会话内 todo（\`todowrite\`）维护。
5. **Write the plan（仅 SDD 模式）** — SDD 开启时保存到 \`.oceanus/plan/\`，记录每任务的目标、文件、依赖与预期验证证据；SDD 关闭时计划只在会话内呈现，不落盘。
 6. **Acceptance self-check（机械自查，先于 @momus）** — 委派门禁前按下列 rubric 逐条自查，缺口当场补齐，不得留给门禁首轮拦截（rubric 与 momus checklist 的 Test/acceptance coverage 维度同源）：
   ${PLAN_ACCEPTANCE_RUBRIC.split('\n').filter((l) => l.trim().length > 0).join('\n   ')}
 7. **Call @momus before execute（Standard/Architecture；仅当执行配置批问中 Momus 审核=开）** — once the plan, dependencies, Files scope, and ledger are complete, invoke \`@momus\` to review the plan. **用户关闭 Momus 审核时跳过本步**：plan status 记录 \`momus: { verdict: 'SKIPPED_BY_USER', reason }\` 与残余风险（open issue），人工门禁沿用方案总批准，不得伪造 OKAY。门禁输出分级、REJECT 最小修订集、复审携带 round=N 与落实证据（SDD 开启时优先文件引用：plan 路径 + 修订锚点 + git diff 范围；SDD 关闭时逐条转述）、前台复审优先原生 \`subagent\` 显式传 \`sessionID\` 续用原会话、后台任务用 \`task_revive\`——均见全局门禁清单的 Momus 门禁协议（单一来源）。Plan 先由 Sisyphus 计算并记录 \`impact_estimate\`；缺失或覆盖不足时必须补齐估计或记录未决风险，Momus 只检查覆盖，不代替计算。**Momus 审查最多 3 轮，每轮尽量全面（一次性覆盖下述全部检查维度），避免多轮返工**；第 3 轮仍 \`REJECT\` 时停止自动重试，按 3 轮中断上报模板用 \`question\` 上报（模板须含推荐项及理由）。Momus must check:
   - **Dependency order** — are all dependencies before their dependents, acyclic and terminal-ready?
   - **Scope overreach** — does each task's \`Files\` scope stay inside its ownership and avoid conflicts?
   - **Test / acceptance coverage** — does every task carry a testable success criterion and validation evidence that covers it?
   - **Step executability** — is every step small, independently completable, and concretely actionable by a worker?
   - **Unresolved decisions** — are any blocking decisions still open that would block or invert a task?
   - **Impact surface（影响面预估）** — 对计划声明的修改文件/公共符号排查计划外受影响面：先复用 metis research_brief 与 plan 中已记录的 CBM 事实结论（符号/调用链），只对未覆盖的符号做增量查询**（cbm_search_graph 定位 → cbm_trace 查调用方/被调用方 → 必要时 cbm_code 读源码）；发现计划未声明的受影响调用方/契约 → REJECT 并列出具体符号；预估结论（受影响符号与差异）记入 plan status 供 Review 对比。momus 只查询、不重建索引；CBM 不可用时标注不确定性，不虚构影响面。复用已有结论不损害 momus 判断独立性——复用的是事实查询结果，不是评估结论。
 Record Momus's verdict (\`OKAY\` or \`REJECT\`), the issue list, the revision round number, the verification timestamp, and the impact-surface estimate conclusion（影响面预估结论：受影响符号与差异）。SDD 开启时记入 \`.oceanus/plan/<name>.md\`（或对应 plan status）；SDD 关闭时在会话内向用户呈现 verdict 与问题清单即可。Momus 审核=开时，Momus \`OKAY\` is necessary but insufficient: 人工批准沿用 Brainstorm 方案总批准（consolidated approval，plan 阶段不重复提问），gate status 记录 human: { status: 'APPROVED', via: 'consolidated' }；Momus OKAY + 有效方案总批准两个门禁（both gates）齐备才进 execute（Trivial 任务除外）。Momus 审核=关时仅有效方案总批准即进 execute（skipped 已记录）。
 8. **Re-analyze changed inputs** — if the Plan changes after approval: 需求或验收标准变化 → 配置批问与方案总批准一并失效、重新执行两问（先经 @metis 重析新需求（Metis 审核=开时；关闭时跳过并记录）、recompute \`impact_estimate\`、修订 plan，再 re-run @momus（开启时）与 human \`question\`）；仅 Files/依赖/任务结构变化或失败重规划 → 不重新提问用户，仅重走 @momus（metis 与 momus 均计入各自 3 轮上限，且仅在其审核=开时适用）。
 9. **Consume the configuration-question decisions** — Metis/Momus/TDD 与当前目录执行沿用批问中的用户抉择，不再单独提问、不补问：
   - **TDD 推荐规则**（配置批问呈现时依据）：预估拆分 >12 个任务 → 推荐 TDD（测试先行，配合 execute 阶段 Failing-First 纪律）；≤12 个 → 不推荐（先开发功能，完成后再补测试验证）。plan 实际拆分任务数与 brainstorm 预估跨阈值（>12）偏差时记入 plan status，不重新提问。
   - **当前目录执行**：所有 orchestrator 和 worker 始终在当前目录；并行仅在 Wave 内 Files 完全不重叠且无共享状态/生成目录时进行。worker 禁止 git add/commit/reset、分支和隔离工作区操作。
   Respect the user's explicit choices recorded in the configuration questions.

## Momus Review Gate
- **Complex tasks must pass review (when momus audit is enabled)**: any task that touches multiple files, has cross-task dependencies, or carries real risk must not proceed to execute without an \`@momus\` review. Sisyphus must call \`@momus\` after finishing the task breakdown, dependencies, Files scope, validation, and ledger. **用户在配置批问中关闭 Momus 审核时本节降级**：不执行 momus 审查，plan status 记录 skipped-by-user 与残余风险（open issue），人工门禁沿用方案总批准；不伪造 verdict。
- **Record the verdict**: persist the \`OKAY\`/\`REJECT\` verdict, the issues raised, the revision round, and the verification time into \`.oceanus/plan/<name>.md\` (or the matching plan status) so execute and review can audit it.
 - **REJECT must loop back（≤3 轮）**: on \`REJECT\`, do not enter execute. Return to plan revision, 按最小修订集逐条落实 @momus 的修改建议（不自行发挥），然后再次调用 \`@momus\` 复审 — 每轮审查尽量全面，避免反复返工。最多 3 轮：第 3 轮仍 \`REJECT\` 时停止自动重试，按 3 轮中断上报模板用 \`question\` 上报（模板须含推荐项及理由）。轮内通过则 human 状态沿用方案总批准（APPROVED, via consolidated）；both gates allow the plan to pass（Trivial 任务除外）。
- **Simple tasks may skip, but record why**: if a task is trivially simple and review is skipped, record the skip reason and the skipped verification time in the plan status.
- **Never fake the review**: if Momus was disabled or turned off by the user, do not invent an \`OKAY\`. Record that the review was not performed and log the risk as an open issue in the plan status before any execute proceeds.

## Checklist
- [ ] Files mapped and related
- [ ] Tasks right-sized（行数/文件数粒度：普通 ≤2000 行且 ≤8 文件、高风险 ≤500 行，每任务含预估实现 diff 行数）and dependency-ordered
- [ ] SDD 开启：task ledger 已初始化且所有任务 \`pending\`；SDD 关闭：使用会话内 todo、无文件落盘
- [ ] SDD 开启：plan 已保存到 \`.oceanus/plan/\`
- [ ] \`@momus\` review run on complex tasks before execute（Momus 审核=关时：skipped-by-user 与残余风险已记录，未伪造 verdict）
- [ ] OKAY / REJECT verdict, issues, revision round, and verification time recorded in plan status
- [ ] Momus 影响面预估结论（受影响符号与差异）已记入 plan status，供 Review 复查对比（Momus 审核=关时记 SKIPPED_BY_USER）
- [ ] REJECT sent back to revision and re-reviewed; only OKAY passes to execute
- [ ] TDD 策略已随执行配置批问确认（plan 阶段不单独提问；漏答已回落推荐值，不补问）
- [ ] 当前目录执行约束已确认：所有 worker 使用当前目录，禁止隔离工作区、分支及 git 操作

## Rules
Gate Status: \`momus: { verdict, round, verifiedAt }\`；\`human: { status, reason, verifiedAt, via }\`（via 默认 'consolidated'，表示批准来源为 Brainstorm 方案总批准；配置批问与方案总批准失效重新执行时更新 verifiedAt）。
Human status 只能是 \`APPROVED\`、\`NEEDS_CHANGES\`、\`CANCELLED\` 或 \`PENDING\`，通过 \`question\` 获取；沉默 remains \`PENDING\`。\`NEEDS_CHANGES\` 与 \`CANCELLED\` 必须记录 reason。Plan 变化后按步骤 7 边界处理：需求或验收标准变化才使配置批问与方案总批准失效并重新执行两问（metis/momus 仅在其审核=开时重走）；仅 Files/依赖/任务结构变化或失败重规划不重新提问，仅重走 Momus（开启时）。
- 任务粒度按预估实现代码 diff 行数与文件数双约束：普通任务 ≤2000 行且 ≤8 个文件；触及公共符号、跨模块契约或核心算法的高风险任务 ≤500 行；测试代码不计入上限但单独说明。超限按功能再拆，相邻同依赖小任务可合并，不可验证的任务仍需拆分。每个任务记录预估行数，execute 记录实际行数、review 对比偏差（显著偏差如 >50% 记为 plan 质量信号）。
- Record \`Wave\`, \`Depends on\`, and \`Files\` per task so the execute phase can schedule parallel background work safely.
- Momus 审核=开时，Never enter execute without both \`OKAY\` from @momus and explicit human \`APPROVED\`（方案总批准）；REJECT 时不得进入 execute。Momus 审核=关时，有效方案总批准即可进入，但 skipped 与残余风险必须已记录。
- If Momus was disabled or turned off by the user, do not fake the check result; record the skipped review and the risk as an open issue.
- Always honor the metis/momus, TDD, current-directory execution, and progress-ledger decisions from the configuration questions.
`,
};

export { SISYPHUS_PLAN_SKILL };
