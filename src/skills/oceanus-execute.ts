import type { SkillDefinition } from './types';
import { CBM_LOOKUP_ORDER_NOTE } from '../cbm/registry';
import { CODEMODE_CALLING_PROTOCOL } from '../agents/protocol';

const OCEANUS_EXECUTE_SKILL: SkillDefinition = {
  name: 'oceanus-execute',
  category: 'phase',
  description:
    'Sisyphus 工作流第 4 阶段——执行。默认由主 agent 按 plan 顺序直接实现并逐任务验证；仅在文件完全不相交、改动机械同构且任务数不少于 3 时允许 @fixer 并行。',
  slash: true,
  content: `---
name: oceanus-execute
category: phase
 input: 已批准 spec/plan
owner: Sisyphus 主 Agent（默认直接实现；@fixer 仅逃生舱场景并行，只持有显式分配的文件范围）
output: 实现与证据
 entry: plan 自查完成
exit: 任务终态
failure: 标记失败并重规划
verification: 测试与 ledger
humanReview: conditional
description: Sisyphus 工作流第 4 阶段——执行。默认由主 agent 按 plan 顺序直接实现并逐任务验证；仅在文件完全不相交、改动机械同构且任务数不少于 3 时允许 @fixer 并行。
---

# Sisyphus 第 4 阶段 — 执行

## 目标
Sisyphus 主 Agent 持有计划、实现、ledger 与验收上下文；默认自己执行全部实现工作，仅将调研、隔离与逃生舱批量机械任务条件委派。

可靠地执行计划：按计划顺序直接实现，逐任务验证并完整跟踪。

## 调试触发

遇到 bug、测试失败、构建失败、超时或与预期不符的行为时，立即加载 oceanus-debugging。完成根因调查前不得修改生产代码；修复必须绑定复现、根因证据、回归测试和真实表面证据。

## 无上下文执行协议
执行者不得依赖聊天历史：先读取唯一 Spec 与 Plan，再核对当前 Task 的 Task ID、Goal/Context、Files、Interfaces、Dependencies、Preconditions、checkbox、Validation/Expected、Acceptance、风险与状态字段。缺少任一字段或 Spec 未绑定时立即阻塞并返回父 agent，不自行猜测。每一步记录命令、预期结果与实际结果；只修改声明的 Files。完成时输出实现摘要、验证证据（含实际输出/状态）、实际 diff 行数与剩余风险。
## 步骤
1. **加载计划与 ledger** — SDD 开启时从 \`.oceanus/plan/\` 与 \`.oceanus/progress/<plan-name>.md\` 加载；SDD 关闭时使用会话内计划与 todo。若本轮由 Review 回退，先读取 Review 输出的完整 **BLOCKER 清单**，将每项登记为待执行任务并核对其文件、依赖、验证命令和验收标准；不得遗漏、拆散后等待用户续接或只处理第一项。按 plan 任务顺序取下一个任务；其依赖未达终态时先完成前置任务，不跳序。
2. **主 agent 直接实现** — 按 plan 任务顺序逐个由主 agent 自己实现：读代码、编辑、运行测试、修复。动手前检查上下文缺口：缺口 → 委派 @explorer 补侦察（调研简报：附检索范围与返回格式），拿到浓缩事实再动手，禁止自己全量扫库重建认知。只读调研（@explorer/@librarian/@oracle 场景/@observer）相互独立时可在同一轮并行派发，不占用写入面、不参与文件所有权计算。遇到故障时先完成 oceanus-debugging 的四阶段，不得先写猜测式补丁。
3. **高风险与大输入处理** — 高风险公共符号、接口或配置契约修改前 → ${CBM_LOOKUP_ORDER_NOTE}：先用 search_graph 定位 exact symbol，再做 trace_path 调用链/影响面追踪（depth 按 depth 场景规则），或委派 @oracle(consult) 咨询影响面与方案。Cypher 保持 \`cbm_query\`。网页/外部文档 → @librarian，图像/PDF → @observer，预期超过 ~2000 行的命令输出 → shell 管道截断或委派 @explorer。**Code Mode 调用纪律**：${CODEMODE_CALLING_PROTOCOL}
4. **任务开工前更新（SDD 模式）** — SDD 开启时，任务开工前把该任务 ledger 行从 \`pending\` 更新为 \`in_progress\`（含执行者与时间戳），ledger 由主 agent 串行写入。SDD 关闭时用 \`todowrite\` 同步 todo 即可，不写文件。绝不要因为更新 progress-ledger 而中断或推迟当前任务。
5. **每个任务完成即验证并更新** — 任一任务完成后，立即运行或核验其声明的验证（typecheck/test/适用时真实表面验证；browser_verify 开启的前端任务，真实表面验证含 agent-browser 渲染截图/交互断言，见「浏览器验证」节），然后记录 \`completed\`/\`failed\`/\`blocked\`（SDD 模式写入 ledger 行，含证据、时间戳、备注；非 SDD 更新 todo）。同时记录该任务**实际实现代码 diff 行数**（git diff --stat 或等价方式，测试代码不计入），与 plan 预估行数一并写入备注，供 review 对比。
6. **执行委派逃生舱（唯一并行执行例外）** — 仅当「文件集完全不相交 + 改动机械同构 + 任务数 ≥3」三条件同时满足时，才把该批量任务拆给多个 @fixer 并行：在同一轮发起多个独立的 \`subagent({ agent, description, prompt, background: true })\` 调用（每个任务的 description 中都要有 lane marker），依赖任务等待其终态结果，返回后由主 agent 核验其声明的验证再记终态。三条件任一不满足时不得拆分，一律主 agent 自己实现。
7. **同步 todo 列表** — 保持内存中的 todo 与 ledger（SDD 模式）一致：将 plan 任务登记为 \`pending\`，任务开工时将当前任务标记为 \`in_progress\`，仅在获得终态结果和验证证据后将其标记为 \`completed\`/\`failed\`/\`blocked\`。

8. **BLOCKER 修复后的去向（执行配置 review_loop 控制）** — 当 Review 回退的 BLOCKER 清单中全部任务都达到 \`completed\` 并取得当前状态验证证据后：开启「Review 循环执行」时主流程自动重新进入 Review（重新加载 oceanus-review 执行复审），只有复审通过才进入 Finish，复审产生新的 BLOCKER 时继续同一自动闭环并累计轮次，达到三轮上限才请求用户；关闭（默认）时直接自动进入 Finish，不重新 Review，并把修复与验证证据交回 Review 主流程更新完成矩阵。两种模式都不得在 Execute 完成处等待用户提示。

 ## 源代码格式化

 - 每次写入或修改源代码后，先识别项目约定的 formatter 和格式化命令；优先使用项目已有的 \`format\`/\`format:check\` 脚本、Maven/Gradle formatter 或仓库文档指定的命令。
 - 格式化范围只覆盖本次实际修改的文件；不得为了格式化重排无关文件或引入无关 diff。
 - 格式化前后都要重新读取关键修改区域，确认 import、注解、声明、方法、控制流和类结构按项目风格正常换行；不得为了减少输出把多条语句、多个 import 或整个方法压缩到同一行。
 - 如果项目没有 formatter、formatter 不可用或执行失败，不得假称已完成格式化：记录具体命令、错误和残余风险，并至少执行可用的静态检查或人工结构检查。
 - 完成任务前必须把格式化/格式检查结果作为验证证据；格式化失败导致代码难以审查时，应将任务标记为未完成并返回修复，而不是直接进入 Review。

 ## 浏览器验证（browser_verify，前端任务门控）

仅当 Intake 执行配置 \`browser_verify=on\` 且任务属 \`frontend_scope\`（ui-pixel / ui-standard / interaction）时适用；off、not_asked 或能力不可用时本节全部跳过，执行行为与无本节完全一致。**进入本节任何操作前先加载 agent-browser skill**——命令映射、能力探测、安装引导与降级口径的唯一来源；skill 内容不会自动注入上下文，本节引用不承载完整协议，未加载前不得凭记忆或臆造执行 agent-browser 命令。

- **designer 视觉短反馈**：designer（lane:fe-ui）每完成一个视觉任务，立即按 agent-browser skill 启动/复用 dev server 并取得渲染截图，交 observer（复用会话）快速核对；token 级核对（\`get styles\`/\`get box\` 数值 JSON）由主 agent 直接消费，无需 observer。发现偏差当轮修正，不等 Review——这是 browser_verify 对 UI 还原效率的主要杠杆。designer 是独立 subagent 会话、不继承主会话已加载的 skill 内容，委派 prompt 必须显式包含"执行浏览器验证前先加载 agent-browser skill"指令及 browser_verify 配置上下文，否则其无从获知命令映射与降级口径。
- **real-surface 取证**：涉渲染表面的任务完成时，浏览器验证产物（渲染截图、get styles/get box 数值、交互断言输出、console/errors 摘要）作为该任务 real-surface 证据，按 evidence tier 记录命令、退出码与 git state 绑定；浏览器验证是 real-surface 的补充，不替代单元测试/typecheck。
- **修复循环预算**：视觉修正 ≤3 轮（对齐 clipboard-image-observer 的 L5 闭环）；第 3 轮仍 FAIL 按既有 3 轮中断上报模板处理，不无限重试。
- **fail-open**：agent-browser 不可用、命令失败或 dev server 起不来时，降级为人工截图/手工 QA 口径，记录 \`browser_verify: degraded (<原因>)\`；不阻塞任务、不伪称已做浏览器验证。

## TDD 与测试纪律

### TDD 开启

对每个可测试行为执行 RED → GREEN → REFACTOR：先写最小失败测试并确认失败原因正确，再写最小实现使其通过，最后在保持绿色的前提下重构。一次只处理一个行为，不用宽泛集成测试替代关键边界测试。

### TDD 关闭

不伪称存在 RED 证据。修改已有行为前先写 characterization test 固定现状；然后实现变更，运行回归测试和适用的真实表面验证。纯格式、注释、重命名等白名单变更可跳过测试先行，但必须记录理由与验证。

### 测试失败处理

失败时加载 oceanus-debugging：阅读完整输出 → 稳定复现 → 找根因 → 用单一假设做最小实验 → 修复 → 复跑原始失败与回归集。每轮必须记录假设和证据；第 3 轮仍失败时停止自动修复并用 question 上报，不换补丁继续碰运气。

## 收到实现建议或审查反馈

对用户、@oracle、@explorer 或代码审查者的建议，先完整阅读并用当前代码、接口、测试和 diff 验证；再判断是否适用于本仓库。逐项处理：复述技术要求 → 核实证据 → 说明接受或反驳理由 → 实现一项 → 运行该项验证。不得因为反馈来自专家就直接照单全收。

## 检查点与恢复

- 中断前（用户暂停、上下文接近上限、长任务切换）：把当前状态写入 ledger/todo——当前任务与状态、已取得的验证证据、下一动作和 \`stopped_at\` 时间戳；SDD 关闭时在会话内 \`todo\` 同步等价信息。
- 恢复时不依赖对话记忆：先读 ledger/todo 与计划，从第一个未终态任务继续；旧证据对应状态已变时先重新验证再续作。
- SDD 开启时 ledger 头部维护 frontmatter 摘要并在每次任务终态后同步：current_phase / next_action / progress（已完成/总任务数）/ state_head（当前 git HEAD 短 sha）/ stopped_at。该摘要是导航层，不是任务明细的替代。

## 当前目录执行

所有实现工作（主 agent 与逃生舱 @fixer worker）始终使用当前目录。执行委派仅限逃生舱场景（三条件：文件集完全不相交 + 改动机械同构 + 任务数 ≥3），此时同一批次内声明的 \`Files\` 完全不重叠、没有共享状态、资源或生成目录交互；只读调研并行无文件所有权要求。Worker 不得运行 \`git add\`、\`git commit\`、\`git reset\`、分支或隔离工作区操作，也不得编辑其声明的 \`Files\` 之外的内容。

## 计划变更与重新规划

普通执行不重复调用 Oracle；复杂架构或高风险场景可按需请求 @oracle(analysis/consult) 建议，建议不阻断执行。

1. **根据变更类型安排重新规划** — 需求或验收标准变化 → 返回 discuss/Plan，重新确认并修订 spec/plan；结构性 Files、依赖或任务变化 → 返回 Plan 并重新自查；失败重规划同样只需修订并自查。
2. 重新规划后只要计划自查完成即可恢复执行；不生成或等待 Oracle 门禁结果。

## 失败优先纪律

将此规则应用于每项具有测试切入点的代码变更；它把“先写测试”从意图变成强制执行规则。**组合优先级**：本节与执行证据等级中的 strict 档同时适用时，按下方组合矩阵执行——TDD 开关决定 RED 是否可得，tier 决定证据下限；任何组合下都不得伪称证据。

**TDD × Evidence Tier 组合矩阵**：
- **strict + TDD on**：同一变更状态上的 RED + GREEN + real-surface（现状不变）。
- **strict + TDD off**（用户在执行配置批问中关闭 TDD）：行为变更必须先写 characterization test 固定现有行为作为基线证据，再实现；完成以绑定最终 diff 状态的 GREEN + real-surface 两份证明判定，**不得伪称存在 RED 证据**。
- **light / exempt**：按各档既有规则执行。

1. **RED → GREEN → SURFACE** — 对每项实现变更（TDD off 时按矩阵改为：基线 → 实现 → GREEN → SURFACE）：
   - RED：先编写并运行失败测试，记录失败输出。
   - GREEN：持续实现直到测试通过，并记录通过输出。
     - SURFACE：使用真实表面（CLI 输出、实时 endpoint、手工 QA、构建制品）进行验证，而不只是通过测试。
2. **变更前固定现有行为** — 修改现有行为前，先编写捕获当前行为的 characterization test，然后再修改。
3. **禁止先写生产代码**（仅 TDD on 时适用）— 如果已经先写了生产代码而不是测试：停止、回退、编写测试并重做。TDD off 时本条不触发回退义务，但行为变更的 characterization 基线义务仍然适用。
4. **每个场景完成需要两份证明** — 一份代码证明（TDD on：同一测试的 RED 输出 + GREEN 输出；TDD off：characterization 基线 + 最终状态 GREEN）加上一份真实表面制品。仅测试通过不能使任务完成。
5. **豁免白名单**（可以跳过 RED→GREEN，但要在 Findings/ledger 中记录理由）— 纯格式、纯注释、无行为变化的依赖升级、纯重命名。

## 执行证据等级

每个任务在进入终态前必须声明且执行一个 evidence tier；不能以证据档位替代计划自查和验收证据。

1. **strict**（默认用于公共符号、接口、路由、配置契约或其它高风险变更）：必须同时记录同一变更状态上的 \`RED\`、\`GREEN\` 与 \`real-surface\` 证据；TDD off 时按 Failing-First 组合矩阵以 characterization 基线替代 RED，禁止伪称 RED。real-surface 必须来自 CLI 输出、live endpoint、手工 QA 或构建制品，而不是测试通过的复述。
2. **light**（低风险且不触及公共符号）：允许 \`test-after\`，但仍必须运行并记录测试结果；不得伪称存在 RED 或 real-surface 证据。
3. **exempt**：只限白名单中的纯格式、纯注释、无行为变化的依赖升级或纯重命名；必须在 Findings/ledger 写明具体白名单项与跳过理由，仍需记录可审计的验证结果。

证据必须绑定时间点与当前代码状态（优先 git state、提交或等价快照）。缺失任一 tier 要求，或证据对应的代码状态已改变而变 stale，任务保持未完成并退回补证；不得复用旧输出。发现公共符号或高风险影响时，必须升级为 strict，并在继续执行前补齐 strict 证据。

## 检查清单
- [ ] 已按 plan 任务顺序执行：依赖未终态时先完成前置任务，不跳序
- [ ] 每个任务由主 agent 直接实现（读代码、编辑、测试）；上下文缺口已委派 @explorer 补侦察，而非自行全量扫库
- [ ] 高风险修改前已完成 CBM 符号定位与调用链/影响面追踪（按 CBM 检索顺序，唯一健康 project 已确认）或 @oracle(consult)；大输入已隔离（@librarian/@observer/输出截断）
- [ ] 逃生舱拆分仅在「文件集完全不相交 + 改动机械同构 + 任务数 ≥3」三条件同时满足时发生，且每个 @fixer 任务使用不同 lane marker、依赖任务已等待终态结果
- [ ] 已核验并整合全部结果、解决冲突
- [ ] SDD 模式：ledger 在任务开工前与每任务终态后更新；非 SDD：todo 与任务状态一致
- [ ] Todo 列表与任务状态一致
- [ ] 已应用失败优先：每项变更都记录 RED→GREEN，且变更前已固定现有行为
- [ ] 每个场景都有两份证明：代码证明（TDD on：RED+GREEN；TDD off：characterization 基线 + 最终状态 GREEN）和真实表面制品
- [ ] 已声明执行证据等级：strict=RED+GREEN+real-surface，light=test-after+测试，exempt=白名单+理由
- [ ] 证据完整且绑定当前状态；缺失或过时不得通过，公共符号/高风险变更已升级 strict
- [ ] 修复/重试循环 ≤3 轮，第 3 轮失败停止自动重试并按 3 轮中断上报模板用 \`question\` 上报用户
- [ ] 所有工作均在当前目录执行；逃生舱 workers 仅使用已声明且不重叠的 \`Files\`，不执行 git、分支或隔离工作区操作
 - [ ] 实质性变更按类型返回 discuss/Plan 或 Plan，并完成相应自查

## 规则
- 默认主 agent 自己执行；执行委派仅限逃生舱三条件（文件集完全不相交 + 改动机械同构 + 任务数 ≥3）同时满足时的批量 @fixer 并行，使用真实的 background 参数：\`subagent({ agent, description, prompt, background: true })\`，每个任务的 description 使用不同 lane marker。
- 只读调研（@explorer/@librarian/@oracle 场景/@observer）可在同一轮并行派发，无文件所有权要求；调研委派使用调研简报。
- 被拒绝后绝不将未改变的任务再次派给同一 specialist；先调整范围或上下文。
- **修复循环上限统一 3 轮**：单个任务的失败修复/重派遣最多 3 轮；第 3 轮仍失败则标记 blocked 并停止自动重试，按 3 轮中断上报模板用 \`question\` 上报。
- **探索性尝试循环上限**：同一目标的探索性尝试（环境/实例启动、隔离环境搭建、绕行 workaround、探测性命令）连续失败达 3 次必须停止换路：回到 plan 重估前提，或按 3 轮中断上报模板上报（模板须含推荐项及理由）；不得无限换姿势重试。
- 仅当写入范围不冲突时，才允许并行后台任务；并行 workers 不得写入共享 progress ledger，主 agent 串行更新 ledger，避免任务记录相互覆盖。
- **CBM 边界**：高风险公共符号修改前先按 codebase-memory-mcp 优先规则做 search → trace/impact（direct MCP 优先、cbm_* wrapper 兜底）。Cypher 仍用 cbm_query。普通机械修改不强制查询；修改后影响面由 Review 阶段复查。
- 逃生舱 workers 不得运行 \`git add\`/\`commit\`/\`reset\`、分支或隔离工作区操作，也不得编辑其声明的 \`Files\` 之外的文件。
- 遵循上面的失败优先纪律；除非变更符合豁免白名单且已记录理由，否则不得跳过 RED→GREEN。
- 仅凭测试通过绝不声称任务完成；必须提供真实表面制品。
- Plan-Change 后：需求或验收标准变化回 discuss/Plan；结构性变更回 Plan 自查。按需 Oracle 建议始终不阻断执行。
`,
};

export { OCEANUS_EXECUTE_SKILL };
