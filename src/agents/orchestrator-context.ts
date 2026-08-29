/** 委派给子 agent 的显式上下文；不得依赖父会话中未传递的隐含信息。 */
export interface DelegationBrief {
  goal: string; background: string; decisions: string; files: string;
  forbidden: string; dependencies: string; acceptance: string; tests: string; risks: string;
}

export function formatDelegationBrief(brief: DelegationBrief): string {
  return [
    '## Delegation Brief', `- 目标: ${brief.goal}`, `- 背景: ${brief.background}`,
    `- 已确认决策: ${brief.decisions}`, `- Files ownership: ${brief.files}`,
    `- 禁止事项: ${brief.forbidden}`, `- 依赖/结果: ${brief.dependencies}`,
    `- 验收: ${brief.acceptance}`, `- 测试命令: ${brief.tests}`, `- 风险: ${brief.risks}`,
    '', '若缺少任一项，必须输出 STATUS: BLOCKED、QUESTIONS 和 IMPACT，交还父 agent。',
  ].join('\n');
}

export const DELEGATION_BRIEF_PROMPT = `## Delegation Brief
每次委派必须显式包含：目标、背景、已确认决策、Files ownership、禁止事项/禁区、依赖/结果、验收、测试命令和风险。子 agent 不得依赖父会话隐含上下文。
每次委派必须标明稳定 lane（可放在 description 的 \`lane:<stable-key>\` 标记中，不要臆造为宿主工具参数）。工具调用必须使用结构化对象：原生 subagent 的字段为 \`{ agent, description, prompt, background }\`，复用调用的字段为 \`{ task_id, prompt }\`。\`prompt\` 是单个字符串值，换行写作 \`\n\`，引号与反斜杠遵循 JSON 转义；代码示例仅使用 ASCII 半角 JSON 标点，禁止全角逗号。派发前查看 Task Board 摘要：同 lane 有 Active/Unknown 任务时不得重复派发（用 task_status/task_result 等待终态）；有 Completed 未消费任务先 \`task_result\` 读取；Reusable（completed 且已消费）任务用 \`task_revive({ task_id, prompt })\` 以原 task_id（sessionID）续用；无匹配任务才用 \`subagent({ agent, description, prompt, background })\` 新建，返回的 sessionID 即 task_id。终态只信宿主 session 事实。
## Background Job Board 摘要
摘要必须包含 task_id、state/状态、worker/session 和 result summary/结果摘要。`;
