import type { SkillDefinition } from './types';

const OCEANUS_BRAINSTORM_SKILL: SkillDefinition = {
  name: 'oceanus-brainstorm',
  description:
    '阶段 2——Brainstorm：接收需求接收交接，通过一次批量配置问题确认五项执行设置（metis 审核 / momus 审核 / SDD / TDD / 连续执行授权），探索上下文并澄清剩余歧义，按复杂度分层呈现方案，通过单个问题获得方案批准；启用 SDD 时将 spec 保存到 .oceanus/spec/。由 sisyphus agent 在 brainstorm 阶段开始时加载。',
  slash: true,
  content: `---
name: oceanus-brainstorm
description: Sisyphus 工作流第 2 阶段——Brainstorm。接收需求接收交接，通过一次批量配置问题确认五项执行设置（metis 审核 / momus 审核 / SDD / TDD / 连续执行授权），探索上下文、澄清剩余歧义，按复杂度分层呈现方案，通过单个问题获得方案批准，并在启用 SDD 时将 spec 保存到 .oceanus/spec/。
input: intake_report
owner: Sisyphus
output: approved spec
entry: Intake 完成
exit: 执行配置批问 + 方案总批准完成
failure: 暂停并记录未决问题
verification: 批准与 spec 审计
humanReview: required
---

# Sisyphus 阶段 2——Brainstorm

## 目标
在编写任何代码前，将模糊请求转化为已批准的设计 spec。

## 步骤
1. **接收 Intake**——加载已完成的 Intake 交接，以其目标、范围、验收标准、风险、约束和开放问题作为起始契约；不得悄然改写 Intake 决策。
2. **执行配置批问（配置问题，一问五项）** — 基于 intake_report 的复杂度与初步范围预估，在任何 @metis 委派之前，用一次 question 批量询问五项执行配置，每项给出推荐值及依据；漏答或含糊项回落推荐值并记录，不补问；Trivial 同样完整批问。
   - **Metis 审核**：预估拆分 >12 个任务或 \`architecture\` 复杂度 → 推荐「开」（开启后按步骤 3/5 分层规则执行调研与条件方案审核）；否则 → 推荐「关」（跳过全部 metis 委派，spec 的 Metis 分析小节记「用户关闭」与残余风险）。
   - **Momus 审核**：预估拆分 >12 个任务或 \`architecture\` 复杂度 → 推荐「开」（plan 阶段 Momus OKAY + 方案总批准双门禁照常）；否则 → 推荐「关」（plan 仅保留方案总批准人工门禁，skipped-by-user 与残余风险记入 plan status，不得伪造 OKAY）。
   - **SDD**：预估拆分 >12 个任务 → 推荐「开」（spec/plan/ledger/review 文档落盘）；≤12 个 → 推荐「关」（会话内 todo 维护，不落盘）。
   - **TDD**：预估拆分 >12 个任务 → 推荐「开」（测试先行，配合 execute 阶段 Failing-First 纪律）；≤12 个 → 推荐「关」（先功能后补测试（test-after，按 execute 证据档执行），非免测试）。
   - **当前目录执行**：始终在当前目录工作；并行安全依靠 Wave、Files 完全不重叠且无共享状态或生成目录。worker 禁止 git add/commit/reset、分支和隔离工作区操作。
   - **连续执行授权**：推荐「授予」（批准后 Sisyphus 连续执行到 finish，仅 3 轮循环到顶时按 3 轮中断上报模板中断）；「拒绝」则每个阶段结束停顿向用户汇报后再继续。
3. **分层背景调研** — 按复杂度分层（@metis 委派以执行配置批问中 **Metis 审核=开** 为前提，关闭时全部自查、不委派并记录）：**Architecture** 默认用 \`subagent({ agent: "metis", background: true })\` 委派 @metis BACKGROUND_RESEARCH，产出 research_brief（现状、关键符号 qualified name/路径/行号、约束与依赖、可复用 CBM 事实结论），**记录返回的 task_id（sessionID）**；**Standard** 由 Sisyphus 自查（两波研究内无新有用事实即停止），仅当两波后仍存在未知依赖/约束才委派 @metis BACKGROUND_RESEARCH；**Trivial** 仅做最小自查、不委派。任何跳过委派都记录理由。Sisyphus 消费 brief 后只做必要的少量补充定位（cbm_search_graph/cbm_trace），不触发全量索引（索引初始化仅在 Intake），也不再自行大规模探索，不重复委派 explorer 做背景调研。
4. **研究优先澄清（research-first）** — 先用代码/文档/CBM 研究消除未知（两波研究内无新有用事实即停止，不无限探索）。研究能解决的疑问一律不再问用户；**但凡存在疑问、歧义、需求描述不清，且研究也没有得到明确结论的，必须用 \`question\` 向用户澄清**。多个相互独立的问题可在一次 \`question\` 中批量提出；有依赖顺序的问题分批问。
6. **分层呈现方案** — 按 intake_report 的 complexity 分层呈现，并给出明确推荐及理由：
   - **Trivial**：单一方案精简呈现（一句话概述 / 验收标准 / 主要风险），无需 Metis 七维度全展开；
   - **Standard**：推荐方案 + 至多 1 个备选，按维度精简呈现（概述、需求覆盖、权衡、风险、边界与反例）；
   - **Architecture**：2-3 个方案按 @metis 的分析维度完整呈现，使其可直接进入 SOLUTION_ANALYSIS 验证而不是被重建或打回补料。每个方案包含：
    - **一句话概述**：方案是什么、解决什么；
     - **需求覆盖**：覆盖的目标、边界与验收标准（含明确不覆盖的）；
      - **权衡（取舍）**：质量 / 速度 / 成本 / 风险四个维度的对比结论；
     - **依赖与迁移**：依赖的模块/库/接口、迁移与回滚路径；
     - **风险**：实现阶段最可能出错、成本最高的点；
     - **边界与非目标**：该方案明确不做什么、不可触达的范围；
     - **反例/边界条件**：需显式处理的输入、失败与空场景；
     - **可验证的决策标准**：如何客观判定该方案优于其它方案（可测判据，非主观偏好）。
7. **方案总批准（consolidated approval，单问）** — 用一次 \`question\` 主问方案方向（执行配置已在步骤 2 批问确认，本问**不再携带配置默认值**）。选项固定三类：①**按推荐执行**（接受推荐方案）②**换用备选方案 X**（仅 Standard/Architecture 有备选时提供）③**自定义**（用户在同一次回复中给出方案调整项；仅限方案层面，配置项以步骤 2 的抉择为准，不重复问）。除步骤 2 批问与本问外，任何阶段不得追加批准类提问。Trivial 的批准形式为一次开工确认（"开工" / "调整"），等价于按推荐执行。批准后按 SDD 抉择决定保存：开启 SDD 才把设计写入 \`.oceanus/spec/ 下按任务名称生成的 Markdown 文件\`（含 "Metis 分析" 小节：需求缺口 / 风险 / 边界与非目标 / 反例与边界条件 / 验收标准，或明确记录 @metis 被跳过/禁用/用户关闭的原因）；不开启则不写任何流程文档，设计与决策只保留在会话内供后续阶段消费。
## Spec 固定输出模板（SDD 开启时落盘）
spec 必须是下游无聊天上下文执行者可独立消费的设计文档，且不得混入任务拆分、逐步实现顺序或提交步骤。按以下顺序完整填写：
\`\`\`markdown
# <标题>
Status: approved | draft | blocked
## 目标
## Context（术语、现状、接口与数据流定义）
## 范围
## 非目标
## 需求
## Architecture / Design
## Tech Stack / Constraints
## Decisions & Alternatives
## Risks & Mitigations
## Edge Cases / Failure Handling
## Acceptance Criteria（每项可验证）
## Implementation Notes（仅设计约束，不写计划步骤）
## Files touched map（文件、符号/区域、变更目的）
## Metis Analysis（七维：需求缺口、风险、边界与非目标、反例、依赖、迁移/回滚、验收；若跳过须写明确原因）
\`\`\`
禁止 \`TBD\`、\`TODO\`、\`later\`、占位符、未定义引用及“为上述内容编写测试”等空泛语句；接口、术语、输入输出和失败语义必须定义。
Spec 自检：目标/范围清楚；每项需求可追溯到设计；数据流和边界已写明；文件地图完整；验收可复现；Metis 七维或跳过原因完整；无计划细节与禁止占位符。
## Checklist
- [ ] 已探索上下文（已读取文件，而非凭空猜测）
- [ ] 执行配置批问完成：一问五项（Metis 审核/Momus 审核/SDD/TDD/连续执行授权）均带推荐值及依据，漏答回落推荐值并记录，不补问，Trivial 亦完整批问，无补问
- [ ] 分层调研完成（Metis 审核=开时）：Architecture 已委派并消费 @metis BACKGROUND_RESEARCH research_brief（task_id 已记录）；Standard 已自查或按条件委派；Trivial 仅最小自查；Metis 审核=关时确认无任何 @metis 委派且已记录
- [ ] 研究先行：能由研究解决的疑问未转嫁给用户；研究后仍存疑的需求歧义已用 \`question\` 澄清
- [ ] 仅按未决方案选择且 Sisyphus 明确需要独立分析的条件调用 @metis 方案审核（≤3 轮，且 Metis 审核=开），否则记录理由
- [ ] 方案按复杂度分层呈现（Trivial 单方案精简；Standard 推荐 + 至多 1 备选；Architecture 2-3 方案七维度完整 + 明确推荐）
- [ ] 方案总批准完成：单问主问方案方向、三固定选项，不携带配置默认值，无补问
- [ ] SDD 抉择已执行：开启时 spec 已保存到 \`.oceanus/spec/ 下按任务名称生成的 Markdown 文件\`（含 Metis 分析字段），未开启时确认无流程文档落盘

## 规则
- 不得在 brainstorm 期间编写实现代码。
- 若满足条件（Metis 审核=开），须在确定方案并呈现设计供批准**之前**运行 @metis；它应位于探索/澄清之后、方案定稿之前。
- 当 @metis 被禁用或用户在配置批问中关闭 Metis 审核时，不得声称已完成方案前分析；记录降级情况：将 Metis 分析部分标记为“Metis 已禁用/用户关闭，未执行分析”，并如实说明残余风险。
- 对跳过或禁用的分析保持诚实：若简单任务跳过 @metis，写明跳过原因；若被禁用或用户关闭，应明确说明，不得暗示已覆盖。
- 如果请求已经明确且风险较低，直接提出设计，不做无必要的提问。
- 如果请求含糊，先询问再假设。
- 推荐值必须与推荐规则一致并在批问选项说明中带出；连续执行授权默认授予，不得虚构。
`,
};

export { OCEANUS_BRAINSTORM_SKILL };
