# Plan：实现 Sisyphus Intake 阶段并刷新 Review 前 CBM 索引

## 状态

- TDD：严格 RED → GREEN → SURFACE
- Worktree：当前共享工作区
- 计划审查：待 @momus（四次审查）
- CBM 计划阶段初始化：`cbm_status` 因活动 daemon 使用不同 cache directory 失败；按 fail-open 记录
- CBM 重建方案：阶段直接调用现有 `cbm_index`（底层 `index_repository`），不改索引器缓存 API

## 任务图

### Wave 1：RED 测试

#### T1：补充阶段、权限和 CBM 工具契约测试

- Files：`src/skills/stages.test.ts`、`src/agents/index.test.ts`、`src/agents/cbm-usage.test.ts`、`src/tools/cbm/builders.test.ts`
- Depends on：无
- Worker：待分配
- Goal：先补明确的失败断言：Intake 位于 Skill 列表最前且非空；Agent 为六阶段顺序；Intake 含五项职责；Brainstorm/Plan 不初始化而 Review 含前置 `cbm_index`；Metis 默认允许而其他只读 Agent 默认显式拒绝 `cbm_index`；builder 映射到 `index_repository`；复杂任务复用 Intake 报告而不重复初始化
- Validation：先运行 `bun test src/skills/stages.test.ts src/agents/index.test.ts src/agents/cbm-usage.test.ts src/tools/cbm/builders.test.ts` 记录基线；再运行同一命令并逐项记录预期失败：阶段顺序、Intake职责、Brainstorm/Plan边界、Review前置、权限矩阵、builder映射；每项绑定对应生产文件。失败/in-progress、非代码/混合任务属于 Prompt 契约或工具结果降级测试，不声称验证 Agent 实际调用

### Wave 2：实现

#### T2：新增并注册 Intake Skill

- Files：`src/skills/sisyphus-intake.ts`、`src/skills/index.ts`
- Depends on：T1
- Worker：待分配
- Goal：新增 `sisyphus-intake`，明确由 Sisyphus 主 Agent 完成背景、最小需求 intake、任务分类、代码任务直接 `cbm_index` 和结果交接；`@metis` 不承担 Intake
- Validation：Skill 注册、唯一性、内容非空和职责契约 GREEN

#### T3：更新 Sisyphus 主 Agent 阶段顺序和全局门禁

- Files：`src/agents/sisyphus.ts`、`src/agents/oceanus.ts`
- Depends on：T1
- Worker：待分配
- Goal：改为六阶段；删除旧的“主 Agent 在 brainstorm/plan 前初始化 CBM”规则并迁移到 Intake；保留文本/AST/glob/Web fallback、子 Agent 不重复和查询型工具规则；Intake 由 Metis 执行；Brainstorm/Plan 的后续 Metis 调用只做方案分析并复用 Intake 报告；Plan 不初始化；Review 开始先直接 `cbm_index`；保持 metis/momus 门禁
- Validation：Agent prompt 契约分别断言六阶段顺序、旧初始化规则移除、Metis 复用和 CBM 边界，全部 GREEN

#### T4：更新原有阶段 Skill 编号和 CBM 边界

- Files：`src/skills/sisyphus-brainstorm.ts`、`src/skills/sisyphus-plan.ts`、`src/skills/sisyphus-execute.ts`、`src/skills/sisyphus-review.ts`
- Depends on：T1
- Worker：待分配
- Goal：Brainstorm/Plan 消费 Intake 且不初始化；Execute 顺延为 Phase 4；Review 顺延为 Phase 5 并在开始时直接 `cbm_index`
- Validation：阶段 Skill 契约测试 GREEN，确认初始化只出现在 Intake/Review

#### T5：更新 Metis Intake 输出和专用权限

> 已被 `sisyphus-context-priority` 设计取代：当前 Intake 由 Sisyphus 执行，Metis 不再承担 `INTAKE`。

- Files：`src/agents/metis.ts`、`src/config/constants.ts`、`src/agents/index.ts`
- Depends on：T1、T2
- Worker：待分配
- Goal：Metis 通过 prompt 接收显式 `MODE: INTAKE` 或 `MODE: SOLUTION_ANALYSIS`；INTAKE 输入为用户原始需求和工作区上下文，输出固定字段 `intake_report`（background、requirements、task_type、cbm_result、risks、unknowns、brainstorm_context）；SOLUTION_ANALYSIS 输入必须包含该 `intake_report`，仅输出风险/边界/反例/验收，不重复 Intake/CBM。默认权限仅 Metis `cbm_index: allow`，explorer/librarian/oracle/observer/momus 五个其他只读 Agent 显式 `cbm_index: deny`，查询型 CBM 保留；源码写入、shell、task 委派 deny。显式用户权限按现有规则生效
- Validation：权限矩阵测试逐项 GREEN：Metis 默认 allow、五个其他只读 Agent 默认 deny、Metis 显式 deny、其他 Agent 显式 allow；同时断言 Metis 的 `task` 和兼容键 `subagent`、shell/write 操作 deny；prompt 测试断言两种 MODE、固定字段、输入交接和禁止重复

### Wave 3：文档与构建校准

#### T6：同步文档、旧规范和 dist 校验脚本

- Files：`README.md`、`docs/codebase-memory-mcp.md`、`docs/three-way-capability-comparison.md`、`docs/openagent-orchestration-review.md`、`.oceanus/spec/cbm-index-init-relocation.md`、`.oceanus/spec/sisyphus-stage-agent-integration.md`、`.oceanus/spec/agent-supervision-and-review.md`、`.oceanus/spec/cbm-agent-usage-and-intent-gate.md`、`.oceanus/spec/codebase-memory-mcp-integration.md`、`src/index.ts`、`scripts/verify-dist-skills.ts`
- Depends on：T2、T3、T4、T5
- Worker：待分配
- Goal：同步六阶段、Intake 责任、Review 重建语义；旧规范统一增加“已被 `.oceanus/spec/sisyphus-intake-stage.md` superseded，以该文件为当前权威”标记，历史 progress/plan 仅作记录不参与有效规则；更新注册注释；验证脚本捕获 Skill 注册对象和 Agent system prompt
- Validation：当前有效入口无旧阶段边界残留，历史记录明确排除；脚本按名称检查 `sisyphus-intake`、`sisyphus-brainstorm`、`sisyphus-plan`、`sisyphus-execute`、`sisyphus-review`（排除 `opencode-oceanus`），并检查 Intake 锚点、六阶段顺序和 Review `cbm_index` 前置锚点；fake agent draft 保存 `update` 输入，任一锚点失败即 exit(1)，不宣称验证 Agent 实际调用顺序

#### T7：构建、全量验证与真实产物检查

- Files：`dist/**`（构建生成，dist 已被 gitignore 忽略，不作为源码提交范围）
- Depends on：T1、T2、T3、T4、T5、T6
- Worker：主 Sisyphus 串行执行
- Goal：构建插件并检查临时 dist 中的新 Skill、六阶段 prompt 和 Review `cbm_index` 规则
- Validation：相关测试、`bun test`、类型检查、构建、`bun scripts/verify-dist-skills.ts`；记录 GREEN 和 SURFACE 证据

#### T8：运行时 CBM 调用顺序审计

- Files：无源码文件；仅写入 ledger
- Depends on：T7
- Worker：主 Sisyphus 串行执行
- Goal：在可用 OpenCode 宿主会话中检查事件日志：Intake 期间存在 `tool` 事件 `name=cbm_index` 且 caller/session 为 Metis；Review 查询事件之前存在新的 `name=cbm_index` 事件；失败/in-progress 后存在降级记录且阶段继续。若宿主无可用事件日志，ledger 明确记录不可验证原因，不用 Metis 报告文本或静态测试替代实际调用证据
- Validation：ledger 记录审计时间、会话/日志路径、三类事件判据结果或不可用原因

## 执行约束

- 共享工作区下每个 Worker 只修改声明的 Files，不运行 git、分支或 Worktree 操作。
- T1 必须先完成 RED；T2–T5 只能在 T1 RED 后开始；之后执行 GREEN。
- 每个任务派发前 ledger 更新为 `in_progress`，终态验证后更新为 `completed`/`failed`/`blocked`。
- Intake 和 Review 使用现有 `cbm_index` 直接触发 `index_repository`；查询型索引器缓存不作为 Review 刷新机制。
- CBM 不可用、失败、超时或进行中时 fail-open，不能伪造索引成功。
- 计划若需改变需求或验收标准，先回到 Metis，再修订计划并重新通过 Momus。

## 验收矩阵

| Criterion | Evidence owner | Evidence |
|---|---|---|
| 六阶段顺序 | T1/T3/T6/T7 | 源码测试、dist prompt 捕获 |
| Intake 五项职责和 Metis 双模式 | T1/T2/T5/T7 | Skill/Agent 契约测试和 dist 捕获 |
| 代码/非代码/混合任务分类 | T1/T2 | Prompt 分支断言；实际顺序由 T8 审计 |
| Intake 直接 cbm_index | T1/T2/T8 | builder 映射、Prompt 契约、运行时审计 |
| Plan 不初始化 | T1/T4/T6 | 负向断言和有效文档扫描 |
| Review 前刷新索引 | T1/T4/T6/T7/T8 | 顺序锚点、dist 捕获、运行时审计 |
| CBM 失败/in-progress fail-open | T1/T2/T8 | 工具结果测试、降级契约、审计记录 |
| Metis 最小权限 | T1/T5 | 六 Agent 默认矩阵及显式覆盖测试 |
| 构建产物可加载 | T7 | build、全量测试、verify-dist-skills |

## 方案审查记录

- Momus verdict：待四次审查
- Issues：三次审查后补齐 Oceanus 旧规则、冲突 spec、逐项 RED/运行时契约边界、权限覆盖语义和 dist 捕获方式
- Revision round：3
- Verification timestamp：待审查
