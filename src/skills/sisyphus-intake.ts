import type { SkillDefinition } from './types';

const SISYPHUS_INTAKE_SKILL: SkillDefinition = {
  name: 'sisyphus-intake',
 description:
    'Sisyphus Intake — 由 Sisyphus 直接收集并分类最小需求；代码任务初始化 CBM 后输出 intake_report 交给 Brainstorm。',
   slash: true,
  content: `---
name: sisyphus-intake
description: Sisyphus Intake — 由 Sisyphus 直接收集并分类最小需求；代码任务初始化 CBM 后输出 intake_report 交给 Brainstorm。
input: 用户请求
owner: Sisyphus
output: intake_report
entry: 新任务
exit: 需求边界与验收明确
failure: 记录阻塞并 fail-open
verification: 报告字段检查
humanReview: required
---

# Sisyphus Intake

## 目标

在 Brainstorm 之前，由 Sisyphus 主 Agent 完成轻量、可验证的需求 intake，不设计方案、不写代码、不创建计划或 ledger。

## 步骤

1. **由 Sisyphus 执行**：使用当前会话中已确认的用户上下文，并读取项目背景、工作区结构、当前分支/变更与相关入口；不凭空推断，也不把已知需求再次交给 subagent。
2. **收集最小需求**：提炼用户目标、期望结果、范围与非目标、约束、验收信号、已知风险和待澄清问题。只询问会阻塞后续工作的最小问题，不在此阶段完成设计审批。
3. **分类任务**：将请求明确分类为：
   - **代码任务**：需要修改、生成、删除或测试仓库代码/配置；
   - **非代码任务**：仅文档、解释、研究、问答或外部操作，不改代码；
   - **混合任务**：同时包含代码变更与非代码交付。
4. **复杂度分流**：将请求分为三档，写入 \`intake_report.complexity\`：
   - **Trivial**：单文件、低风险、方案明确，预估 ≤2 小时 → 后续走轻量路径：跳过 metis/momus，brainstorm 单方案精简呈现 + 一次开工确认（执行配置全取默认）后开工。
   - **Standard**：常规多文件/有依赖 → 完整六阶段流程；调研由主 Agent 自查，仅两波研究后仍存在未知依赖才委派 metis；momus 门禁照常。
   - **Architecture**：跨模块、高风险、方案未定型 → 完整流程 + 默认委派 metis BACKGROUND_RESEARCH（SOLUTION_ANALYSIS 按未决分歧条件触发）+ oracle 审查（review 条件触发）。
5. **初始化 CBM（代码相关任务）**：对代码任务和混合任务由 Sisyphus 直接尝试一次 \`cbm_index\`，以便后续 Brainstorm 使用准确的项目上下文；这是全工作流唯一初始化点，后续阶段不重复初始化。
6. **Fail-open**：CBM 调用失败、超时或返回 \`in-progress\` 时不得阻塞 intake；记录状态、错误/超时信息和残余风险，继续使用可用的文件读取、grep 等方式完成报告。不得伪造索引成功。
7. **交接**：输出结构化 \`intake_report\`，并将其交给 Brainstorm。Brainstorm 必须以该报告（含 complexity）为输入继续探索、澄清和设计；Brainstorm 将在澄清完成后以单次总批准（consolidated approval，默认值制单问：一次 question 主问方案方向，SDD/TDD/Worktree/连续执行授权按默认值随选项带出，自定义遗漏回落默认值）完成方案批准与执行配置确认。非代码任务也必须交接分类与交付要求。

## intake_report 格式

报告至少包含：

- \`task_type\`: \`code\`、\`non-code\` 或 \`mixed\`；
- \`complexity\`: \`trivial\`、\`standard\` 或 \`architecture\`（含判定理由与预估工作量）；
- \`project_context\` 与 \`workspace_context\`；
- \`minimum_requirements\`、范围/非目标与验收信号；
- \`open_questions\` 与风险；
- \`cbm\`: 是否执行、结果（成功/失败/超时/in-progress/不适用）、证据及 fail-open 说明；
- \`handoff\`: 明确“交给 Brainstorm”，以及 Brainstorm 的下一步。

## 规则

- 只做 intake；不得在 Intake 阶段写实现代码、方案 spec、plan、ledger 或 Worktree。
 - 代码/混合任务必须尝试 \`cbm_index\`；非代码任务不因普通文本工作触发索引。Intake 不调用 Metis INTAKE。
- CBM 失败、超时、in-progress 一律 fail-open，并诚实记录，不把失败标记为成功。
- 报告完成后必须交给 Brainstorm，不得跳过 Brainstorm 的需求澄清与单次总批准（Trivial 为开工确认形式）。
`,
};

export { SISYPHUS_INTAKE_SKILL };
