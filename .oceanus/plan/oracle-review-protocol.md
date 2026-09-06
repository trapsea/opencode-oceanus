# Plan: 主 Agent 执行模式 + Oracle 统一审核协议改造

- 日期：2026-09-06
- Spec: `.oceanus/spec/oracle-review-protocol.md`
- Status: approved（方案总批准：用户 2026-09-06「按照上述调整方案进行实现」）

## Plan Status

- **Momus 门禁：SKIPPED_BY_USER**（执行配置批问 2026-09-06 抉择）。残余风险：计划质量依赖下方自查 checklist + Review 阶段 CBM 影响面复查 + 全量测试兜底，不伪造 OKAY。
- **Metis 调研：SKIPPED_BY_USER**；调研已由主 agent 多轮源码侦察完成（引用面清单见任务依据）。
- TDD=开：T1/T3 测试先行；SDD=开：本文档 + progress + review 产物。

## Plan 自查 Checklist（替代 momus 校验）

1. ✅ 每任务文件所有权互斥（见任务表 Files 列；同 Wave 无重叠）
2. ✅ 每 Wave 结束点 typecheck/bun test 可运行（Wave1 纯新增+独立；Wave2 原子删除组；Wave3 文本/文档）
3. ✅ momus 契约断言迁移映射明确：cbm-usage.test.ts L53-55/106-110/128-129 → scenes.test.ts 的 plan-gate 断言；finish.test.ts momus 字段 → gate 字段；gate.test.ts「Metis/Momus 审核」→「Oracle 门禁审核」
4. ✅ 构建脚本锚点同步：verify-dist-skills.ts（intake 锚点）随 T10a；check-prompt-chinese.ts TARGET_FILES 随 T12（Wave2 后文件已删）
5. ✅ 删除原子性：constants.ts + agents/index.ts + metis.ts/momus.ts + tui.test.ts + cbm-usage.test.ts 旧断言同 Wave（T9）
6. ✅ impact_estimate 覆盖：全部修改文件均在任务表中；公共符号 DelegationBrief/SUBAGENT_NAMES/CbmRole/MomusStatus 的调用方已逐一列出
7. ✅ 每 Wave 派发前向用户一句话说明；worker 禁止 git add/commit/reset；只编辑声明的 Files

## impact_estimate

- 修改/删除：src/agents/{oceanus,sisyphus,protocol,oracle,explorer,fixer,designer,index,metis,momus}.ts、src/agents/orchestrator-context.ts、src/config/constants.ts、src/cbm/registry.ts、src/hooks/tool-loop-guard.ts、src/skills/oceanus-{intake,brainstorm,plan,execute,review,finish}.ts、scripts/{check-prompt-chinese,verify-dist-skills}.ts、README.md、AGENTS.md、docs/{tooling-and-runtime,codebase-memory-mcp}.md、package.json
- 新增：src/review/{protocol,scenes}.ts 及测试
- 受影响调用方：cbm-usage.test.ts、registry.test.ts、gate.test.ts、finish.test.ts、evidence.test.ts、review-budget.test.ts、tui.test.ts、oceanus-finish.ts 的 MomusStatus 消费链
- 公共符号变更：SUBAGENT_NAMES 收窄（8→6）、CbmRole 删 'metis'|'momus'、MOMUS_GATE_PROTOCOL→REVIEW_GATE_PROTOCOL、MomusStatus→GateStatus、新增 ResearchBrief/buildReviewPrompt/parseVerdict/REVIEW_SCENES

## 任务表

### Wave 1（并行 4 任务，纯新增/独立，typecheck 安全）

| ID | 任务 | Files | 预估 diff | TDD |
|---|---|---|---|---|
| T1 | Review Protocol 核心模块：类型（ReviewContract/Reviewer/Finding/ReviewScene/ReviewRequest）+ buildReviewPrompt + parseVerdict（字面量 [OKAY]/[REJECT]/PASS/WARN/FAIL）+ validateSubjectPath 白名单 + 场景契约通用文本（六不变量：落盘对象/契约三档/findings 结构/受限循环/fresh-session/只读） | src/review/protocol.ts【新】、src/review/protocol.test.ts【新】 | ~300 | ✅先测试 |
| T2 | oracle 场景化：ORACLE_PROMPT 增加场景路由段（收到 `<oracle_scene name="...">` 指令块时以场景指令优先；gate 场景输出 [OKAY]/[REJECT] 且顾问风格让位；consult 禁止输出门禁 verdict 格式；独立会话声明），保留现有顾问人设与 cbmSection('oracle') | src/agents/oracle.ts、src/agents/oracle.test.ts【新】 | ~150 | ✅ |
| T3 | tool-loop-guard 编辑后重读豁免：SessionState 记录最近 write/edit/apply_patch/ast_grep_replace 目标路径；read/grep/glob 参数命中该路径时重置对应计数（before 不阻塞 + after 不递增）。保留现有整工具豁免与告警机制 | src/hooks/tool-loop-guard.ts、src/hooks/tool-loop-guard.test.ts | ~120 | ✅先测试 |
| T4 | 委派简报双模板：保留 DelegationBrief（逃生舱用），新增 ResearchBrief（goal/scope/background/return/deadline 五字段）+ formatResearchBrief + RESEARCH_BRIEF_PROMPT（只读调研默认用调研简报；执行简报仅逃生舱） | src/agents/orchestrator-context.ts | ~80 | 补断言 |

### Wave 2（并行 5 任务，引用切换 + 原子删除；依赖 Wave1）

| ID | 任务 | Files | 预估 diff | 依赖 |
|---|---|---|---|---|
| T5 | 场景注册表：REVIEW_SCENES 六场景（plan-gate/solution-analysis/diff-review/completion-audit/visual-acceptance + 注册表导出）。plan-gate checks 继承 momus.ts 全部判定规则（BLOCKER/SUGGESTION 分级、max 3 issues、最小修订集、impact_estimate 覆盖校验文本——从 cbm/registry.ts MOMUS_SECTION 提取语义）；solution-analysis 继承 metis.ts 的 SOLUTION_ANALYSIS/BACKGROUND_RESEARCH 模式；diff-review/completion-audit/visual-acceptance 按方案新写 | src/review/scenes.ts【新】、src/review/scenes.test.ts【新】（含 momus 契约迁移断言：BLOCKER 分级/max-3/最小修订集/REJECT 语义） | ~400 | T1 |
| T6 | oceanus.ts 主编排改造：AGENT_DESCRIPTIONS 删 metis/momus 条目、oracle 条目扩三场景（consult/analysis/gate）、fixer 改逃生舱语义（三条件：文件集完全不相交+机械同构+任务数≥3）、designer 收窄（仅视觉设计迭代）；委派契约段同步；新增「执行纪律」段（主 agent 直接实现/侦察缺口委派 explorer/高风险 cbm_trace+oracle/每任务即验证/大输入隔离：网页→librarian、图像→observer、>2000 行输出→截断或 explorer）；Wave 段降级（写入 Wave 仅逃生舱，只读并行保留）；PARALLEL_DELEGATION_EXAMPLES 更新；intakeOwnership 删 @metis 引用；DELEGATION_BRIEF_PROMPT 注入点改双模板说明；CBM 调度段 oracle 表述保留 | src/agents/oceanus.ts | ~250 | T4 |
| T7 | sisyphus.ts + protocol.ts：SISYPHUS_PHASES 六阶段引用切换（@momus→@oracle 场景 gate、metis BACKGROUND_RESEARCH→oracle(analysis)）；批问五项→四项（Oracle 门禁审核/SDD/TDD/连续执行授权，合并推荐阈值语义）；buildMetisMomusGate→buildOracleReviewGate（oracle 禁用分支提示；修复 L67-69 空 push 遗留）；protocol.ts：MOMUS_GATE_PROTOCOL→REVIEW_GATE_PROTOCOL（语义改为 @oracle 场景 gate，规则不变），THREE_ROUND_TEMPLATE 循环名更新（oracle-gate REJECT/oracle-analysis 分歧），PLAN_ACCEPTANCE_RUBRIC 注释对应关系更新 | src/agents/sisyphus.ts、src/agents/protocol.ts | ~200 | T1 |
| T8 | cbm/registry.ts：CbmRole 删 'metis'|'momus'；METIS_SECTION/MOMUS_SECTION 删除（语义已迁移 scenes.ts，加注释指向）；CBM_LIFECYCLE.full 文本 momus 字样→oracle(gate) 场景表述（intake/plan/review 三处阶段边界句同步）；registry.test.ts ROLES 与断言更新 | src/cbm/registry.ts、src/cbm/registry.test.ts | ~120 | — |
| T9 | 删除原子组：删 src/agents/metis.ts、src/agents/momus.ts；agents/index.ts 删两工厂 import/注册/METIS_DEFAULT_PERMISSION 特判；config/constants.ts SUBAGENT_NAMES(8→6)/DEFAULT_MODELS/READONLY_AGENTS(6→4)/删 METIS_DEFAULT_PERMISSION；tui.test.ts ALL_AGENT_NAMES 断言更新；cbm-usage.test.ts 删 metis/momus prompt 断言（新断言 Wave3 由 scenes.test.ts 承载） | src/agents/metis.ts【删】、src/agents/momus.ts【删】、src/agents/index.ts、src/config/constants.ts、src/tui.test.ts、src/agents/cbm-usage.test.ts | -250 | — |

### Wave 3（并行 5 任务，skills/文档/脚本；依赖 Wave2）

| ID | 任务 | Files | 预估 diff |
|---|---|---|---|
| T10a | skills 前段组：oceanus-intake.ts（批问四项、metis→oracle(analysis)、L65 锚点句改为「Intake 不委派 oracle analysis；Intake 是主 agent 自己的阶段」）、oceanus-brainstorm.ts（配置文本）、oceanus-plan.ts（@momus→@oracle 场景 gate/verdict 记录/双门禁/Plan-Change/门禁红线）；gate.test.ts 断言更新；verify-dist-skills.ts 锚点同步 | src/skills/oceanus-intake.ts、oceanus-brainstorm.ts、oceanus-plan.ts、gate.test.ts、scripts/verify-dist-skills.ts | ~180 |
| T10b | skills 后段组：oceanus-execute.ts（input 改 oracle-gate OKAY；执行语义改主 agent 执行：按 plan 顺序/侦察委派/每步验证/Wave 降级为逃生舱/Plan-Change 边界）、oceanus-review.ts（momus 预估对比→oracle-gate）、oceanus-finish.ts（MomusStatus→GateStatus、momus 字段→gate、完成条件）；finish.test.ts/evidence.test.ts/review-budget.test.ts 更新 | src/skills/oceanus-execute.ts、oceanus-review.ts、oceanus-finish.ts、finish.test.ts、evidence.test.ts、review-budget.test.ts | ~200 |
| T10c | subagent 定义组：explorer.ts 返回契约（浓缩事实+findings 落盘 .oceanus/findings/、每条带路径+行号/qualified name）、fixer.ts 逃生舱语义、designer.ts 视觉例外收窄 | src/agents/explorer.ts、fixer.ts、designer.ts | ~100 |
| T11 | 文档与版本：README.md（agent 一览 8 个、复杂任务门禁改 oracle 场景、六阶段表 Execute 行改主 agent 执行+逃生舱）、AGENTS.md（agent 名单/批问四项/门禁协议）、docs/tooling-and-runtime.md、docs/codebase-memory-mcp.md（角色表）；package.json 0.45.0→0.46.0 | README.md、AGENTS.md、docs/tooling-and-runtime.md、docs/codebase-memory-mcp.md、package.json | ~150 |
| T12 | 构建脚本：check-prompt-chinese.ts TARGET_FILES 删 metis.ts/momus.ts、加 review/scenes.ts（中文 prompt 检查），APPROVED_TOKENS 清理 | scripts/check-prompt-chinese.ts | ~30 |

## 验证命令

```bash
bun run typecheck
bun test
bun run build && bun run check:dist
bun run scripts/check-prompt-chinese.ts   # T12 后
grep -rn "@metis\|@momus\|Metis\|Momus" src/ --include="*.ts" | grep -v test  # 应仅剩历史注释/场景迁移注释
```

## 风险与回退

- Wave2 删除组原子失败 → 回退该 Wave 全部（git 未提交，直接修复）
- prompt 行为回归 → T6/T7/T10 的契约测试 + cbm-usage/gate/finish 测试矩阵兜底
- 历史 .oceanus/ 文档中的 metis/momus 字样不清理（历史产物不动）
