import { PLAN_ACCEPTANCE_RUBRIC } from '../agents/protocol';
import type { SkillDefinition } from './types';

const OCEANUS_PLAN_SKILL: SkillDefinition = {
  name: 'oceanus-plan',
  description:
    '第 3 阶段 — 计划：读取 Intake 与已批准的 brainstorm spec，映射文件，合理划分任务，保存计划，在 execute 前通过 oracle 场景 gate（plan-gate）审查，并使用配置决策而不重复询问用户。由 sisyphus agent 在计划阶段开始时加载。',
  slash: true,
  content: `---
name: oceanus-plan
input: intake_report 与 spec
owner: Sisyphus（主 Agent；oracle plan-gate 场景仅条件委派并只读审查）
output: plan 与 oracle plan-gate verdict
entry: spec 已批准
exit: Oracle 门禁审核=开时 oracle plan-gate OKAY 且方案总批准有效；关闭时仅方案总批准有效
failure: REJECT 不得进入 execute
verification: 计划状态可审计
humanReview: required
description: Sisyphus 工作流第 3 阶段 — 计划。读取 Intake 与已批准的 brainstorm spec，映射文件，合理划分任务，保存计划，在 execute 前通过 oracle 场景 gate（plan-gate）审查，并使用配置决策而不重复询问用户。
---

# Sisyphus 第 3 阶段 — 计划

Sisyphus 在进入 oracle 门禁前先完成 \`impact_estimate\`，并处理影响面缺失或覆盖不足；plan-gate 场景只检查已有覆盖，不代替计算。

## 目标
Sisyphus 主 Agent 持有 Intake/spec 上下文与计划写入权；仅按复杂计划门禁条件委派 @oracle 场景 gate（plan-gate）。

将已批准的 spec 转化为小而可执行、感知依赖关系的实现计划，并在任何复杂任务进入 execute 前通过独立的 @oracle 场景 gate（plan-gate）审查。

## 步骤
1. **读取 Intake 与 brainstorm 输出** — 加载 Intake 交接内容与已批准的 spec；保留其中的目标、范围、验收标准、风险、约束和决策，并将其转化为可执行任务。
2. **映射文件** — 确定所有必须修改的文件及其关系。
3. **任务粒度适当（行数/文件数粒度）** — 按功能边界与依赖顺序拆分任务，一个任务应对应一个完整功能切片、可独立完成并验证，带唯一 Task ID、明确所有权、依赖、文件范围、验证方式与**预估实现代码 diff 行数**。粒度上限以实现代码为准（新增+修改+删除；测试代码不计入上限但单独说明）：**普通任务 ≤2000 行且触及 ≤8 个文件；触及公共符号、跨模块契约或核心算法的高风险任务 ≤500 行**（高风险任务无论行数均单独成任务，并在 execute 阶段声明 strict evidence tier）。不要按过细的微步骤拆分；预估超上限则按功能再拆，相邻同依赖且合并后仍在上限内的小任务（如预估 <100 行）可合并。不可验证的任务仍需拆分。
4. **初始化任务台账（仅 SDD 模式）** — SDD 开启时创建 \`.oceanus/progress/<plan-name>.md\`，每个任务一行、初始 \`pending\`，记录 Task ID、Wave、Depends on、Files、Worker/Session、Validation、Updated。SDD 关闭时不创建任何文件，任务状态用会话内 todo（\`todowrite\`）维护。
5. **编写计划（仅 SDD 模式）** — SDD 开启时保存到 \`.oceanus/plan/\`，记录每任务的目标、文件、依赖与预期验证证据；SDD 关闭时计划只在会话内呈现，不落盘。
 6. **验收自查（机械自查，先于 oracle 门禁）** — 委派门禁前按下列 rubric 逐条自查，缺口当场补齐，不得留给门禁首轮拦截（rubric 与 plan-gate 场景 checklist 的验收维度同源，场景文本见 src/review/scenes.ts）：
   ${PLAN_ACCEPTANCE_RUBRIC.split('\n').filter((l) => l.trim().length > 0).join('\n   ')}
    - **依赖顺序** — 所有依赖是否都位于被依赖任务之前、无环且已具备终态条件？
    - **范围越界** — 每个任务的 \`Files\` 范围是否都在其所有权内且避免冲突？
    - **测试 / 验收覆盖** — 每个任务是否都有可测试的成功标准及覆盖它的验证证据？
    - **步骤可执行性** — 每一步是否足够小、可独立完成并能由 worker 具体执行？
    - **未决策事项** — 是否仍有会阻塞或改变任务方向的关键未决策？
   - **影响面（影响面预估）** — 对计划声明的修改文件/公共符号排查计划外受影响面：先复用 @oracle(analysis) research_brief 与 plan 中已记录的 CBM 事实结论（符号/调用链），只对未覆盖的符号做增量查询**（cbm_search_graph 定位 → cbm_trace 查调用方/被调用方 → 必要时 cbm_code 读源码）；发现计划未声明的受影响调用方/契约 → REJECT 并列出具体符号；预估结论（受影响符号与差异）记入 plan status 供 Review 对比。plan-gate 场景只查询、不重建索引；CBM 不可用时标注不确定性，不虚构影响面。复用已有结论不损害 gate 场景判断独立性——复用的是事实查询结果，不是评估结论。
  记录 oracle plan-gate 的 verdict（\`OKAY\` 或 \`REJECT\`）、问题清单、修订轮次、验证时间戳和影响面预估结论（受影响符号与差异）。SDD 开启时记入 \`.oceanus/plan/<name>.md\`（或对应 plan status）；SDD 关闭时在会话内向用户呈现 verdict 与问题清单即可。Oracle 门禁审核=开时，oracle plan-gate \`OKAY\` 是必要但不充分的条件：人工批准沿用 Brainstorm 方案总批准（consolidated approval，plan 阶段不重复提问），gate status 记录 human: { status: 'APPROVED', via: 'consolidated' }；oracle plan-gate OKAY 与有效方案总批准两个门禁（both gates）齐备才进 execute（Trivial 任务除外）。Oracle 门禁审核=关时仅有效方案总批准即进 execute（skipped 已记录）。
  8. **重新分析变更后的输入** — 如果 Plan 在批准后发生变化：需求或验收标准变化 → 配置批问与方案总批准一并失效、重新执行两问（先经 @oracle(analysis) 重析新需求（Oracle 门禁审核=开时；关闭时跳过并记录）、重新计算 \`impact_estimate\`、修订 plan，再次运行 oracle 门禁与 human \`question\`（开启时））；仅 Files/依赖/任务结构变化或失败重规划 → 不重新提问用户，仅重走 oracle 门禁（analysis 与 gate 各计入 3 轮上限，且仅在 Oracle 门禁审核=开时适用）。
 9. **使用配置问题的决策** — Oracle 门禁审核/TDD 与当前目录执行沿用 Intake 批问中的用户抉择，不再单独提问、不补问：
   - **TDD 推荐规则**（配置批问呈现时依据）：预估拆分 >12 个任务 → 推荐 TDD（测试先行，配合 execute 阶段 Failing-First 纪律）；≤12 个 → 不推荐（先开发功能，完成后再补测试验证）。plan 实际拆分任务数与 brainstorm 预估跨阈值（>12）偏差时记入 plan status，不重新提问。
   - **当前目录执行**：所有 orchestrator 和 worker 始终在当前目录；并行仅在 Wave 内 Files 完全不重叠且无共享状态/生成目录时进行。worker 禁止 git add/commit/reset、分支和隔离工作区操作。
  遵循配置批问中记录的用户明确选择。

## Oracle 审查门禁
- **复杂任务必须通过审查（Oracle 门禁审核=开时）**：任何触及多个文件、存在跨任务依赖或具有实际风险的任务，都必须经过 \`@oracle\` 场景 gate（plan-gate）审查后才能进入 execute。Sisyphus 必须在完成任务拆分、依赖、Files 范围、验证和台账后委派 \`@oracle\` 场景 gate：prompt 前置 \`<oracle_scene name="gate">\` 场景指令与 plan 文件路径，复审必须用新会话。**用户在配置批问中关闭 Oracle 门禁审核时本节降级**：不执行 oracle 门禁审查，plan status 记录 SKIPPED_BY_USER 与残余风险（open issue），人工门禁沿用方案总批准；不伪造 verdict。
- **记录 verdict**：将 \`OKAY\`/\`REJECT\` verdict、提出的问题、修订轮次和验证时间写入 \`.oceanus/plan/<name>.md\`（或对应的 plan status），以便 execute 和 review 审计。
  - **REJECT 必须返回修订（≤3 轮）**：收到 \`REJECT\` 时不得进入 execute。返回修订 plan，按最小修订集逐条落实 oracle 门禁的修改建议（不自行发挥），然后再次委派 \`@oracle(plan-gate)\` 复审（复审用新会话、携带 round=N 与前轮 BLOCKER 清单，只验证前轮 BLOCKER 与修订新引入的 BLOCKER）— 每轮审查尽量全面，避免反复返工。最多 3 轮：第 3 轮仍为 \`REJECT\` 时停止自动重试，按 3 轮中断上报模板用 \`question\` 上报（模板须含推荐项及理由）。轮内通过则 human 状态沿用方案总批准（APPROVED, via consolidated）；两个门禁均满足时允许计划通过（Trivial 任务除外）。
- **简单任务可以跳过，但必须记录原因**：如果任务极其简单而跳过审查，则在 plan status 中记录跳过原因和跳过验证的时间。
- **绝不伪造审查**：如果 Oracle 门禁审核被用户关闭或 oracle 被禁用，不得虚构 \`OKAY\`。在任何 execute 继续前，记录审查未执行，并在 plan status 中将风险记为 open issue。

## 计划固定输出模板
计划必须绑定唯一 Spec 路径，执行者必须同时读取二者；冲突时以 Spec 的设计约束为准。
\`\`\`markdown
# <标题>
## 目标
## 架构
## 技术栈
## Spec: .oceanus/spec/<唯一文件>.md
## 全局约束
## 文件变更地图
## 依赖 / 假设
## 门禁状态
## 影响面预估
## Task 1（按依赖顺序）
Task ID / 目标 / Context / Files（Create, Modify, Test） / Interfaces（Consumes, Produces） / Dependencies / Preconditions
- [ ] 具体文件、符号与动作
Validation: \`<command>\`；Expected: \`<预期输出>\`
验收标准 / 风险与回滚 / status / owner / wave / updated / 预估 diff 行数
\`\`\`
每个 Task 必须独立可理解，2-5 分钟仅为粒度指导，不得拆成空步骤；禁止 TBD/TODO/later、未定义引用和占位符。计划末尾必须自检：Spec 唯一路径存在且已批准；文件地图与任务一致；依赖无环；每步含具体文件/符号/动作；验证命令带预期结果；验收可证；门禁状态真实；风险有回滚；无禁止占位符。
## 检查清单
- [ ] 文件已映射且关联
- [ ] 任务粒度适当（行数/文件数粒度：普通 ≤2000 行且 ≤8 文件、高风险 ≤500 行，每任务含预估实现 diff 行数）并按依赖排序
- [ ] SDD 开启：task ledger 已初始化且所有任务 \`pending\`；SDD 关闭：使用会话内 todo、无文件落盘
- [ ] SDD 开启：plan 已保存到 \`.oceanus/plan/\`
- [ ] \`@oracle(plan-gate)\` 复杂任务在 execute 前运行审查（Oracle 门禁审核=关时：SKIPPED_BY_USER 与残余风险已记录，未伪造 verdict）
- [ ] OKAY / REJECT verdict、问题、修订轮次和验证时间已记录在 plan status
- [ ] 影响面预估与 plan-gate 校验结论（受影响符号与差异）已记入 plan status，供 Review 复查对比（Oracle 门禁审核=关时记 SKIPPED_BY_USER）
- [ ] REJECT 已返回修订并重新审查；仅 OKAY 可进入 execute
- [ ] TDD 策略已随 Intake 执行配置批问确认（plan 阶段不单独提问；漏答已回落推荐值，不补问）
- [ ] 当前目录执行约束已确认：所有 worker 使用当前目录，禁止隔离工作区、分支及 git 操作

## 规则
门禁状态（Gate Status）: \`gate: { verdict, round, verifiedAt }\`；\`human: { status, reason, verifiedAt, via }\`（via 默认 'consolidated'，表示批准来源为 Brainstorm 方案总批准；配置批问与方案总批准失效重新执行时更新 verifiedAt）。
Human status 只能是 \`APPROVED\`、\`NEEDS_CHANGES\`、\`CANCELLED\` 或 \`PENDING\`，通过 \`question\` 获取；沉默时保持为 \`PENDING\`。\`NEEDS_CHANGES\` 与 \`CANCELLED\` 必须记录 reason。计划变更后按步骤 7 边界处理：需求或验收标准变化才使配置批问与方案总批准失效并重新执行两问（analysis/gate 场景仅在 Oracle 门禁审核=开时重走）；仅 Files/依赖/任务结构变化或失败重规划不重新提问，仅重走 oracle 门禁（开启时）。
- 任务粒度按预估实现代码 diff 行数与文件数双约束：普通任务 ≤2000 行且 ≤8 个文件；触及公共符号、跨模块契约或核心算法的高风险任务 ≤500 行；测试代码不计入上限但单独说明。超限按功能再拆，相邻同依赖小任务可合并，不可验证的任务仍需拆分。每个任务记录预估行数，execute 记录实际行数、review 对比偏差（显著偏差如 >50% 记为 plan 质量信号）。
- 为每个任务记录 \`Wave\`、\`Depends on\` 和 \`Files\`，以便 execute 阶段安全调度并行后台工作。
- Oracle 门禁审核=开时，缺少以下两者不得进入 execute：来自 @oracle(plan-gate) 的 \`OKAY\` 与明确的人工 \`APPROVED\`（方案总批准）；REJECT 时不得进入 execute。Oracle 门禁审核=关时，有效方案总批准即可进入，但 SKIPPED_BY_USER 与残余风险必须已记录。
- 如果 Oracle 门禁审核被用户关闭或 oracle 被禁用，不得伪造检查结果；记录已跳过的审查及其风险作为 open issue。
- 始终遵循 Intake 配置问题中关于 oracle 门禁、TDD、当前目录执行和进度台账的决策。
`,
};

export { OCEANUS_PLAN_SKILL };
