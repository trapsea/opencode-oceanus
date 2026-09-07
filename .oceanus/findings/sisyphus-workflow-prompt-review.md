## 结论摘要
- claim: Sisyphus 当前常驻 prompt 仅保留“按阶段加载 Skill”的指令，并未把六阶段 workflow Skill 文本内嵌进 agent prompt。
  evidence: src/agents/sisyphus.ts:9；src/agents/oceanus.ts:219-220；src/skills/oceanus-workflow.ts:17-42
  status: confirmed
  source_version: 当前工作区未提交改动；见 git status --short
  impact: 与“单一常驻 prompt 内置完整阶段流程”的目标不一致，且运行时仍依赖 Skill 加载。
  open_questions: 是否要把 oecanus-workflow 及六个阶段 Skill 内容拼接进 Sisyphus.system，还是仅内联 workflow 总契约并保留阶段 Skill 作为独立注入。
  negative_findings: 未发现现有代码中有任何“将 workflow Skill 内容注入 Sisyphus.system”的路径。
- claim: Sisyphus 的 prompt 生成链路是 createAgents -> createSisyphusAgent -> buildCompactPromptSections/renderPrompt/resolvePrompt；workflow 段目前只给出摘要，不含完整 Skill。
  evidence: src/agents/index.ts:185-199；src/agents/sisyphus.ts:11-28；src/agents/oceanus.ts:200-221, 227-252
  status: confirmed
  source_version: 当前工作区未提交改动；见 git status --short
  impact: 任何 prompt 级别调整都应改动 agents/oceanus.ts 的 workflow 段或 sisyphus.ts 的角色串，而不只是调整 skills 注册。
  open_questions: 是否需要同步更新 oceanus 主 agent 的 workflow 摘要，避免 oceanus/sisyphus 行为分叉。
  negative_findings: 未见额外的 prompt 后处理器会自动补齐 workflow Skill。
- claim: 六阶段契约目前由 OCEANUS_WORKFLOW_SKILL 独立承载，且仍通过 ctx.skill.transform 注册到宿主。
  evidence: src/skills/oceanus-workflow.ts:3-42；src/index.ts:225-245；src/skills/index.ts:18-29
  status: confirmed
  source_version: 当前工作区未提交改动；见 git status --short
  impact: 仅改 agent prompt 不会改变 skill 注册面；若要“减少依赖 Skill 加载失效”，需同时考虑技能是否仍作为运行时门禁来源。
  open_questions: 是否允许保留 skill 注册但不再把其作为 Sisyphus 的唯一语义来源。
  negative_findings: 未发现 workflow skill 被特殊豁免或被拼接进主 prompt。
- claim: 当前 workflow Skill 已明确覆盖阶段顺序、阶段交接、CBM 边界、Review BLOCKER 回退、Finish 禁止动作等核心契约。
  evidence: src/skills/oceanus-workflow.ts:19-42；src/skills/oceanus-review.ts:63-78；src/skills/oceanus-finish.ts:47-52；src/skills/oceanus-execute.ts:45-46
  status: confirmed
  source_version: 当前工作区未提交改动；见 git status --short
  impact: 这些内容是“必须保留”的候选契约，适合内联到 Sisyphus 常驻 prompt 时作为不可缺失段落。
  open_questions: 是否需要把这些规则复制进 Sisyphus prompt 还是改为引用式聚合以避免重复。
  negative_findings: 未发现这些规则在 Sisyphus 常驻 prompt 中被逐项展开。
- claim: Sisyphus prompt 与 workflow Skill 在“调度协议归属”上存在表述不一致：前者说阶段 Skill 承载流程和门禁，后者又说调度必须遵循常驻调度协议、不依赖调度 Skill。
  evidence: src/agents/sisyphus.ts:9；src/skills/oceanus-workflow.ts:33-37；src/agents/oceanus.ts:181-188, 215-220
  status: confirmed
  source_version: 当前工作区未提交改动；见 git status --short
  impact: 这会让“到底谁是权威来源”不清晰，容易在重构为单一 prompt 时产生重复或冲突。
  open_questions: 是否要把“调度协议”与“阶段流程/门禁”完全拆分为不同常驻段落。
  negative_findings: 未见统一的权威定义来区分调度协议与阶段 Skill。
- claim: 现有测试已经把“workflow 仍是独立 Skill”“Sisyphus 不再把调度协议归因于 Skill”“Review BLOCKER 自动回退”等文本契约固化为断言。
  evidence: src/skills/workflow-clarification.test.ts:14-45, 56-63；src/agents/cbm-usage.test.ts:104-143；src/skills/gate.test.ts:70-78, 115-146
  status: confirmed
  source_version: 当前工作区未提交改动；见 git status --short
  impact: 若把 workflow Skill 内联进 Sisyphus prompt，这些测试大概率需要同步调整，否则会继续约束“独立 Skill”语义。
  open_questions: 是否要保留“独立 Skill 注册”但改写测试为“内联内容与注册内容一致”。
  negative_findings: 未见任何测试验证“workflow Skill 已内联到 Sisyphus.system”。
- claim: 当前实现没有发现将 Sisyphus prompt 直接串接 oceanus-workflow 内容的代码。
  evidence: src/agents/sisyphus.ts:19-28；src/agents/oceanus.ts:214-220；src/index.ts:228-245
  status: confirmed
  source_version: 当前工作区未提交改动；见 git status --short
  impact: 目标变更需要新增 prompt 组装逻辑，而非仅修改文案。
  open_questions: 是否需要新增专用 builder 以同时生成 oceanus 与 sisyphus 的统一工作流块。
  negative_findings: 未发现任何 `+ OCEANUS_WORKFLOW_SKILL.content` 之类的拼装点。

## 关键文件与符号表
- src/agents/sisyphus.ts — createSisyphusAgent / SISYPHUS_ROLE：定义 Sisyphus 常驻身份与系统 prompt。
- src/agents/oceanus.ts — buildCompactPromptSections / buildOceanusPrompt / createOceanusAgent：统一拼装主 agent prompt 与调度协议。
- src/agents/protocol.ts — DISPATCH_PROTOCOL / RUNTIME_GUARDS_PROTOCOL / THREE_ROUND_TEMPLATE：调度、运行时与中断上报单一来源。
- src/skills/oceanus-workflow.ts — OCEANUS_WORKFLOW_SKILL：六阶段顺序、交接与完成门禁的独立 Skill。
- src/skills/oceanus-intake.ts — OCEANUS_INTAKE_SKILL：Intake 需求澄清、执行配置批问、首次 CBM 初始化。
- src/skills/oceanus-discuss.ts — OCEANUS_DISCUSS_SKILL：方案讨论、灰区澄清、批准与决策登记。
- src/skills/oceanus-plan.ts — OCEANUS_PLAN_SKILL：文件映射、任务切分、impact_estimate、自审与 Oracle advisory。
- src/skills/oceanus-execute.ts — OCEANUS_EXECUTE_SKILL：按 plan 实施、验证、ledger 与自动回到 Review。
- src/skills/oceanus-review.ts — OCEANUS_REVIEW_SKILL：完成声明验证、CBM 预算、BLOCKER 回退、Completion Audit。
- src/skills/oceanus-finish.ts — OCEANUS_FINISH_SKILL / decideFinish：只读收尾判定与缺口输出。
- src/skills/index.ts — OCEANUS_SKILLS：统一注册全部 skill 并通过 ctx.skill.transform 注入宿主。
- src/index.ts — ctx.skill.transform 注入路径：把 OCEANUS_SKILLS 写入宿主 skill registry。
- src/agents/index.ts — createAgents：把 sisyphus/oceanus 与子 agent 装配成最终 agent 列表。
- src/skills/workflow-clarification.test.ts — workflow 与 finish 的澄清性断言。
- src/skills/gate.test.ts — intake/discuss/plan/execute/review/finish 的契约断言。
- src/agents/cbm-usage.test.ts — 主 prompt/技能文本中的 CBM 与调度协议边界断言。

## 风险与未知项
- 未确认：应把“完整 workflow Skill 内容”全部内联，还是只把阶段顺序/门禁/交接规则内联并保留独立 Skill 作为外部复用来源。
- 未确认：是否要让 Sisyphus 与 Oceanus 共享同一份 workflow 段，还是只让 Sisyphus 持有更完整版本。
- 未确认：内联后如何避免与现有 skill 文本、测试断言和注册说明出现重复或自相矛盾。
- 未确认：是否需要更新 `src/index.ts` 的 skill 注入说明，避免文档仍暗示“依赖加载 Skill”。
- 风险：当前工作区已有大量未提交改动（见 `git status --short`），后续审查/变更必须严格避免误归因。

## 证据引用
- `src/agents/sisyphus.ts:9` → claim 1, 5
- `src/agents/sisyphus.ts:11-28` → claim 2, 8
- `src/agents/oceanus.ts:200-221, 227-252` → claim 2, 8
- `src/agents/oceanus.ts:181-188` → claim 5
- `src/agents/index.ts:185-199` → claim 2
- `src/index.ts:225-245` → claim 3, 8
- `src/skills/oceanus-workflow.ts:19-42` → claim 4
- `src/skills/oceanus-intake.ts:31-51` → claim 4
- `src/skills/oceanus-discuss.ts:36-110` → claim 4
- `src/skills/oceanus-plan.ts:31-52, 151-186` → claim 4
- `src/skills/oceanus-execute.ts:36-46, 69-89, 134-145` → claim 4
- `src/skills/oceanus-review.ts:63-78, 92-133` → claim 4
- `src/skills/oceanus-finish.ts:47-52` → claim 4
- `src/skills/index.ts:18-29` → claim 3
- `src/skills/workflow-clarification.test.ts:14-45, 56-63` → claim 7
- `src/skills/gate.test.ts:70-78, 115-146` → claim 7
- `src/agents/cbm-usage.test.ts:104-143` → claim 7
