/** 委派给子 agent 的显式上下文；不得依赖父会话中未传递的隐含信息。 */
import { DISPATCH_PROTOCOL, TASK_BOARD_PROTOCOL, TERMINAL_STATE_PROTOCOL } from './protocol';
export interface DelegationBrief {
  goal: string | string[]; background: string | string[]; decisions: string | string[]; files: string | string[];
  forbidden: string | string[]; dependencies: string | string[]; acceptance: string | string[]; tests: string | string[]; risks: string | string[];
}
function render(value: string | string[]): string { return Array.isArray(value) ? value.join('\n') : value; }

export function formatDelegationBrief(brief: DelegationBrief): string {
  return [
    '## Delegation Brief', `- 目标: ${render(brief.goal)}`, `- 背景: ${render(brief.background)}`,
    `- 已确认决策: ${render(brief.decisions)}`, `- Files ownership: ${render(brief.files)}`,
    `- 禁止事项: ${render(brief.forbidden)}`, `- 依赖/结果: ${render(brief.dependencies)}`,
    `- 验收: ${render(brief.acceptance)}`, `- 测试命令: ${render(brief.tests)}`, `- 风险: ${render(brief.risks)}`,
    '', '若缺少任一项，必须输出 STATUS: BLOCKED、QUESTIONS 和 IMPACT，交还父 agent。',
  ].join('\n');
}

export const DELEGATION_BRIEF_PROMPT = `## Delegation Brief
 每次委派必须显式包含目标、背景、已确认决策、Files ownership、禁止事项/禁区、依赖/结果、验收、测试命令和风险。子 agent 不得依赖隐含上下文。
\n${DISPATCH_PROTOCOL}\n${TASK_BOARD_PROTOCOL}\n${TERMINAL_STATE_PROTOCOL}`;
