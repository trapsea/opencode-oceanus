import type { SkillDefinition } from './types';

const SISYPHUS_BRAINSTORM_SKILL: SkillDefinition = {
  name: 'sisyphus-brainstorm',
  description:
    'Phase 2 — Brainstorm: consume the Intake handoff, explore context, clarify requirements one question at a time via the question tool, propose 2-3 approaches with a recommendation, present the design in sections, get approval, and save the spec to .oceanus/spec/. Loaded by the sisyphus agent at the start of the brainstorm phase.',
  slash: true,
  content: `---
name: sisyphus-brainstorm
description: Phase 2 of the Sisyphus workflow — Brainstorm. Consume the Intake handoff, explore context, clarify requirements one question at a time, propose 2-3 approaches with a recommendation, get design approval, and save the spec to .oceanus/spec/.
input: intake_report
owner: Sisyphus
output: approved spec
entry: Intake 完成
exit: 用户批准 spec
failure: 暂停并记录未决问题
verification: 批准与 spec 审计
humanReview: required
---

# Sisyphus Phase 2 — Brainstorm

## Goal
Turn a vague request into an approved design spec before any code is written.

## Steps
1. **Consume Intake** — load the completed Intake handoff and use its goal, scope, acceptance criteria, risks, constraints, and open questions as the starting contract; do not silently rewrite Intake decisions.
2. **委派 @metis 背景调研（BACKGROUND_RESEARCH）** — 用 \`subagent({ agent: "metis", background: true })\` 委派 metis 做 BACKGROUND_RESEARCH，产出 research_brief（现状、关键符号 qualified name/路径/行号、约束与依赖、可复用 CBM 事实结论），**记录返回的 task_id（sessionID）**。Sisyphus 消费 brief 后只做必要的少量补充定位（cbm_search_graph/cbm_trace），不再自行大规模探索，也不重复委派 explorer 做背景调研。Trivial 任务可跳过委派，直接做最小探索并记录理由。
2. **研究优先澄清（research-first）** — 先用代码/文档/CBM 研究消除未知（两波研究内无新有用事实即停止，不无限探索）。研究能解决的疑问一律不再问用户；**但凡存在疑问、歧义、需求描述不清，且研究也没有得到明确结论的，必须用 \`question\` 向用户澄清**。多个相互独立的问题可在一次 \`question\` 中批量提出；有依赖顺序的问题分批问。
 3. **条件使用 @metis 方案审核（复用调研会话）** — 完成 Intake 且澄清后仍存在未决方案选择时，只有 Sisyphus 明确需要独立分析才委派方案审核。**优先用 \`task_revive({ task_id, prompt })\` 续用步骤 2 的 BACKGROUND_RESEARCH session**（背景已在 metis 上下文中，直接增量验证），仅在调研被跳过或 session 不可用时新建。委派 prompt 必须按步骤 4 的结构化格式逐方案传入（含权衡、依赖/迁移、风险、边界、反例、决策标准），让 Metis 做增量验证与挑错，而不是从零重建分析。复杂度、多文件或高风险本身不触发；否则记录跳过原因。**metis 分析最多 3 轮，每轮尽量全面**，第 3 轮仍有分歧时向用户上报请求裁决。
4. **Propose 2-3 approaches（按 Metis 评估维度组织）** — 每个候选方案必须按 @metis 的分析维度完整呈现，使其可直接进入 SOLUTION_ANALYSIS 验证而不是被重建或打回补料。每个方案包含：
   - **一句话概述**：方案是什么、解决什么；
   - **需求覆盖**：覆盖的目标、边界与验收标准（含明确不覆盖的）；
   - **权衡（trade-offs）**：质量 / 速度 / 成本 / 风险四个维度的对比结论；
   - **依赖与迁移**：依赖的模块/库/接口、迁移与回滚路径；
   - **风险**：实现阶段最可能出错、成本最高的点；
   - **边界与非目标**：该方案明确不做什么、不可触达的范围；
   - **反例/边界条件**：需显式处理的输入、失败与空场景；
   - **可验证的决策标准**：如何客观判定该方案优于其它方案（可测判据，非主观偏好）。
   最后给出明确推荐及理由。Trivial 任务可直接给出单一方案（仍按上述维度精简呈现）。
5. **Present the design in sections** — get explicit approval on the direction before writing any code。Trivial 任务一次确认即可。
6. **SDD 模式询问与 spec 保存** — 设计批准后，**固定用 \`question\` 询问用户是否开启 SDD 模式（spec-driven development）**，推荐规则按预估开发时间评估：**预计开发 >5 天 → 推荐 SDD；≤5 天 → 不推荐**，并在选项说明中给出该推荐理由。开启 SDD 才把设计写入 \`.oceanus/spec/<name>.md\`（含 "Metis 分析" 小节：需求缺口 / 风险 / 边界与非目标 / 反例与边界条件 / 验收标准，或明确记录 @metis 被跳过的原因）；**不开启则不写任何流程文档**，设计与决策只保留在会话内供后续阶段消费。

## Checklist
- [ ] Context explored (files read, not guessed)
- [ ] @metis BACKGROUND_RESEARCH 已委派并消费 research_brief（task_id 已记录）；Trivial 跳过已记录理由
- [ ] 研究先行：能由研究解决的疑问未转嫁给用户；研究后仍存疑的需求歧义已用 \`question\` 澄清
- [ ] 仅按未决方案选择且 Sisyphus 明确需要独立分析的条件调用 @metis（≤3 轮），否则记录理由
- [ ] 2-3 approaches presented with a recommendation
- [ ] 每个方案按 Metis 评估维度完整呈现（需求覆盖/权衡/依赖迁移/风险/边界/反例/决策标准），无需补充即可进入 SOLUTION_ANALYSIS
- [ ] Design approved by the user
- [ ] 已固定询问 SDD 模式；开启时 spec 已保存到 \`.oceanus/spec/<name>.md\`（含 Metis 分析字段），未开启时确认无流程文档落盘

## Rules
- Never write implementation code during brainstorm.
- 若满足条件，Run @metis **before** finalizing the approach and before presenting the design for approval; it belongs after explore/clarify and before the proposal is fixed.
- When @metis is disabled, do not claim the pre-proposal analysis was completed; record the degradation: mark the Metis 分析 section as "Metis 已禁用，未执行分析" and state the residual risk honestly.
- Be honest about skipped or disabled analysis: if @metis was skipped for a simple task, write the skip reason; if it was disabled, say so instead of implying coverage.
- If the request is already precise and low-risk, propose the design directly without gratuitous questioning.
- If the request is vague, ask before assuming.
`,
};

export { SISYPHUS_BRAINSTORM_SKILL };
