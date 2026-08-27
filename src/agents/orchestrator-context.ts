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
## Background Job Board 摘要
摘要必须包含 task_id、state/状态、worker/session 和 result summary/结果摘要。`;
