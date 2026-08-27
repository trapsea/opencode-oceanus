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
4. **初始化 CBM（代码相关任务）**：对代码任务和混合任务由 Sisyphus 直接尝试一次 \`cbm_index\`，以便后续 Brainstorm 使用准确的项目上下文。无需等待其他阶段重复初始化。
5. **Fail-open**：CBM 调用失败、超时或返回 \`in-progress\` 时不得阻塞 intake；记录状态、错误/超时信息和残余风险，继续使用可用的文件读取、grep 等方式完成报告。不得伪造索引成功。
6. **交接**：输出结构化 \`intake_report\`，并将其交给 Brainstorm。Brainstorm 必须以该报告为输入继续探索、澄清和设计；非代码任务也必须交接分类与交付要求。

## intake_report 格式

报告至少包含：

- \`task_type\`: \`code\`、\`non-code\` 或 \`mixed\`；
- \`project_context\` 与 \`workspace_context\`；
- \`minimum_requirements\`、范围/非目标与验收信号；
- \`open_questions\` 与风险；
- \`cbm\`: 是否执行、结果（成功/失败/超时/in-progress/不适用）、证据及 fail-open 说明；
- \`handoff\`: 明确“交给 Brainstorm”，以及 Brainstorm 的下一步。

## 规则

- 只做 intake；不得在 Intake 阶段写实现代码、方案 spec、plan、ledger 或 Worktree。
 - 代码/混合任务必须尝试 \`cbm_index\`；非代码任务不因普通文本工作触发索引。Intake 不调用 Metis INTAKE。
- CBM 失败、超时、in-progress 一律 fail-open，并诚实记录，不把失败标记为成功。
- 报告完成后必须交给 Brainstorm，不得跳过 Brainstorm 的需求澄清与方案审批。
`,
};

export { SISYPHUS_INTAKE_SKILL };
