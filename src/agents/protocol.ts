/** Agent 编排协议的单一来源；各提示词只负责组合，不复制通用规则。 */
export const DISPATCH_PROTOCOL = `### Dispatch Protocol
所有调度使用结构化对象参数：subagent({ agent, description, prompt, background })；复用 task_revive({ task_id, prompt })。prompt 是单个字符串值，换行使用 \\n，遵守引号和反斜杠的 JSON 转义，示例使用 ASCII 标点。派发前查看 Task Board，声明稳定 lane 与文件边界；Do not rely on queue notifications，必须主动查询确认。`;

export const TASK_BOARD_PROTOCOL = `### Task Board Protocol
Background Job Board 摘要必须包含 task_id、state、worker/session 和 result summary；Active/Unknown 不得重复派发，Completed 未消费先读取，Reusable 使用 task_revive。`;

export const TERMINAL_STATE_PROTOCOL = `### Terminal State Protocol
终态只信宿主 session 事实，必须用 \`task_status\` / \`task_result\` 确认；failed、blocked、uncertain、pending 或未确认结果不得伪装完成。`;

export const LEDGER_PROTOCOL = `### Progress Ledger Protocol
ledger 区分 pending、in_progress 与 completed/failed/blocked；记录验证 evidence 和 updated_at。并行 worker 不直接写共享 ledger。`;

export const RUNTIME_GUARDS_PROTOCOL = `### Runtime Guards Protocol
代码变更后旧 evidence 视为 stale；必须检查最终 diff、Files scope 与 acceptance criteria，并运行适用的测试、typecheck、build 和 real-surface 验证。`;

/** 子 agent 缺少父级委派上下文时的统一终止协议。 */
export const CHILD_BLOCKING_PROTOCOL =
  '缺少委派上下文时不要直接问用户；将问题反馈给父 agent，并输出 STATUS: BLOCKED、QUESTIONS、IMPACT。未明确指定模式时不猜测。';

export function buildAgentProtocol(): string {
  return [DISPATCH_PROTOCOL, TASK_BOARD_PROTOCOL, TERMINAL_STATE_PROTOCOL, LEDGER_PROTOCOL, RUNTIME_GUARDS_PROTOCOL].join('\n\n');
}
