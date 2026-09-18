import type { SkillDefinition } from './types';

const OCEANUS_INTAKE_SKILL: SkillDefinition = {
  name: 'oceanus-intake',
  category: 'phase',
 description:
      'Intake — 由 Sisyphus 直接收集并分类需求，完成技术环境调研与执行配置批问；代码相关任务在代码调研开始前触发 CBM 初始化后输出 intake_report。',
   slash: true,
  content: `---
name: oceanus-intake
category: phase
description: Intake — 由 Sisyphus 直接收集并分类需求，完成技术环境调研与执行配置批问；代码相关任务在代码调研开始前触发 CBM 初始化后输出 intake_report。
input: 用户请求
owner: Sisyphus
output: intake_report
entry: 新任务
exit: 需求边界与验收明确
failure: 记录阻塞并 fail-open
verification: 报告字段检查
humanReview: required
---

# Oceanus Intake

## 目标

在 discuss 之前，由 主 Agent 完成轻量、可验证的需求 intake，不设计方案、不写代码、不创建计划或 ledger。

## 步骤

1. **CBM 预判初始化（先于任何代码调研）**：在读取项目背景、工作区结构等任何代码调研开始之前，基于用户请求文本做代码相关性快速预判——请求涉及修改、生成、删除、测试或分析仓库代码/配置 → 预判代码相关。预判代码相关时由 Sisyphus 立即触发一次首次 \`cbm_index\`（唯一索引入口，自动以 workspace 目录名为项目名；勿用 direct \`index_repository\` 建索引——其项目名按全路径拼接，会造成双索引），触发后不等待完成（索引与后续需求收集、批问并行），失败、超时或 in-progress 按 fail-open 处理；预判非代码时不触发，保持非代码任务不索引。预判结果与触发时机写入 intake_report 的 \`cbm\` 字段，并在步骤 7 正式分类后修正。
2. **了解故事背景**：使用当前会话中已确认的用户上下文，并读取项目背景、工作区结构、当前分支/变更与相关入口；不凭空推断，也不把已知需求再次交给 subagent。
3. **技术环境调研（代码相关任务）**：对步骤 1 预判代码相关的任务调研项目技术环境，为验收标准与验证通道提供可执行依据——优先读取项目说明文档（\`README.md\`、\`AGENTS.md\`、\`CLAUDE.md\`、\`CONTRIBUTING.md\`，存在即读），提取构建、测试、验证命令与环境约定；文档缺失或信息不足时，按项目类型读取构建与依赖配置：\`JVM\` 后端读 \`pom.xml\`（\`Maven\`）或 \`build.gradle\` / \`build.gradle.kts\`（\`Gradle\`）确认构建工具、框架与 \`JDK\` 版本；前端/\`Node\` 项目读 \`package.json\` 与 \`lockfile\` 确认包管理器与脚本命令；\`Python\` 项目读 \`pyproject.toml\` / \`requirements.txt\`；\`Go\` 项目读 \`go.mod\`；\`Rust\` 项目读 \`Cargo.toml\`。同时结合会话环境确认当前任务执行环境（操作系统类型如 \`linux\`/\`windows\`/\`mac\`、\`shell\` 与可用运行时版本），明确构建、测试与验证命令入口。结果写入 intake_report 的 \`tech_context\` 字段（语言、构建工具、框架、运行时版本、操作系统、验证命令入口与来源文件）；仅读取不改动，不安装依赖、不执行构建；配置文件无法判定的环境事实标注 \`Unclear\` 并列入 open_questions，不伪造。
4. **收集需求**：提炼并结构化记录 \`requirements_context\`：\`goal\`、\`problem\`、\`users\`、\`triggers\`、\`scope\`、\`non_goals\`、\`constraints\` 与可执行的 \`acceptance_criteria\`。只询问会阻塞后续工作的目标、边界、用户意图和验收问题，不在此阶段决定实现方法。
    - **会话能力预检（与需求收集同步完成）**：登记当前会话环境能力清单——headless 或有 TUI、剪贴板可用性、网络访问、CBM/ast-grep 等外部依赖，以及 **agent-browser 可用性**（探测前先加载 agent-browser skill，再按其能力可用性判定口径执行三级探测；仅探测不安装，作为步骤 9 browser_verify 批问项的能力依据）。每条验收信号必须标注验证通道（会话内可执行 / 需真实环境 / 需人工）；标注为"需真实环境或人工"的项不得进入会话内验收标准，改判为外部人工步骤（收尾时必须以 \`question\` 交还用户，并提供推荐项及“其他/自定义”入口）或改写为可会话内验证的口径，并写入 intake_report 的 open_questions 或 risks。禁止到 review/finish 阶段才发现验收不可执行。
5. **需求清晰度门禁**：分别给 Goal、Boundary、Constraint、Acceptance 评分（0.0–1.0），权重为 35%/25%/20%/20%；最低分分别为 0.75/0.70/0.65/0.70，加权歧义为 \`1 - (0.35*goal + 0.25*boundary + 0.20*constraint + 0.20*acceptance)\`。只有总歧义 ≤ 0.20 且所有最低分满足时才正常交接；任一关键字段缺失（目标、问题、用户或触发场景、范围/非目标、约束、验收）即硬阻塞，不得用用户“批准”替代缺失字段。
6. **结构化假设**：将无法由需求或代码事实确认、但会改变实现结果的内容登记为 \`assumptions[]\`，每条必须包含 \`id\`、\`statement\`、\`evidence\`、\`confidence\`、\`consequence_if_wrong\`、\`resolution\` 与 \`status\`。Confident 仅适用于有充分证据的项；Likely/Unclear 必须交给 discuss 进行批量纠偏。
7. **分类任务**：将请求明确分类为：
   - **代码任务**：需要修改、生成、删除或测试仓库代码/配置；
   - **非代码任务**：仅文档、解释、研究、问答或外部操作，不改代码；
   - **混合任务**：同时包含代码变更与非代码交付。
    分类确认后立即修正步骤 1 的 CBM 预判偏差：预判非代码但实际为代码/混合任务 → 立即补触发首次 \`cbm_index\`（唯一索引入口），并补做步骤 3 的技术环境调研；预判代码但实际为非代码任务 → 不回滚，如实记录偏差。
8. **复杂度分流**：将请求分为三档，写入 \`intake_report.complexity\`：
   - **Trivial**：单文件、低风险、方案明确，预估 ≤2 小时 → 后续走轻量路径。用户可显式要求升级单项质量保障（独立计划检查 / 完整 review 审计 / 补充调研），升级项按 Standard 对应环节执行并在报告中记录。
   - **Standard**：常规多文件/有依赖 → 完整六阶段流程。
   - **Architecture**：跨模块、高风险、方案未定型 → 完整流程；必要时由 Sisyphus 按需调用 @oracle(analysis) 提供 advisory。
9. **执行配置批问（一问三至四项：SDD、TDD、Review 循环执行，前端任务追加 browser_verify）**：
   - **适用判定**：任务产出涉及代码或文件实现改动 → 实现类，执行批问；产出为调研报告、查询结果、方案设计、评审意见等且不产生实现 diff → 非实现类，**跳过批问**，三项按默认关闭记录并在 intake_report 标注 \`execution_config.not_asked: non-implementation\`。
   - **前端范围判定（实现类任务在批问前完成，≤10 秒）**：识别任务是否包含前端 UI/交互实现，结果写入 \`intake_report.frontend_scope\`：
     - 识别信号（任一命中即判定涉前端）：\`tech_context\` 含前端框架/构建（React/Vue/Svelte/Next/Vite 等，来自步骤 3 的 package.json 与构建配置）；需求关键词含 UI/页面/组件/样式/布局/动效/交互/还原/设计稿（对齐 oceanus 主协议的 designer 触发器）；或存在设计稿图片附件（clipboard-image-observer 触发条件）。
     - 取值：\`ui-pixel\`（像素敏感还原/品牌视觉，对应 observer L4）| \`ui-standard\`（常规页面/组件，对应 L3）| \`interaction\`（交互逻辑为主，无视觉还原诉求）| \`none\`（非前端）。
     - 拿不准是否涉前端时一律判定为涉前端（保守让批问项出现），但 \`browser_verify\` 默认推荐仍为关闭，由用户决定。
   - 实现类任务用一次 \`question\` 批量询问 SDD、TDD、Review 循环执行三项；**\`frontend_scope ≠ none\` 时同一批问追加第四项 browser_verify（浏览器渲染验证：经 agent-browser 做渲染截图、视觉 diff、token 核对与交互断言；能力探测、安装引导与降级口径以 agent-browser skill 为唯一来源）**；默认推荐均关闭，漏答或含糊项回落关闭并记录，不补问；Trivial 实现任务也必须完成这次批问。
   - **SDD**：开启则落盘 spec/plan/progress/review。
   - **TDD**：开启则采用 RED → GREEN。
   - **Review 循环执行（review_loop）**：开启则 Review 发现 BLOCKER 后自动修复并重新 Review（复审闭环，最多 3 轮，通过才进入 Finish）；关闭（默认）则一次性修复全部 BLOCKER 并取得当前状态验证证据后直接进入 Finish，不重新 Review。
   - **browser_verify（仅 \`frontend_scope ≠ none\` 时出现在批问中；非前端实现任务记录 \`not_asked: non-frontend\`）**：开启则前端任务的 Plan 验证命令、Execute 视觉短反馈 / real-surface 取证 / L5 渲染截图来源、Review 完成矩阵证据接入 agent-browser 流程——agent-browser skill 是命令映射、能力探测、安装引导与降级口径的唯一来源，skill 内容不会自动注入上下文，后续任何阶段的浏览器验证操作（Plan 编写验证命令、Execute 短反馈/取证、Review 证据复审）前必须先显式加载该 skill，仅凭阶段 skill 内的引用句不得执行 agent-browser 命令；关闭（默认）则全部阶段流程与无浏览器验证时完全一致。能力不可用（三级探测都无且用户拒绝安装）时该项标注不可用并记录原因；用户选择开启则先加载 agent-browser skill 并按其安装引导执行。插件配置 \`agentBrowser.enabled=false\` 时该项一律跳过并记录 \`not_available: disabled-by-config\`。
   - **能力级总开关与批问的关系**：插件配置 \`agentBrowser.enabled\`（默认 true）只决定能力是否存在（setup 已按配置探测与可选安装）；批问决定的是**本任务**是否启用——能力关 → 批问不出现第四项；能力开 + 非前端 → \`not_asked: non-frontend\`；能力开 + 前端 → 正常批问。
10. **核对 CBM 初始化与记录（代码相关任务）**：核对步骤 1 的预判初始化与步骤 7 的分类修正结果，确保代码/混合任务在 discuss 代码调研与 Plan 影响面自查开始前已尽早触发首次 \`cbm_index\`（唯一索引入口；fail-open 口径不变）；Review 可在最终 diff 上按需刷新索引。
11. **Fail-open**：CBM 调用失败、超时或返回 \`in-progress\` 时不得阻塞 intake；记录状态、错误/超时信息和残余风险，继续使用可用的文件读取、grep 等方式完成报告。不得伪造索引成功。
12. **交接**：输出结构化 \`intake_report\`，其中必须包含需求清晰度、硬阻塞项、结构化假设和执行配置，并交给调用方；Sisyphus 主流程将其交给 discuss。非代码任务也必须交接分类与交付要求。

## intake_report 格式

报告至少包含：

- \`task_type\`: \`code\`、\`non-code\` 或 \`mixed\`；
- \`frontend_scope\`：\`ui-pixel\`、\`ui-standard\`、\`interaction\` 或 \`none\`（判定信号与取值见步骤 9 前端范围判定；非实现类任务标注不适用）；
- \`complexity\`: \`trivial\`、\`standard\` 或 \`architecture\`（含判定理由与预估工作量）；
- \`project_context\` 与 \`workspace_context\`；
- \`tech_context\`：语言、构建工具、框架、运行时版本（如 \`JDK\`/\`Node\` 版本）、操作系统与验证命令入口及其来源文件（仅代码/混合任务，非代码任务标注不适用）；
- \`minimum_requirements\`：从 requirements_context 提炼的最小交付要求（向后兼容字段）；
- \`requirements_context\`：目标、问题、用户、触发场景、范围、非目标、约束与验收标准；
- \`ambiguity\`：四维分数、权重、最低分、加权歧义和评分依据；
- \`hard_blockers\`：缺失关键字段或未达门禁的具体原因；非空时不得进入 discuss 设计确认；
- \`assumptions[]\`：每项包含 A-ID、证据、置信度、错误后果、处理阶段和状态；
- \`open_questions\` 与风险；
- \`execution_config\`：SDD/TDD/Review 循环执行（review_loop）/browser_verify（仅前端任务批问）的选择、默认推荐（全关）、依据及回落记录；非实现类任务标注 \`not_asked: non-implementation\`；非前端实现任务对 browser_verify 标注 \`not_asked: non-frontend\`；插件配置关闭能力时标注 \`not_available: disabled-by-config\`；
- \`cbm\`: 代码相关性预判结果、首次 \`cbm_index\` 触发时机（步骤 1 预判触发 / 步骤 7 分类补触发 / 未触发及原因）、分类修正动作、结果（成功/失败/超时/in-progress/不适用）、证据及 fail-open 说明；
- \`handoff\`: 明确“交给 discuss”，以及 discuss 的下一步。

## 规则

- 只做 intake；不得在 Intake 阶段写实现代码、方案 spec、plan、ledger。
- 需求澄清不是“字段填满”检查：先确认 WHAT/WHY，再允许 discuss 讨论 HOW；评分和硬阻塞必须在报告中留下可审计依据。
- 代码/混合任务的首次 \`cbm_index\`（唯一索引入口）必须在任何代码调研开始前尽早触发（步骤 1 预判 + 步骤 7 分类修正保证）；非代码任务不因普通文本工作触发索引，预判误触发不回滚、如实记录。Intake 不委派 oracle analysis；Intake 是主 agent 自己的阶段。
- 技术环境调研仅读取说明文档与构建配置，不安装依赖、不执行构建命令；无法确认的环境事实按 \`Unclear\` 记录并列入 open_questions，不伪造环境结论。
- CBM 失败、超时、in-progress 一律 fail-open，并诚实记录，不把失败标记为成功。
- 报告完成后必须交给 discuss，不得跳过 discuss 的需求澄清与方案总批准（Trivial 为开工确认形式）；执行配置批问不得在 discuss 重复执行。
`,
};

export { OCEANUS_INTAKE_SKILL };
