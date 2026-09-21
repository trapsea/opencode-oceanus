/**
 * Agent 编排协议常量的单一来源：六阶段总契约、Code Mode 调用纪律、3 轮中断上报模板、
 * Plan 验收 rubric 与子 agent 阻塞协议。各提示词只组合这些常量，不复制规则文本；
 * 后台调研同步门禁与调研复用规则的消费文本位于 discuss/plan skill 与主 agent
 * 调度协议（agents/oceanus.ts），不在本模块重复。
 */

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
- CBM 由 Intake 负责在代码调研开始前尽早首次初始化（预判触发 + 分类修正）并故障开放；Plan/Review 的影响面自查与复查口径见下方 CBM 生命周期摘要；Finish 不调用 CBM。
- Review 是 Execute 后的正式审查阶段；其他阶段只做阶段内自查，不重复创建 Review/Completion Audit 门禁。
- Review 发现 BLOCKER 时立即退回 Execute 修复；WARNING 记录后可继续；UNCERTAIN 在任何模式下都阻塞并请求用户决策；INFO 不阻塞。
- **BLOCKER 处置由执行配置 review_loop 控制**：开启「Review 循环执行」时走自动回退闭环——把完整清单交给 Execute，完成全部 blocker 后重新 Review，Review 通过后自动进入 Finish，不得在阶段交接处等待用户再次提示，连续三轮仍未解决才建立用户阻塞边界；关闭（默认）时一次性修复全部 BLOCKER 并取得当前状态验证证据后直接进入 Finish，不重新 Review，同样不得等待用户再次提示。仅 UNCERTAIN、（循环模式下）连续三轮仍未解决的 BLOCKER、或修复持续失败触发 3 轮中断上报模板时，才建立用户阻塞边界。
- 所有工作在当前目录完成；并行写入仅遵循常驻 Agent 调度协议的文件所有权规则。
- 终态必须区分 \`completed\`、\`failed\`、\`blocked\` 和 \`pending\`，并附验证证据与更新时间。

### 阶段交接

每次阶段切换必须以统一 Markdown 结果外壳输出最小 \`phase_handoff\`；不得使用 XML/HTML 标签、JSON/YAML、数组字面量或管道分隔的伪表格。必须使用以下模板，阶段可在“详情”中追加专属字段：

# 结果

## 状态

\`<completed | failed | blocked | pending>\`

## 摘要

<本阶段完成情况>

## 详情

### 阶段交接

#### current_phase

<当前阶段>

#### input_sources

- <输入来源>

#### completed

- <已完成事项>

#### next_action

<下一动作>

#### updated

<ISO 8601 更新时间>

## 证据

- <命令、文件或审查证据>

## 验证

- <验证结果或无>

## 未确认项

- <问题或无>

## 负向发现

- <已排除事项或无>

## 剩余风险

- <风险或无>

其中 \`status\`、\`current_phase\`、\`input_sources\`、\`completed\`、\`open_questions\`、\`next_action\`、\`risks\`、\`evidence\`、\`updated\` 为强制语义字段，分别映射到同名或对应的中文 Markdown 章节；不得省略。阶段 Skill 是详细操作手册，不是遵守本总契约的前置条件；Skill 未加载或阶段输入不完整时，不得假设阶段已完成，必须停在当前阶段并报告具体缺口。

### 自主续航与暂停边界

- 阶段的 \`completed\` 不是等待下一条用户消息的信号。输出 \`phase_handoff\` 后，立即在同一工作流中加载并执行下一阶段；Intake → Discuss → Plan → Execute → Review → Finish 必须连续推进，不得仅汇报交接结果后无故停止。
- 每次开始或恢复工作时，根据最近的 \`phase_handoff\`、计划/todo/ledger、用户决策和新鲜证据识别当前阶段与 \`next_action\`；从第一个未终态动作继续，不依赖聊天记忆，也不要求用户重复发出“继续”。
- 仅当缺少会改变范围、验收、方案方向或不可逆操作的用户决策，必须由用户批准，必须由用户在真实环境完成操作，或触发既定的三轮失败/复审上限时，才可以暂停。证据缺口、可自行调研的代码事实、可按既定计划执行的任务和已定义的 BLOCKER 修复不得作为等待用户的理由。
- 需要暂停时必须调用 \`question\` 工具建立阻塞边界；先简要说明原因，再给出互斥、可执行的选项，其中必须明确标注推荐项及理由，并提供“其他/自定义”入口。不得用普通文本提问、沉默等待，或把内部 \`phase_handoff\` 当作用户操作。
- 用户回复后立即将决策写回当前阶段输入并从 \`next_action\` 自动续航；若用户没有可回答的决策，继续自主处理或如实标记 \`failed\`，不得长期保持无解释的 \`pending\`。

### 完成边界

没有新鲜、完整且覆盖验收标准的证据，不得声称完成。Review 负责正式证据审查；Finish 只接受 Review、Completion Matrix、ledger 和 evidence 均满足要求的阶段输入，只做只读交付汇总，不测试、不构建、不调用 CBM、不修改文件、不委派 subagent。`;

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
