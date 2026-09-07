/** Agent 编排协议的单一来源；各提示词只负责组合，不复制通用规则。 */
export const DISPATCH_PROTOCOL = `### 调度协议
所有调度使用结构化对象参数：subagent({ agent, description, prompt, background })。prompt 必须是实际包含换行的多行 Markdown 文本；目标、背景、范围、非目标、验收、验证、风险和预期输出必须各自独占一行或一个小节，字段之间留空行。禁止把多个字段压在同一行，禁止只传字面量 \\n。派发前声明稳定 lane 与文件边界；不要依赖队列通知。`;

/** Sisyphus 六阶段总契约的唯一来源；Workflow Skill 与 Sisyphus system 共同消费。 */
export const SISYPHUS_WORKFLOW_PROTOCOL = `
## Sisyphus 六阶段总契约

### 阶段顺序

必须按以下顺序运行，不得跳过：

1. **Intake**：加载 \`oceanus-intake\`，明确目标、范围、验收、风险、复杂度和执行配置。
2. **Discuss**：加载 \`oceanus-discuss\`，补齐事实、比较方案并取得方向批准。
3. **Plan**：加载 \`oceanus-plan\`，映射文件、依赖、所有权、验证命令和 \`impact_estimate\`。
4. **Execute**：加载 \`oceanus-execute\`，按依赖实现，每项变更立即验证并记录证据。
5. **Review**：加载 \`oceanus-review\`，审查最终 diff、影响面、验收和证据新鲜度。
6. **Finish**：加载 \`oceanus-finish\`，只读汇总交付状态、缺口和残余风险。

### 全局不变量

- 不跳过阶段；Trivial 任务可以在阶段内压缩步骤，但必须记录 \`condensed_steps\` 与理由。
- 需求、验收或范围变化返回 Discuss/Plan；结构性计划变化返回 Plan。
- Oracle 顾问只按需提供 spec/plan advisory，不是固定 gate，不授予批准，也不替代 Review。
- CBM 由 Intake 负责首次初始化并故障开放；Plan 复用并自查 \`impact_estimate\`；Review 可针对最终 diff 刷新索引并复查；Finish 不调用 CBM。
- Review 是 Execute 后的正式审查阶段；其他阶段只做阶段内自查，不重复创建 Review/Completion Audit 门禁。
- Review 发现 BLOCKER 时立即退回 Execute；WARNING 记录后可继续；UNCERTAIN 阻塞并请求用户决策；INFO 不阻塞。
- **自动回退闭环**：Review 的 BLOCKER 必须立即退回 Execute：把完整清单交给 Execute，完成全部 blocker 后重新 Review；Review 通过后自动进入 Finish，不得在阶段交接处等待用户再次提示。仅 UNCERTAIN 或连续三轮仍未解决的 BLOCKER 才建立用户阻塞边界。
- 所有工作在当前目录完成；并行写入仅遵循常驻 Agent 调度协议的文件所有权规则。
- 终态必须区分 \`completed\`、\`failed\`、\`blocked\` 和 \`pending\`，并附验证证据与更新时间。

### 阶段交接

每次阶段切换必须输出最小 \`phase_handoff\`：\`current_phase\`、\`input_sources\`、\`completed\`、\`open_questions\`、\`next_action\`、\`risks\`、\`evidence\`、\`status\`、\`updated\`；阶段可追加专属字段。阶段 Skill 是详细操作手册，不是遵守本总契约的前置条件；Skill 未加载或阶段输入不完整时，不得假设阶段已完成，必须停在当前阶段并报告具体缺口。

### 完成边界

没有新鲜、完整且覆盖验收标准的证据，不得声称完成。Review 负责正式证据审查；Finish 只接受 Review、Completion Matrix、ledger 和 evidence 均满足要求的阶段输入，只做只读交付汇总，不测试、不构建、不调用 CBM、不修改文件、不委派 subagent。`;

export const LEDGER_PROTOCOL = `### 进度账本协议
 ledger 区分 pending、in_progress 与 completed/failed/blocked；记录验证证据和 updated_at。并行工作者不直接写共享账本。`;

export const RUNTIME_GUARDS_PROTOCOL = `### 运行时护栏协议
代码变更后旧 evidence 视为 stale；必须检查最终 diff、Files scope 与 acceptance criteria，并运行适用的测试、typecheck、build 和 real-surface 验证。`;

/** 3 轮中断上报模板的完整定义（单一来源）。站点只保留引用句式，不复制完整定义。 */
export const THREE_ROUND_TEMPLATE = `**3 轮中断上报模板（统一）**：任何 3 轮循环（执行修复重试 / review 缺口退回 / oracle-analysis 分歧 / 视觉 L5 FAIL 退回 / 同一目标的探索性尝试连续失败）第 3 轮仍不通过时，停止自动重试，用 \`question\` 工具上报，内容必须包含：①当前状态摘要（已完成任务清单、进行中与剩余任务清单）②原因（第 3 轮失败或分歧的具体原因，引用最后一轮关键证据）③下一步方案（恰好 2-3 个方案 / 推荐项：每项附一句可行性与代价说明）④推荐项（明确标注推荐项及理由）。计数边界：每类循环独立计数，从该循环第一次失败、分歧或缺口起算；修订后通过则该循环计数清零；不同循环、不同任务之间不累计。`;

/** Plan 阶段验收自查 rubric（单一来源）。 */
export const PLAN_ACCEPTANCE_RUBRIC = `1. 每条验收标准必须绑定一条可直接执行的验证命令或明确的机械检查步骤（命令 + 预期输出/退出码），不得停留在"通过/符合"级别的口头描述。
2. 文档类任务的验收必须有行级或文件级锚点目标（具体到目标行/目标段落/文件清单），不得只写"文档已更新"。
3. 涉及一致性比对的验收必须固化抽查集（文件 + 断言清单），复审与 review 按同一清单复对。`;

/** 子 agent 缺少父级委派上下文时的统一终止协议。 */
export const CHILD_BLOCKING_PROTOCOL =
  '缺少委派上下文时不要直接问用户；将问题反馈给父 agent，并输出 STATUS: BLOCKED、QUESTIONS、IMPACT。未明确指定模式时不猜测。';

export function buildAgentProtocol(): string {
  return [DISPATCH_PROTOCOL, LEDGER_PROTOCOL, RUNTIME_GUARDS_PROTOCOL].join('\n\n');
}
