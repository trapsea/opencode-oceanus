import { PLAN_ACCEPTANCE_RUBRIC } from '../agents/protocol';
import type { SkillDefinition } from './types';

const OCEANUS_PLAN_SKILL: SkillDefinition = {
  name: 'oceanus-plan',
  category: 'phase',
  description: '第 3 阶段 — 计划：读取已批准 spec，映射文件结构、拆分细粒度任务（含真实代码与逐步验证）、维护 ledger 并完成计划自查；复杂架构可按需请求 Oracle advisory。',
  slash: true,
  content: `---
name: oceanus-plan
category: phase
input: 已批准 spec
owner: Sisyphus 主 Agent（复杂架构场景可按需咨询 Oracle）
output: plan 与 impact_estimate
entry: spec 已批准
exit: 计划自查完成
failure: 记录缺口并修订计划
verification: 计划状态可审计
humanReview: required
description: 第 3 阶段 — 计划：读取已批准 spec，映射文件结构、拆分细粒度任务（含真实代码与逐步验证）、维护 ledger 并完成计划自查；复杂架构可按需请求 Oracle advisory。
---

# Sisyphus 第 3 阶段 — 计划

## 阶段入口：回收后台调研

进入任何 Plan 工作前，先检查当前任务登记的后台 Explorer/Oracle child session。对每个会影响本阶段的 session 使用宿主会话等待能力（OpenCode v2 优先使用 \`session.wait({ sessionID })\`），并回收成功、失败或阻塞结果；不要仅依据完成通知放行。等待或结果回收失败时，保持本阶段 \`pending\`/\`blocked\`，报告缺失结果后停止，不得消费不完整调研或伪造结论。没有相关后台调研时记录 \`not_applicable\`。

## 目标

把已批准 spec 转化为一份**零上下文可执行**的实现计划：假设执行者完全没有本仓库上下文，只读自己的 Task 就能动手。每个任务包含确切文件路径与行号、真实代码块、逐步 checkbox 和带预期输出的验证命令。

## 步骤

1. 读取 Intake 与已批准 spec，保留目标、范围、验收标准、风险、约束和决策。
2. **范围检查**：spec 覆盖多个独立子系统时，建议按子系统拆成多份 plan；每份 plan 独立交付可工作、可验证的软件。
3. **调研深度分级**：按风险确定计划前的补充调研量——**L0 跳过**（纯内部工作、grep 证实全部沿用既有模式、无新依赖）；**L1 快速验证**（单一已知库，确认语法/版本即可）；**L2 标准调研**（2-3 个候选选型、新外部集成，两波内收敛）；**L3 深潜**（架构级长期影响、全新领域，委派 @librarian/@explorer 并允许更长周期）。升级指标：出现新库/外部 API/"选型评估"字样至少 L2；涉及"架构/系统设计"、多外部服务、数据建模至少 L3。分级和理由记入 plan 头部。
4. **文件结构先行**：定义任务前先映射文件——创建/修改哪些文件、各文件职责、模块边界与接口。按职责而非技术层拆分；变更耦合的文件放同一任务。已有代码库遵循既有模式，不擅自重构；但被修改的文件已过度膨胀时，可把拆分纳入计划。
5. **任务切分**：
   - 任务是携带独立测试周期的最小单元，每个任务结束于一个可独立验证的交付物。
   - **Tracer-First 垂直切片**：首个任务默认为 tracer——穿过本轮要修改的每一层的最薄端到端路径，带真实可运行的单路径验证（端到端检查而非分层单测）。tracer 是生产质量不是原型：功能缺口允许 stub，架构缺口不允许。其余任务是在已验证切片上的横向扩展；只"打地基"而不交付用户可感知能力的任务要重排。架构已被先前工作证明时可不设 tracer，但须记录理由。
   - 搭建、配置、脚手架、文档步骤折叠进需要它的交付任务，不单独立任务。
   - 只有"审阅者可能拒绝 A 任务而批准相邻 B 任务"时才拆分。
   - 任务按依赖排序，依赖无环；建议每任务 ≤5 文件，超出即考虑再拆。
6. **步骤粒度（极细）**：每个任务内逐步 checkbox，一步一个动作（2-5 分钟可完成）；代码步骤必须附带真实代码块。
7. SDD 开启时初始化 progress ledger 并把计划保存到 \`.oceanus/plan/\`；关闭时使用会话内 todo（结构不变）。ledger 头部初始化 frontmatter 摘要：current_phase / next_action / progress（0/N）/ state_head（计划时点的 git HEAD 短 sha）/ stopped_at（null），供跨会话恢复与证据状态核验。
8. 按下列 rubric 与自审清单完成计划自查，缺口当场补齐：
   ${PLAN_ACCEPTANCE_RUBRIC.split('\\n').filter((l) => l.trim().length > 0).join('\\n   ')}
   - 依赖顺序无环且满足前置条件。
   - Files 范围在所有权内且无冲突。
   - 每个任务有可测试成功标准和验证证据。
   - 影响面使用 CBM/grep/read 自查，记录受影响符号与差异到 impact_estimate，供 Review 复查；工具不可用时标注不确定性。
   - **关键字段 schema 门禁**：校验 requirements_context、assumptions、edge_coverage、truths、prohibitions、D-ID 和每条任务的 acceptance/validation。缺失关键字段、非法状态、无证据假设或无 required_property 的 finding 一律 fail-closed；非关键扩展字段可记录 WARNING。
   - **独立 Oracle advisory**：Standard 仅在存在架构取舍、复杂影响面或高代价错误风险时调用 Oracle analysis；Architecture 默认评估是否需要调用。调用时必须提供完整 Oracle Brief，并要求其只返回结构化 findings（dimension、severity、required_property、description、evidence、fix_hint），不返回放行 verdict。主 Agent 必须核实每条 finding，并保留最终门禁责任。
   - **三轮修订闭环**：发现 BLOCKER/WARNING 后最多执行三轮“核实 → 修订 → 复查”；第三轮仍未解决时停止自动推进，使用 question 请求用户决定补任务、拆分计划或延期。
9. 需求或验收标准变化时返回 discuss/Plan，重新确认并修订 spec/plan；仅 Files、依赖、任务结构变化或失败重规划时，只修订计划并重新自查。

## 计划文档头（固定）

~~~markdown
# <标题> 实现计划

**目标**：<一句话>
**架构**：<2-3 句>
**技术栈**：<关键技术/库>
**Spec**：.oceanus/spec/<唯一文件>.md

## 全局约束

<逐行列出 spec 的项目级要求——版本下限、依赖限制、命名/文案规则、平台要求；
从 spec「全局约束」章节逐字复制确切值（spec 无该章节时先回 Discuss 补齐，不得凭记忆改写）。每个任务的需求默认包含本节。>

## 可观察行为（truths）

<目标反推：目标达成为真时，哪些行为可观察、哪些文件必须存在、哪些连接必须接通。
每条一行、可被 review 独立核验；这是 Completion Audit 的逐条锚点，不是泛泛的验收重述。
browser_verify 开启的前端任务：编写此类 truths 前先加载 agent-browser skill（命令映射唯一来源），交互/渲染类 truths 写成 agent-browser 可取证形式（如 get styles 断言值、find role … click 后的 snapshot 状态）。>
~~~

## 任务结构（固定模板）

每个任务必须包含以下全部区块：

~~~markdown
### Task N：<组件名>

**Files**：
- Create: \`exact/path/to/file.ts\`
- Modify: \`exact/path/existing.ts:123-145\`
- Test: \`tests/exact/path/file.test.ts\`

**Interfaces**：
- Consumes: <引用前序任务的确切签名>
- Produces: <后续任务依赖的确切函数名、参数与返回类型>

**步骤**（TDD 开启时）：
- [ ] **步骤 1：编写失败测试**
  <真实测试代码块>
- [ ] **步骤 2：运行测试确认失败**
  Run: \`bun test tests/path/file.test.ts -t "name"\`
  Expected: FAIL —— <具体错误信息>
- [ ] **步骤 3：编写最小实现**
  <真实实现代码块>
- [ ] **步骤 4：运行测试确认通过**
  Run: 同上
  Expected: PASS
- [ ] **步骤 5：运行表面验证（如适用）**
  <命令与预期输出；browser_verify 开启的前端任务：dev server 后台启动 → agent-browser wait --url → screenshot/交互断言，附 Expected>

**步骤**（TDD 关闭时）：
- [ ] **步骤 1：编写 characterization 基线测试固定现有行为**
- [ ] **步骤 2：运行基线确认通过**（现状快照）
- [ ] **步骤 3：实现变更**（真实代码块）
- [ ] **步骤 4：运行测试确认通过**
- [ ] **步骤 5：运行表面验证（如适用）**
  <同上；browser_verify 开启的前端任务用 agent-browser 命令作为渲染表面验证>

Task ID / Dependencies / Preconditions（可选：执行前必须为真的外部事实——环境已配好、前置产物存在、环境变量就绪；不满足即停止上报而非自行猜测）
Decisions: <覆盖的锁定决策 D-ID 列表；无则写 none；实现 one-way 决策的任务前置用户确认检查点>
Validation: <command>；Expected: <预期输出>（browser_verify 开启的前端任务可含 agent-browser 断言命令，如 get styles 数值对比、find role … click 后的状态断言）
验收标准 / 风险与回滚 / status / owner / wave / updated / 预估 diff 行数
~~~

TDD 步骤选择遵循 Intake 执行配置批问的 TDD 开关；未批问时按默认关闭（characterization 基线路径）。

## 无占位符（计划失败项）

以下写法是计划失败，绝不出现：
- "TBD"、"TODO"、"待补充"、"后续实现"。
- "添加适当的错误处理"、"添加校验"、"处理边界情况"（不展示怎么做）。
- "为上述内容编写测试"（不附真实测试代码）。
- "与 Task N 类似"（重复代码——执行者可能乱序阅读任务）。
- 描述做什么但不展示怎么做的步骤；代码步骤必须带代码块。
- 引用任何任务中未定义的类型、函数或方法。

## 范围缩减禁令（语义级）

无占位符管格式，本节管语义偷工减料。以下削减语出现在任务动作/步骤正文即计划失败：

- "v1 先…"、"简化版"、"暂时静态"、"暂时硬编码"、"占位实现"、"先跳过"、"后续再接"、"未来增强"、"最小版本"。

**规则**：锁定决策（D-ID）说了交付什么，任务就必须原量交付什么——计划者无权以"复杂/困难/非平凡"为由简化用户决策。只有三个合法的拆分或缺项理由：

1. **上下文成本**：实现将占用单个执行者上下文预算的过大比例；
2. **信息缺失**：所需数据不存在于任何输入产物；
3. **依赖冲突**：功能依赖另一个未交付的变更。

确实无法覆盖时，显式返回"未覆盖项发现"并给三个选项（补任务 / 拆分子计划 / 请用户确认延期），**绝不静默带缺口定稿**。研究建议与锁定决策冲突时遵守用户决策，并在任务中注明"按用户决策使用 X（研究建议 Y）"。

## 验证命令接地规则

- **复用已验证命令**：执行环境里已经成功运行过的命令原样复用（含工作目录前缀，如 \`npm --prefix <dir> run <script>\`）；自造的命令必须能在本仓库实际解析。
- **grep 卫生（计数验证）**：注释行会计入计数——含注释的文件必须先过滤注释（\`grep -v\` 或对应注释前缀）再计数；禁止对未过滤文件使用裸"计数 == 0"门禁——计划自身的说明文字就可能让它自噬。计数手段跟随实际 shell：优先用宿主 \`grep\` 工具（或 rg）完成；确需 shell 时按当前 shell 选择等价命令（bash: \`grep -c\`/\`grep -v\`；PowerShell: \`Select-String | Measure-Object\`；cmd 无内建等价，改用宿主工具），不要对 PowerShell/cmd 套用 Unix 命令。
- **注释文本纪律**：验收标准若用"不得包含字面 X"做反向检查，则字面 X 不得出现在任务的步骤/动作正文里，否则计划文档自己触发验收失败；确需引用时用变体描述并注明。
- 每个验证命令标明预期输出/退出码；运行时长超过一分钟的命令降级为分段验证并注明。

## 自审（写完计划后立即执行，不委派）

**对抗性视角：计划描述意图，自审验证交付。** 起始假设是"这份计划有缺陷"，逐条证明它确实覆盖 spec 的每个目标后再放行；自查者最容易变软的方式是接受"貌似合理的任务列表"而不逐条回溯到需求。

1. **四源覆盖审计**：对四类输入源逐项映射到任务——**目标**（spec 的目标与非目标）、**需求**（每条验收标准）、**研究**（调研发现的功能/约束/负向结论）、**决策**（D-ID 锁定决策）。每个条目必须能指向至少一个实现它的任务；存在决策登记表时逐条核验 D-ID 被任务的 Decisions 字段引用且任务动作覆盖决策全量范围（引用 D-ID 不等于交付决策）；排除项不出现在任何任务中。发现未覆盖项时按"范围缩减禁令"的三选项处理，绝不静默定稿；缺失决策登记表时记录"无 D-ID 可追溯"并按前三源执行。
2. **削减语扫描**：按"范围缩减禁令"的清单搜索任务正文并修复或补理由。
3. **占位符扫描**：按"无占位符"清单逐条搜索并修复。
4. **类型一致性**：后置任务使用的类型、签名、属性名与前置任务定义完全一致（\`clearLayers()\` 与 \`clearFullLayers()\` 并存即为 bug）。
5. **行号时效**：Modify 路径的行号基于计划时点；执行者动手前须重新定位，行号漂移不算执行失败。
6. 发现问题就地修复后继续，不重复自审；spec 需求无对应任务时补任务。

### 独立计划分析输入

Standard 与 Architecture 计划应提供给 Oracle analysis：已批准的 requirements_context、assumptions、edge_coverage、truths、prohibitions、D-ID、文件映射、任务依赖和验证命令。要求 Oracle 采用 goal-backward 方式检查：每条需求/边界/真值/禁止项是否有实际任务和接线证据，是否存在未声明的时序耦合、失效条件或不可验证命令。Oracle 只给 advisory；主 Agent 需逐条核实后决定是否修订。

## Oracle 按需咨询

复杂架构或高风险场景可按需委派 @oracle(analysis) 提供 advisory。Oracle 不输出门禁 verdict，不阻断 execute，也不参与完成判定。

调用前先检查会话内已回收的调研结论与前次 Oracle advisory：研究问题、task 标识、state_head、变更文件集合与用户决策未变化时，把已有结论写入 Oracle Brief 的 prior_findings 并只提增量问题，不重复全量调研；快照失效、结论缺失或部分覆盖时 fail-open 重新调研，不得把过期结论当作已验证事实。

## 检查清单

- [ ] 文件结构先行：每个文件的职责与边界已明确
- [ ] 任务按独立测试周期切分，搭建/配置折叠进交付任务
- [ ] 每任务逐步 checkbox，代码步骤附真实代码块
- [ ] 每步验证命令带预期输出
- [ ] 无占位符（按清单扫描）
- [ ] 自审六项完成：四源覆盖审计 / 削减语扫描 / 占位符 / 类型一致 / 行号时效 / 修复闭环
- [ ] ledger 或会话内 todo 已初始化
- [ ] 计划已保存（SDD 开启时）
- [ ] impact_estimate 已用 CBM/grep/read 自查并记录
- [ ] TDD 步骤模式与 Intake 执行配置一致
- [ ] 当前目录执行约束沿用：不加 commit 步骤，worker 禁 git 操作

## 规则

计划自查完成即可进入 execute。Oracle advisory 是可选建议，不是 gate；不记录、不伪造任何门禁结果。所有 worker 使用当前目录，禁止隔离工作区、分支及 git 操作；每任务以"验证通过 + ledger 终态记录"替代提交步骤。需求或验收标准变化返回 discuss/Plan 并重新确认，修订 spec/plan 后重新自查。`,
};

export { OCEANUS_PLAN_SKILL };
