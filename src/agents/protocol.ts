/** Agent 编排协议的单一来源；各提示词只负责组合，不复制通用规则。 */
export const DISPATCH_PROTOCOL = `### 调度协议
所有调度使用结构化对象参数：subagent({ agent, description, prompt, background })。prompt 必须是实际包含换行的多行 Markdown 文本；目标、背景、范围、非目标、验收、验证、风险和预期输出必须各自独占一行或一个小节，字段之间留空行。禁止把多个字段压在同一行，禁止只传字面量 \\n。派发前声明稳定 lane 与文件边界；不要依赖队列通知。

### 后台调研同步门禁
Explorer 与 Oracle 的只读调研可以使用 \`background: true\`，但派发后必须登记 child session ID、agent、研究问题和状态。进入 Discuss 或 Plan 之前，先对本任务已登记且会影响当前阶段的每个后台调研 session 使用宿主提供的会话等待能力（OpenCode v2 优先使用 \`session.wait({ sessionID })\`），再回收其成功、失败或阻塞结果。后台完成通知不是放行依据；不得在结果回收前消费调研结论。无法确认完成、结果缺失或宿主不提供等待能力时，当前阶段保持 \`pending\`/\`blocked\` 并报告缺口，不得猜测或伪造完成。无相关后台调研时记录 \`not_applicable\`。

### 调研复用规则
委派只读调研（explorer/librarian/oracle）前，先检查会话内已回收的调研结论（七字段结构）：研究问题、task 标识、state_head、变更文件集合与用户决策均未变化（复用快照未失效）时，直接复用已有结论并只做增量提问，不重复全量调研；结论缺失、部分覆盖或快照失效时 fail-open 重新委派，不得使用过期结论或把旧结论当作已验证事实。正式审查场景（review/diff-review/completion-audit/visual-acceptance）不复用任何审查会话与旧 verdict；前置调研事实只能作为未验证线索注入 Brief，由审核者基于当前 state_head 与 diff_scope 的证据重新核验。`;

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
- Oracle 在 Review 阶段执行正式只读审查并输出 graded 结论；Sisyphus 负责委派、证据核验、BLOCKER 回退和阶段推进。Oracle 顾问的 consult/analysis 仍是 advisory，不授予批准。
- CBM 由 Intake 负责在代码调研开始前尽早首次初始化（预判触发 + 分类修正）并故障开放；Plan 复用并自查 \`impact_estimate\`；Review 可针对最终 diff 刷新索引并复查；Finish 不调用 CBM。
- Review 是 Execute 后的正式审查阶段；其他阶段只做阶段内自查，不重复创建 Review/Completion Audit 门禁。
- Review 发现 BLOCKER 时立即退回 Execute 修复；WARNING 记录后可继续；UNCERTAIN 在任何模式下都阻塞并请求用户决策；INFO 不阻塞。
- **BLOCKER 处置由执行配置 review_loop 控制**：开启「Review 循环执行」时走自动回退闭环——把完整清单交给 Execute，完成全部 blocker 后重新 Review，Review 通过后自动进入 Finish，不得在阶段交接处等待用户再次提示，连续三轮仍未解决才建立用户阻塞边界；关闭（默认）时一次性修复全部 BLOCKER 并取得当前状态验证证据后直接进入 Finish，不重新 Review，同样不得等待用户再次提示。仅 UNCERTAIN、（循环模式下）连续三轮仍未解决的 BLOCKER、或修复持续失败触发 3 轮中断上报模板时，才建立用户阻塞边界。
- 所有工作在当前目录完成；并行写入仅遵循常驻 Agent 调度协议的文件所有权规则。
- 终态必须区分 \`completed\`、\`failed\`、\`blocked\` 和 \`pending\`，并附验证证据与更新时间。

### 阶段交接

每次阶段切换必须输出最小 \`phase_handoff\`：\`current_phase\`、\`input_sources\`、\`completed\`、\`open_questions\`、\`next_action\`、\`risks\`、\`evidence\`、\`status\`、\`updated\`；阶段可追加专属字段。阶段 Skill 是详细操作手册，不是遵守本总契约的前置条件；Skill 未加载或阶段输入不完整时，不得假设阶段已完成，必须停在当前阶段并报告具体缺口。

### 自主续航与暂停边界

- 阶段的 \`completed\` 不是等待下一条用户消息的信号。输出 \`phase_handoff\` 后，立即在同一工作流中加载并执行下一阶段；Intake → Discuss → Plan → Execute → Review → Finish 必须连续推进，不得仅汇报交接结果后无故停止。
- 每次开始或恢复工作时，根据最近的 \`phase_handoff\`、计划/todo/ledger、用户决策和新鲜证据识别当前阶段与 \`next_action\`；从第一个未终态动作继续，不依赖聊天记忆，也不要求用户重复发出“继续”。
- 仅当缺少会改变范围、验收、方案方向或不可逆操作的用户决策，必须由用户批准，必须由用户在真实环境完成操作，或触发既定的三轮失败/复审上限时，才可以暂停。证据缺口、可自行调研的代码事实、可按既定计划执行的任务和已定义的 BLOCKER 修复不得作为等待用户的理由。
- 需要暂停时必须调用 \`question\` 工具建立阻塞边界；先简要说明原因，再给出互斥、可执行的选项，其中必须明确标注推荐项及理由，并提供“其他/自定义”入口。不得用普通文本提问、沉默等待，或把内部 \`phase_handoff\` 当作用户操作。
- 用户回复后立即将决策写回当前阶段输入并从 \`next_action\` 自动续航；若用户没有可回答的决策，继续自主处理或如实标记 \`failed\`，不得长期保持无解释的 \`pending\`。

### 完成边界

没有新鲜、完整且覆盖验收标准的证据，不得声称完成。Review 负责正式证据审查；Finish 只接受 Review、Completion Matrix、ledger 和 evidence 均满足要求的阶段输入，只做只读交付汇总，不测试、不构建、不调用 CBM、不修改文件、不委派 subagent。`;

export const LEDGER_PROTOCOL = `### 进度账本协议
 ledger 区分 pending、in_progress 与 completed/failed/blocked；记录验证证据和 updated_at。并行工作者不直接写共享账本。`;

export const RUNTIME_GUARDS_PROTOCOL = `### 运行时护栏协议
代码变更后旧 evidence 视为 stale；必须检查最终 diff、Files scope 与 acceptance criteria，并运行适用的测试、typecheck、build 和 real-surface 验证。`;

/**
 * Code Mode 调用纪律（beta-19296 宿主实证）：
 *
 * `execute` 的 JS 运行时内存在两种调用形态——工具挂在 `tools` 命名空间、
 * `search` 是全局内置函数。模型高频混淆点：把 `search` 写成 `tools.search(...)`
 * 会触发 `Unknown tool 'search'`（真实会话已复现）。本纪律常驻主 agent prompt，
 * 从源头约束调用形态；宿主版本差异（`tools.$codemode.search`）以运行时提示为准。
 */
export const CODEMODE_CALLING_PROTOCOL = `### Code Mode 调用纪律

在 \`execute\` 的 JS 运行时内，工具一律以 \`tools.<ns>.<name>(...)\` 或 \`tools["ns"]["tool"](...)\` 形态调用。\`search\` 是全局内置函数（发现工具目录与签名），不在 \`tools\` 命名空间内：写成 \`tools.search(...)\` 或 \`tools["search"](...)\` 会报 \`Unknown tool 'search'\`。不确定工具路径时，先 \`search({ query: "..." })\` 查询，再按返回的 path 调用；\`Object.keys(tools)\` 列出顶层命名空间。宿主版本差异注记：部分版本将 \`search\` 挂在 \`tools.$codemode.search\`——以当前运行时目录提示的实际形态为准，两种形态不得混用。`;

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
  return [DISPATCH_PROTOCOL, LEDGER_PROTOCOL, RUNTIME_GUARDS_PROTOCOL, CODEMODE_CALLING_PROTOCOL].join('\n\n');
}
