import type { SkillDefinition } from './types';

const OCEANUS_EXECUTE_SKILL: SkillDefinition = {
  name: 'oceanus-execute',
  description:
    'Sisyphus 工作流第 4 阶段——执行。主 agent 按 plan 顺序直接实现任务（读代码、编辑、测试），逐任务验证并更新 ledger/todo；上下文缺口委派 @explorer 补侦察，仅逃生舱三条件满足时才拆 @fixer 并行。',
  slash: true,
  content: `---
name: oceanus-execute
input: oracle plan-gate OKAY（或 SKIPPED_BY_USER 记录）的 plan
owner: Sisyphus 主 Agent（默认直接实现；@fixer 仅逃生舱场景并行，只持有显式分配的文件范围）
output: 实现与证据
entry: plan 放行
exit: 任务终态
failure: 标记失败并重规划
verification: 测试与 ledger
humanReview: conditional
description: Sisyphus 工作流第 4 阶段——执行。主 agent 按 plan 顺序直接实现任务（读代码、编辑、测试），逐任务验证并更新 ledger/todo；上下文缺口委派 @explorer 补侦察，仅逃生舱三条件满足时才拆 @fixer 并行。
---

# Sisyphus 第 4 阶段 — 执行

## 目标
Sisyphus 主 Agent 持有计划、实现、ledger 与验收上下文；默认自己执行全部实现工作，仅将调研、隔离与逃生舱批量机械任务条件委派。

可靠地执行计划：按计划顺序直接实现，逐任务验证并完整跟踪。

## 无上下文执行协议
执行者不得依赖聊天历史：先读取唯一 Spec 与 Plan，再核对当前 Task 的 Task ID、Goal/Context、Files、Interfaces、Dependencies、Preconditions、checkbox、Validation/Expected、Acceptance、风险与状态字段。缺少任一字段或 Spec 未绑定时立即阻塞并返回父 agent，不自行猜测。每一步记录命令、预期结果与实际结果；只修改声明的 Files。完成时输出实现摘要、验证证据（含实际输出/状态）、实际 diff 行数与剩余风险。
## 步骤
1. **加载计划与 ledger** — SDD 开启时从 \`.oceanus/plan/\` 与 \`.oceanus/progress/<plan-name>.md\` 加载；SDD 关闭时使用会话内计划与 todo。按 plan 任务顺序取下一个任务；其依赖未达终态时先完成前置任务，不跳序。
2. **主 agent 直接实现** — 按 plan 任务顺序逐个由主 agent 自己实现：读代码、编辑、运行测试、修复。动手前检查上下文缺口：缺口 → 委派 @explorer 补侦察（调研简报：附检索范围与返回格式），拿到浓缩事实再动手，禁止自己全量扫库重建认知。只读调研（@explorer/@librarian/@oracle 场景/@observer）相互独立时可在同一轮并行派发，不占用写入面、不参与文件所有权计算。
3. **高风险与大输入处理** — 高风险公共符号、接口或配置契约修改前 → 先做 cbm_trace 或委派 @oracle(consult) 咨询影响面与方案；网页/外部文档 → @librarian，图像/PDF → @observer，预期超过 ~2000 行的命令输出 → shell 管道截断或委派 @explorer。
4. **任务开工前更新（SDD 模式）** — SDD 开启时，任务开工前把该任务 ledger 行从 \`pending\` 更新为 \`in_progress\`（含执行者与时间戳），ledger 由主 agent 串行写入。SDD 关闭时用 \`todowrite\` 同步 todo 即可，不写文件。绝不要因为更新 progress-ledger 而中断或推迟当前任务。
5. **每个任务完成即验证并更新** — 任一任务完成后，立即运行或核验其声明的验证（typecheck/test/适用时真实表面验证），然后记录 \`completed\`/\`failed\`/\`blocked\`（SDD 模式写入 ledger 行，含证据、时间戳、备注；非 SDD 更新 todo）。同时记录该任务**实际实现代码 diff 行数**（git diff --stat 或等价方式，测试代码不计入），与 plan 预估行数一并写入备注，供 review 对比。
6. **执行委派逃生舱（唯一并行执行例外）** — 仅当「文件集完全不相交 + 改动机械同构 + 任务数 ≥3」三条件同时满足时，才把该批量任务拆给多个 @fixer 并行：在同一轮发起多个独立的 \`subagent({ agent, description, prompt, background: true })\` 调用（每个任务的 description 中都要有 lane marker），依赖任务等待其终态结果，返回后由主 agent 核验其声明的验证再记终态。三条件任一不满足时不得拆分，一律主 agent 自己实现。
7. **同步 todo 列表** — 保持内存中的 todo 与 ledger（SDD 模式）一致：将 plan 任务登记为 \`pending\`，任务开工时将当前任务标记为 \`in_progress\`，仅在获得终态结果和验证证据后将其标记为 \`completed\`/\`failed\`/\`blocked\`。

## 当前目录执行

所有实现工作（主 agent 与逃生舱 @fixer worker）始终使用当前目录。执行委派仅限逃生舱场景（三条件：文件集完全不相交 + 改动机械同构 + 任务数 ≥3），此时同一批次内声明的 \`Files\` 完全不重叠、没有共享状态、资源或生成目录交互；只读调研并行无文件所有权要求。Worker 不得运行 \`git add\`、\`git commit\`、\`git reset\`、分支或隔离工作区操作，也不得编辑其声明的 \`Files\` 之外的内容。

## 计划变更与重新规划门禁

普通执行不会在每个任务上重复调用 @oracle(analysis) 或 @oracle(plan-gate)；仅当 plan 本身必须变更时才会触发。

1. **根据变更类型安排重新规划** — 需求或验收标准变化 → 配置批问与方案总批准一并失效、重新执行两问：暂停并先重新运行 @oracle(analysis)，分析新需求、风险、边界、反例与标准（Oracle 门禁审核=开时；关闭时跳过并记录）；然后返回 plan、修订它，并重新调用 @oracle(plan-gate)（开启时）与 human \`question\`。仅 Files/依赖/任务结构变化或失败重规划 → 不重新提问用户，仅重走 oracle 门禁（仅 Oracle 门禁审核=开时）：直接返回 plan、修订它，并重新运行 @oracle(plan-gate)，不要不必要地重复 @oracle(analysis)。
2. **只有 oracle plan-gate OKAY 才能继续执行** — 任何重新规划后，修订后的 plan 必须通过 @oracle(plan-gate) review（计入 oracle 门禁 3 轮上限）。只有 oracle plan-gate 返回 OKAY 才能恢复执行；REJECT 表示继续修订，而不是执行。第 3 轮仍 REJECT 时停止自动重试，按 3 轮中断上报模板用 \`question\` 上报（模板须含推荐项及理由）。
3. **绝不伪造门禁** — 不得臆造或伪造门禁结果。如果修订后的 plan 实际未运行 @oracle(plan-gate)，应如实记录，不得声称其已通过。

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

每个任务在进入终态前必须声明且执行一个 evidence tier；Execute 仍必须具备有效方案总批准，Oracle 门禁审核=开时另需实际的 oracle plan-gate \`OKAY\`（关闭时以 plan status 的 SKIPPED_BY_USER 记录为准），不能以证据档位替代任一门禁。

1. **strict**（默认用于公共符号、接口、路由、配置契约或其它高风险变更）：必须同时记录同一变更状态上的 \`RED\`、\`GREEN\` 与 \`real-surface\` 证据；TDD off 时按 Failing-First 组合矩阵以 characterization 基线替代 RED，禁止伪称 RED。real-surface 必须来自 CLI 输出、live endpoint、手工 QA 或构建制品，而不是测试通过的复述。
2. **light**（低风险且不触及公共符号）：允许 \`test-after\`，但仍必须运行并记录测试结果；不得伪称存在 RED 或 real-surface 证据。
3. **exempt**：只限白名单中的纯格式、纯注释、无行为变化的依赖升级或纯重命名；必须在 Findings/ledger 写明具体白名单项与跳过理由，仍需记录可审计的验证结果。

证据必须绑定时间点与当前代码状态（优先 git state、提交或等价快照）。缺失任一 tier 要求，或证据对应的代码状态已改变而变 stale，任务保持未完成并退回补证；不得复用旧输出。发现公共符号或高风险影响时，必须升级为 strict，并在继续执行前补齐 strict 证据。

## 检查清单
- [ ] 已按 plan 任务顺序执行：依赖未终态时先完成前置任务，不跳序
- [ ] 每个任务由主 agent 直接实现（读代码、编辑、测试）；上下文缺口已委派 @explorer 补侦察，而非自行全量扫库
- [ ] 高风险修改前已完成 cbm_trace 或 @oracle(consult) 咨询；大输入已隔离（@librarian/@observer/输出截断）
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
- [ ] 实质性变更（需求/Files/依赖/验收）或重新规划均已返回 plan，并在继续前重新通过 @oracle(plan-gate)

## 规则
- 默认主 agent 自己执行；执行委派仅限逃生舱三条件（文件集完全不相交 + 改动机械同构 + 任务数 ≥3）同时满足时的批量 @fixer 并行，使用真实的 background 参数：\`subagent({ agent, description, prompt, background: true })\`，每个任务的 description 使用不同 lane marker。
- 只读调研（@explorer/@librarian/@oracle 场景/@observer）可在同一轮并行派发，无文件所有权要求；调研委派使用调研简报。
- 被拒绝后绝不将未改变的任务再次派给同一 specialist；先调整范围或上下文。
- **修复循环上限统一 3 轮**：单个任务的失败修复/重派遣最多 3 轮；第 3 轮仍失败则标记 blocked 并停止自动重试，按 3 轮中断上报模板用 \`question\` 上报。
- **探索性尝试循环上限**：同一目标的探索性尝试（环境/实例启动、隔离环境搭建、绕行 workaround、探测性命令）连续失败达 3 次必须停止换路：回到 plan 重估前提，或按 3 轮中断上报模板上报（模板须含推荐项及理由）；不得无限换姿势重试。
- 仅当写入范围不冲突时，才允许并行后台任务；并行 workers 不得写入共享 progress ledger，主 agent 串行更新 ledger，避免任务记录相互覆盖。
- **CBM 边界**：高风险公共符号修改前先做 trace/impact（cbm_trace / cbm_query 分析影响面）；普通机械修改不强制查询；修改后影响面由 Review 阶段复查。
- 逃生舱 workers 不得运行 \`git add\`/\`commit\`/\`reset\`、分支或隔离工作区操作，也不得编辑其声明的 \`Files\` 之外的文件。
- 遵循上面的失败优先纪律；除非变更符合豁免白名单且已记录理由，否则不得跳过 RED→GREEN。
- 仅凭测试通过绝不声称任务完成；必须提供真实表面制品。
- 需求或验收变更须在修订 plan 前重新运行 @oracle(analysis)；Files/依赖/任务结构变更和失败重规划可以直接返回 plan。每个修订后的 plan 都必须在继续前通过实际的 @oracle(plan-gate) OKAY。
- Plan-Change 后：需求或验收标准变化 → 旧的 oracle plan-gate \`OKAY\` 与配置批问/方案总批准均失效，重新执行两问并重走 oracle 门禁（开启时）后才可恢复 Execute；仅 Files/依赖/任务结构变化或失败重规划 → 两问不失效、不重新提问，仅重走 @oracle(plan-gate)（Oracle 门禁审核=开时）。
`,
};

export { OCEANUS_EXECUTE_SKILL };
