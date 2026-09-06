/** 审核场景注册表：在协议核心（./protocol）之上提供具体场景实例。
 *
 *  语义来源（全部以文本形式内嵌于 checks，不 import 任何 agent 定义文件）：
 *  - plan-gate：迁移自原 momus 执行前门禁——依赖/范围/测试策略/可执行性四维检查、
 *    BLOCKER/SUGGESTION 分级、Blocking Issues 上限、最小修订集与复审收敛；
 *    影响面校验继承 CBM MOMUS_SECTION 的 impact_estimate 覆盖语义；
 *    验收绑定语义对应 src/agents/protocol.ts 的 PLAN_ACCEPTANCE_RUBRIC。
 *  - solution-analysis：迁移自原 metis 的 BACKGROUND_RESEARCH / SOLUTION_ANALYSIS 双模式。
 *  - diff-review / completion-audit / visual-acceptance：新增交付级审核场景
 *    （diff 范围与验收证据映射 / Completion Audit 六项判定矩阵 / L5 取证 diff）。
 */

import { defineScene } from './protocol';
import type { ReviewScene } from './protocol';

/** plan-gate 检查清单：原 momus 门禁语义的场景指令文本改写。 */
const PLAN_GATE_CHECKS = `### 检查维度（第 1 轮必须一次性穷尽全部维度，含 SUGGESTION 级发现，避免后续轮补漏）
- 依赖：依赖是否齐全、顺序是否合理、是否引入未声明的外部依赖；每条任务是否有可用的起点（前置产物与输入已就绪）。
- 范围：是否含未授权/越界改动；声明的 Files 与任务是否对齐。
- 测试策略与可执行性：是否有可验证的测试策略与验收标准、是否覆盖关键边界；步骤是否明确、可被 executor 直接执行，是否遗留模糊决定或未决阻塞决策。
- 影响面（impact_estimate 覆盖校验）：校验计划声明的每个修改文件/公共符号及已知受影响调用方、被调用方或契约是否被 impact_estimate 覆盖；必要时对关键点抽查（cbm_search_graph 定位，必要时 cbm_trace/cbm_code 核对并列出具体缺口与 qualified name），不要求、不执行完整 trace；发现覆盖不足 → REJECT 并列出具体缺口；校验结论记入 plan status，供 Review 阶段做影响面复查对比。只做查询型检索，不调用 cbm_index、不重建索引；CBM 不可用时 fail-open——标注不确定性并建议 Review 阶段补查，不虚构影响面；简单任务跳过校验需说明理由。
- 验收标准绑定可执行验证：每条验收标准必须绑定一条可直接执行的验证命令或明确的机械检查步骤（命令 + 预期输出/退出码），不得停留在"通过/符合"级别的口头描述；文档类任务必须有行级或文件级锚点目标（具体到目标行/目标段落/文件清单）；涉及一致性比对的验收必须固化抽查集（文件 + 断言清单），复审与 review 按同一清单复对。

### 输出契约与分级
- 必须且只能输出 **[OKAY]** 或 **[REJECT]**。
- 问题分级：BLOCKER（依赖错误、范围越界、测试/验收缺失、步骤不可执行、影响面遗漏、未决阻塞决策）→ 必须修订才能过审；SUGGESTION（表述、措辞、清单格式、断言细节等文档级细节）→ 不阻塞，随结论一并给出但不计入最小修订集。
- 仅 BLOCKER 触发 REJECT；REJECT 时附 Blocking Issues，最多 3 条，每条包含具体文件/任务定位与需要修改什么（可直接落地的修订文本，不留给修订者猜测）。
- REJECT 必须附最小修订集：逐条列出满足即可过审的修订项（逐条修改建议 + 解决该问题的验证方式），修订者按其逐条落实、不自行发挥。

### 复审与诚信
- 复审轮（N>1）只验证前轮 BLOCKER 是否按建议解决、以及修订是否新引入 BLOCKER，不追加前轮已存在但未列出的旧问题；SUGGESTION 级新发现不阻塞、只作备注。
- 不伪造 verdict：依据不足时不虚构通过结论；仅评判提供的计划，不臆造需求、不重新设计；若用户澄清或批准尚未完成，以计划尚未准备好为由 REJECT。`;

/** solution-analysis 检查清单：原 metis 双模式语义的场景指令文本改写。 */
const SOLUTION_ANALYSIS_CHECKS = `### 模式（请求必须准确选择其一；不得默默执行 Intake）
- BACKGROUND_RESEARCH（背景研究）：在 Brainstorm 开始、Intake 分类之后使用。扫描代码库与上下文生成 research_brief，使后续阶段无需重新扫描已知内容：①现状——相关模块/文件的现有实现与结构；②关键符号——qualified name、文件路径、行号；③约束与依赖——影响方案选择的既有契约、配置、调用关系；④可直接复用的已有事实结论（符号/调用链/影响面查询结果）。只做调研：不做方案对比、不给推荐。
- SOLUTION_ANALYSIS（候选方案对比）：仅当已有 Intake 报告、用户澄清完成、且候选方案之间确有未决选择需要独立分析时使用（复杂度本身不是触发条件）。比较各候选方案的 trade-off（权衡）、依赖、迁移/回滚事项、风险、边界情况和可测试的决策标准；有充分依据时给出推荐方向及理由，但不执行实现；前置条件缺失（未指定模式、缺少 Intake、仍需用户澄清）时先指出前置条件缺失，不猜测。
- 若本会话此前执行过 BACKGROUND_RESEARCH：直接复用已有背景，只对候选方案做增量验证与挑错，不重新扫描代码库。

### 输出要求（简洁且具体）
- 覆盖五类输出：需求缺口（spec/plan 未覆盖的目标、边界与验收标准）、风险（实现阶段最可能出错、成本最高的点）、边界（方案明确不做什么、不可触达的范围）、反例/边界条件（需要显式处理的输入、失败与空场景）、验收标准（可验证、可测的成功判据）。
- 每个输出项除指出问题外，必须附可操作的建议处理方式（怎么补/怎么改/怎么规避），使消费方可直接落实而不需反向猜测。
- 结论引用 qualified name、文件路径、行号等可定位证据；需要对照现有实现时仅用查询型检索（cbm_search_graph/cbm_code 定位相关符号与调用链），不初始化索引。

### 边界（advisory）
- 不授权、不替代用户决策：只做分析并给出结论，最终决策留给 orchestrator/sisyphus 与用户。
- 不输出任何门禁 verdict 字面量：不以 OKAY/REJECT 二元判定、也不以行首 PASS/WARN/FAIL 作结论，避免下游误解析为门禁结果。`;

/** diff-review 检查清单：交付 diff 的范围与证据映射审核。 */
const DIFF_REVIEW_CHECKS = `- 范围核对：对照计划声明的 Files 逐项检查最终 diff；范围外变更（计划未声明、且不属于声明文件必要伴随改动的文件）判 FAIL 并列出文件与位置；计划声明但未落实的变更为缺口，需明确说明。
- 验收证据映射：将计划中每条验收标准映射到可审计证据（命令及输出、测试结果、构建产物、文件引用）；证据缺失或不可复现的验收项列为 WARN。
- 回归与测试缺口：对照计划目标与被改动符号的调用语义，发现的行为回归与缺失的测试按严重度分级列出（BLOCKER=行为回归或验收级缺失；SUGGESTION=覆盖增强建议），每条附 evidence 与 fix。
- 结论分级：PASS=范围与证据齐全；WARN=存在证据缺失但不影响验收结论；FAIL=存在范围外变更或行为回归。结论词 PASS/WARN/FAIL 必须在行首单独输出，随后给出依据。`;

/** completion-audit 检查清单：Completion Audit 六项判定矩阵门禁。 */
const COMPLETION_AUDIT_CHECKS = `- 逐项执行 Completion Audit 六项判定矩阵，每项给出结论与证据（具体文件/条目引用）：
  ① review 完成：review 阶段的审核结论已存在且覆盖全部交付物；
  ② completion 矩阵无缺口：计划中每条任务与验收标准均有对应完成记录，无未闭合项；
  ③ ledger 全部终态：任务账本所有条目均为 completed/failed/blocked 等终态，无遗留 pending/in_progress；
  ④ 门禁状态有效：plan 门禁结论为 OKAY，或存在记录在案的有效豁免（含理由与批准来源）；
  ⑤ 人工批准存在：需要用户批准的决策点均有明确的批准记录；
  ⑥ 证据可审计：每项完成声明均可追溯到可复现证据（命令/输出/文件路径/审核产物）。
- 任一判定项存在缺口 → 输出 **[REJECT]**，逐条列出缺口（引用具体文件/条目）与退回 execute 的具体动作（改什么、怎么验证）；六项全部通过才输出 **[OKAY]**。
- 不得伪造完成：证据缺失即缺口；不把口头声明、mock、skip 或降级结果记为已验证完成，验证不了的项目一律按缺口处理。`;

/** visual-acceptance 检查清单：L5 取证 diff 视觉验收。 */
const VISUAL_ACCEPTANCE_CHECKS = `- L5 取证 diff：以设计基准图为基准，与待验图片逐区域比对；输入为基准图路径 + 对比图路径 + 契约项清单（布局、间距、层级、动效、颜色、文案等逐项）。
- 输出必须包含逐项比对清单：每个契约项给出 PASS/FAIL + 证据（两图中的位置描述）+ 偏差描述；末尾总结 FAIL 数并给出总结论。
- 偏差分级：FAIL=验收级偏差（布局错位、结构缺失、明显颜色/层级偏差等影响验收的偏差）；WARN=轻微偏差（token 级近似、细节差异，不影响验收）。严重级排序参考：布局错位 > 颜色偏差 > 文案差异 > 细节。
- 结论词 PASS/WARN/FAIL 在行首单独输出。
- 只报告实际可见的差异，不捏造未见过的内容；不确定的区域明确标注不确定，不以猜测替代观察。`;

const planGateScene = defineScene({
  name: 'plan-gate',
  reviewer: 'oracle',
  subjectType: 'plan',
  subjectGlobs: ['.oceanus/plan/*.md', '.omo/plans/*.md'],
  contract: 'gate',
  checks: PLAN_GATE_CHECKS,
  independence: 'fresh-session',
  onReject: 'revise-plan',
  maxRounds: 3,
});

const solutionAnalysisScene = defineScene({
  name: 'solution-analysis',
  reviewer: 'oracle',
  subjectType: 'plan',
  subjectGlobs: ['.oceanus/spec/*.md', '.oceanus/plan/*.md', '.omo/plans/*.md'],
  contract: 'advisory',
  checks: SOLUTION_ANALYSIS_CHECKS,
  independence: 'reusable',
  onReject: 'escalate',
  maxRounds: 3,
});

const diffReviewScene = defineScene({
  name: 'diff-review',
  reviewer: 'oracle',
  subjectType: 'diff',
  subjectGlobs: ['.oceanus/**/*.md', '.omo/**/*.md', '*.diff', '*.patch', '.oceanus/**/*.diff', '.oceanus/**/*.patch'],
  contract: 'graded',
  checks: DIFF_REVIEW_CHECKS,
  independence: 'fresh-session',
  onReject: 'return-execute',
  maxRounds: 3,
});

const completionAuditScene = defineScene({
  name: 'completion-audit',
  reviewer: 'oracle',
  subjectType: 'completion',
  subjectGlobs: ['.oceanus/progress/*.md', '.oceanus/review/*.md', '.omo/**/*.md'],
  contract: 'gate',
  checks: COMPLETION_AUDIT_CHECKS,
  independence: 'fresh-session',
  onReject: 'return-execute',
  maxRounds: 3,
});

const visualAcceptanceScene = defineScene({
  name: 'visual-acceptance',
  reviewer: 'observer',
  subjectType: 'image',
  subjectGlobs: ['.oceanus/media/*', '*.png', '*.jpg', '*.jpeg', '*.webp'],
  contract: 'graded',
  checks: VISUAL_ACCEPTANCE_CHECKS,
  independence: 'fresh-session',
  onReject: 'return-execute',
  maxRounds: 3,
});

/** 审核场景注册表：name → 场景定义；运行时冻结，防篡改。 */
export const REVIEW_SCENES: Readonly<Record<string, ReviewScene>> = Object.freeze({
  'plan-gate': planGateScene,
  'solution-analysis': solutionAnalysisScene,
  'diff-review': diffReviewScene,
  'completion-audit': completionAuditScene,
  'visual-acceptance': visualAcceptanceScene,
});

/** 按名取场景；未注册返回 undefined（调用方不得猜测默认场景）。 */
export function getReviewScene(name: string): ReviewScene | undefined {
  return REVIEW_SCENES[name];
}
