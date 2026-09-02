/** Agent 编排协议的单一来源；各提示词只负责组合，不复制通用规则。 */
export const DISPATCH_PROTOCOL = `### Dispatch Protocol
所有调度使用结构化对象参数：subagent({ agent, description, prompt, background })。prompt 是单个字符串值，换行使用 \n，遵守引号和反斜杠的 JSON 转义，示例使用 ASCII 标点。派发前声明稳定 lane 与文件边界；不要依赖队列通知。`;

export const LEDGER_PROTOCOL = `### Progress Ledger Protocol
ledger 区分 pending、in_progress 与 completed/failed/blocked；记录验证 evidence 和 updated_at。并行 worker 不直接写共享 ledger。`;

export const RUNTIME_GUARDS_PROTOCOL = `### Runtime Guards Protocol
代码变更后旧 evidence 视为 stale；必须检查最终 diff、Files scope 与 acceptance criteria，并运行适用的测试、typecheck、build 和 real-surface 验证。`;

/** 3 轮中断上报模板的完整定义（单一来源）。站点只保留引用句式，不复制完整定义。 */
export const THREE_ROUND_TEMPLATE = `**3 轮中断上报模板（统一）**：任何 3 轮循环（@momus REJECT 重审 / 执行修复重试 / review 缺口退回 / metis 分歧 / 视觉 L5 FAIL 退回 / 同一目标的探索性尝试连续失败）第 3 轮仍不通过时，停止自动重试，用 \`question\` 工具上报，内容必须包含：①当前状态摘要（已完成任务清单、进行中与剩余任务清单）②原因（第 3 轮失败或分歧的具体原因，引用最后一轮关键证据）③下一步方案（恰好 2-3 个方案 / 推荐项：每项附一句可行性与代价说明）④推荐项（明确标注推荐项及理由）。计数边界：每类循环独立计数，从该循环第一次 REJECT / 失败 / 分歧 / 缺口起算；修订后通过则该循环计数清零；不同循环、不同任务之间不累计。`;

/** Momus 门禁输出与复审协议（单一来源）；sisyphus.ts 与 sisyphus-plan skill 共同引用。 */
export const MOMUS_GATE_PROTOCOL = `- @momus 输出按 BLOCKER/SUGGESTION 分级，仅 BLOCKER 触发 REJECT；REJECT 必须附最小修订集（逐条修改建议 + 验证方式）。复审轮只验证前轮 BLOCKER 与修订新引入的 BLOCKER，不追加旧问题。
- 复审委派 prompt 必须携带 round=N、前轮 BLOCKER 清单与逐条落实证据。SDD 开启时证据优先用文件引用（plan 文件路径 + 修订处任务 ID/行锚点 + git diff 范围）替代全文转述；SDD 关闭时保留逐条转述。复审优先使用原生 \`subagent\` 显式传 \`sessionID\` 续用原会话。
- @momus 返回 \`REJECT\` 时必须回到 plan 修订后重新检查，不得直接进入 execute；修订按最小修订集逐条落实（不自行发挥）；仅当 \`OKAY\` 才放行 execute。
- 循环上限：@momus REJECT 修订重审最多 3 轮；每轮按最小修订集逐条落实（不自行发挥）；第 3 轮仍 REJECT 时停止重审循环，按 3 轮中断上报模板上报，不允许静默循环自查。`;

/** Plan 阶段验收自查 rubric（单一来源）；与 momus checklist 的 Test/acceptance coverage 维度对应（momus.ts 为英文六维语义超集，演进时须对照本常量）。 */
export const PLAN_ACCEPTANCE_RUBRIC = `1. 每条验收标准必须绑定一条可直接执行的验证命令或明确的机械检查步骤（命令 + 预期输出/退出码），不得停留在"通过/符合"级别的口头描述。
2. 文档类任务的验收必须有行级或文件级锚点目标（具体到目标行/目标段落/文件清单），不得只写"文档已更新"。
3. 涉及一致性比对的验收必须固化抽查集（文件 + 断言清单），复审与 review 按同一清单复对。`;

/** 子 agent 缺少父级委派上下文时的统一终止协议。 */
export const CHILD_BLOCKING_PROTOCOL =
  '缺少委派上下文时不要直接问用户；将问题反馈给父 agent，并输出 STATUS: BLOCKED、QUESTIONS、IMPACT。未明确指定模式时不猜测。';

export function buildAgentProtocol(): string {
  return [DISPATCH_PROTOCOL, LEDGER_PROTOCOL, RUNTIME_GUARDS_PROTOCOL].join('\n\n');
}
