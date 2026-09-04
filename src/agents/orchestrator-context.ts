/** 委派给子 agent 的显式上下文；不得依赖父会话中未传递的隐含信息。 */
export interface DelegationBrief {
  goal: string | string[]; background: string | string[]; decisions: string | string[]; files: string | string[];
  forbidden: string | string[]; dependencies: string | string[]; acceptance: string | string[]; tests: string | string[]; risks: string | string[];
}
function render(value: string | string[]): string { return Array.isArray(value) ? value.join('\n') : value; }

export function formatDelegationBrief(brief: DelegationBrief): string {
  return [
    '## 委派简报', `- 目标: ${render(brief.goal)}`, `- 背景: ${render(brief.background)}`,
    `- 已确认决策: ${render(brief.decisions)}`, `- 文件归属: ${render(brief.files)}`,
    `- 禁止事项: ${render(brief.forbidden)}`, `- 依赖/结果: ${render(brief.dependencies)}`,
    `- 验收: ${render(brief.acceptance)}`, `- 测试命令: ${render(brief.tests)}`, `- 风险: ${render(brief.risks)}`,
    '', '若缺少任一项，必须输出 STATUS: BLOCKED、QUESTIONS 和 IMPACT，交还父级 agent。',
  ].join('\n');
}

/** 子 agent 缺少父级委派上下文时的统一终止协议；调度三协议（调度/任务看板/终止状态）
 *  由 oceanus 工作流 §3 在委派简报之后原位注入，本常量不再内嵌，避免 sisyphus 双注入。 */
export const DELEGATION_BRIEF_PROMPT = `## 委派简报
  每次委派必须显式包含目标、背景、已确认决策、文件归属、禁止事项/禁区、依赖/结果、验收、测试命令和风险。子 agent 不得依赖隐含上下文。`;
