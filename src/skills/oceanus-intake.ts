import type { SkillDefinition } from './types';

const OCEANUS_INTAKE_SKILL: SkillDefinition = {
  name: 'oceanus-intake',
 description:
     'Sisyphus Intake — 由 Sisyphus 直接收集并分类最小需求，完成执行配置批问；代码任务初始化 CBM 后输出 intake_report 交给 Brainstorm。',
   slash: true,
  content: `---
name: oceanus-intake
description: Sisyphus Intake — 由 Sisyphus 直接收集并分类最小需求，完成执行配置批问；代码任务初始化 CBM 后输出 intake_report 交给 Brainstorm。
input: 用户请求
owner: Sisyphus
output: intake_report
entry: 新任务
exit: 需求边界与验收明确
failure: 记录阻塞并 fail-open
verification: 报告字段检查
humanReview: required
---

# Oceanus Intake

## 目标

在 Brainstorm 之前，由 Sisyphus 主 Agent 完成轻量、可验证的需求 intake，不设计方案、不写代码、不创建计划或 ledger。

## 步骤

1. **由 Sisyphus 执行**：使用当前会话中已确认的用户上下文，并读取项目背景、工作区结构、当前分支/变更与相关入口；不凭空推断，也不把已知需求再次交给 subagent。
2. **收集最小需求**：提炼用户目标、期望结果、范围与非目标、约束、验收信号、已知风险和待澄清问题。只询问会阻塞后续工作的最小问题，不在此阶段完成设计审批。
   - **会话能力预检（与需求收集同步完成）**：登记当前会话环境能力清单——headless 或有 TUI、剪贴板可用性、网络访问、CBM/ast-grep 等外部依赖。每条验收信号必须标注验证通道（会话内可执行 / 需真实环境 / 需人工）；标注为"需真实环境或人工"的项不得进入会话内验收标准，改判为外部人工步骤（收尾时以 wait_for_user 交还用户）或改写为可会话内验证的口径，并写入 intake_report 的 open_questions 或 risks。禁止到 review/finish 阶段才发现验收不可执行。
3. **分类任务**：将请求明确分类为：
   - **代码任务**：需要修改、生成、删除或测试仓库代码/配置；
   - **非代码任务**：仅文档、解释、研究、问答或外部操作，不改代码；
   - **混合任务**：同时包含代码变更与非代码交付。
4. **复杂度分流**：将请求分为三档，写入 \`intake_report.complexity\`：
   - **Trivial**：单文件、低风险、方案明确，预估 ≤2 小时 → 后续走轻量路径：推荐 Metis/Momus/SDD/TDD 关闭、连续执行授权授予，brainstorm 单方案精简呈现 + 一次开工确认后开工。
   - **Standard**：常规多文件/有依赖 → 完整六阶段流程；调研由主 Agent 自查，仅 Metis 审核=开且两波研究后仍存在未知依赖才委派 metis；Momus 门禁按配置批问抉择执行。
   - **Architecture**：跨模块、高风险、方案未定型 → 完整流程 + Metis 审核=开时默认委派 metis BACKGROUND_RESEARCH（SOLUTION_ANALYSIS 按未决分歧条件触发）+ oracle 审查（review 条件触发）。
5. **执行配置批问（一问五项）**：基于任务类型、复杂度和初步工作量，用一次 \`question\` 批量询问 Metis 审核、Momus 审核、SDD、TDD、连续执行授权；每项必须给出推荐值及依据，漏答或含糊项回落推荐值并记录，不补问。Trivial 也必须完成这次批问。
   - **Metis/Momus 审核**：预估拆分 >30 个任务且 \`architecture\` 复杂度 → 推荐开启；否则推荐关闭。Momus 开启时 plan 需要 \`OKAY\`，关闭时只保留人工方案门禁，不得伪造 verdict。
   - **SDD**：预估拆分 >20 个任务 → 推荐开启并落盘 spec/plan/progress/review；否则推荐关闭，仅维护会话内状态。
   - **TDD**：预估拆分 >20 个任务 → 推荐开启并采用 RED → GREEN；否则推荐关闭，但仍须 test-after 或其它适用测试证据。
   - **连续执行授权**：推荐授予；授予后连续执行至 finish，拒绝则每阶段结束停顿汇报。
6. **初始化 CBM（代码相关任务）**：对代码任务和混合任务由 Sisyphus 直接尝试一次 \`cbm_index\`，以便后续阶段使用准确的项目上下文；这是全工作流唯一初始化点，后续阶段不重复初始化。
7. **Fail-open**：CBM 调用失败、超时或返回 \`in-progress\` 时不得阻塞 intake；记录状态、错误/超时信息和残余风险，继续使用可用的文件读取、grep 等方式完成报告。不得伪造索引成功。
8. **交接**：输出结构化 \`intake_report\`，其中必须包含五项配置的用户选择、推荐值、回落情况和理由，并将其交给 Brainstorm。Brainstorm 以该报告为起始上下文继续探索、澄清和设计，再以方案总批准（单问）完成方向批准。非代码任务也必须交接分类与交付要求。

## intake_report 格式

报告至少包含：

- \`task_type\`: \`code\`、\`non-code\` 或 \`mixed\`；
- \`complexity\`: \`trivial\`、\`standard\` 或 \`architecture\`（含判定理由与预估工作量）；
- \`project_context\` 与 \`workspace_context\`；
- \`minimum_requirements\`、范围/非目标与验收信号；
- \`open_questions\` 与风险；
- \`execution_config\`：Metis/Momus/SDD/TDD/连续执行授权的选择、推荐值、依据及回落记录；
- \`cbm\`: 是否执行、结果（成功/失败/超时/in-progress/不适用）、证据及 fail-open 说明；
- \`handoff\`: 明确“交给 Brainstorm”，以及 Brainstorm 的下一步。

## 规则

- 只做 intake；不得在 Intake 阶段写实现代码、方案 spec、plan、ledger。
 - 代码/混合任务必须尝试 \`cbm_index\`；非代码任务不因普通文本工作触发索引。Intake 不调用 Metis INTAKE。
- CBM 失败、超时、in-progress 一律 fail-open，并诚实记录，不把失败标记为成功。
- 报告完成后必须交给 Brainstorm，不得跳过 Brainstorm 的需求澄清与方案总批准（Trivial 为开工确认形式）；执行配置批问不得在 Brainstorm 重复执行。
`,
};

export { OCEANUS_INTAKE_SKILL };
