# Sisyphus 契约优化实现计划

## 已确认策略

- TDD：C15 先补责任边界失败测试（RED），C14 再实现修复并使测试转 GREEN，随后执行完整验证。
- Worktree：当前工作区；写入任务按文件所有权串行集成，不创建 Worktree。
- 不修改宿主 task 调度器；依赖校验是插件侧 advisory。
- Finish：新增 Skill，只读取 Review 报告、对应 Ledger 和 workspaceRef，调用纯函数做收口，不重新测试/构建/刷新 CBM。

## 任务图

当前执行顺序：C10 → C15（RED）→ C14 → (C14R ∥ C15R（GREEN）) → C11R(REJECT) → C18（RED）→ C17 → C19 → C12；C7/C11/C13 仅保留历史记录，不可调度。

## 统一数据协议

### Ledger v1

`.oceanus/progress/<plan-name>.md` 保留人类可读任务表，并新增唯一权威的 `<!-- sisyphus-ledger:v1 -->` JSON fenced block。JSON 必须包含 `schemaVersion: 1`、`plan`、`workspaceRef`（`{ gitHead: string|null, dirty: boolean }`）和 `tasks`。`plan` 为非空字符串；每个 task 必填：`taskId`（唯一非空字符串）、`wave`（正整数）、`dependsOn`（非空字符串数组，可为空数组）、`files`（非空字符串数组，可为空数组）、`state`（`pending|in_progress|completed|failed|blocked`）、`owner`（非空字符串）、`evidence`（数组）、`updatedAt`（ISO-8601 UTC）；每条 evidence 必填且字符串不得为空：`kind`、`status`（`missing|unverified|verified|stale|degraded`）、`source`、`command`（字符串）、`exitCode`（整数或 null）、`timestamp`（ISO-8601 UTC）、`workspaceRef`（同上）、`note`。

解析失败返回结构化诊断，不静默兼容：`missing_block`、`invalid_json`、`unsupported_version`、`duplicate_task_id`、`missing_dependency`、`dependency_cycle`、`upstream_failed_or_blocked`、`file_scope_conflict`、`invalid_timestamp`、`stale_evidence`。`workspaceRef` 固定为 `{ gitHead: string|null, dirty: boolean }`；`dirty` 指实现范围文件是否有未提交变化，排除 `.oceanus/progress/` 与 `.oceanus/review/` 元数据文件；证据的 `gitHead` 与当前 ref 不一致时为 `stale`，CBM/host 降级明确为 `degraded`。解析器只提供 advisory 结果，不改变宿主 task 调度和 TaskRegistry 生命周期。

C4 的公开纯函数固定为：`parseLedger(text): ParseResult<LedgerV1>`、`validateLedger(ledger, currentRef): Diagnostic[]`、`parseReviewReport(text): ParseResult<ReviewReportV1>`、`decideFinish(reportText, currentRef, ledger): FinishDecision`。`ParseResult` 为 `{ value?: T, diagnostics: Diagnostic[] }`；`Diagnostic` 为 `{ code, path, message }`；`FinishDecision` 为 `{ status: 'COMPLETED'|'NOT_COMPLETED', reasonCodes: FinishReasonCode[] }`。Ledger 诊断码和 Finish 诊断码分别固定为本节列出的联合字面量，未知字段保留但未知 schema/version 失败。

### Review Report v1

Review 报告使用 `<!-- sisyphus-review:v1 -->` JSON block，字段结构、非空约束、Ledger taskId 全覆盖约束和 `FinishReasonCode` 完全以 spec 为准；所有 tests 都是必需且必须 `passed`。Finish 输入为报告文本和 `WorkspaceRef`；先 parse，parse 失败返回 `invalid_report`，缺少输入返回 `missing_report`，再按 `review_rejected|stale_report|incomplete_matrix|blocking_finding|tests_not_passed` 顺序返回全部适用 reasonCodes；不重新执行验证；报告生成者是 C11R 的主会话 Review owner，落点为 `.oceanus/review/<plan-name>.md`。

### C1：建立阶段契约测试基线

- Wave：1
- Depends on：无
- Files：`src/skills/stages.test.ts`
- Owner：测试代理只写本文件；禁止修改 Agent、Skill、工具和文档文件。
- 目标：先固定六阶段、六个阶段 Skill，以及每个阶段的 8 个契约字段，并逐阶段断言允许的 `humanReview` 值。
- 验证命令：`bun test src/skills/stages.test.ts`；预期 RED 为缺少 Finish Skill/契约字段。证据记录测试命令、退出码、UTC 时间和 workspace ref；不得修改生产代码。

### C2：建立 ledger 结构化模型测试

- Wave：1
- Depends on：无
- Files：`src/tools/task/contract.test.ts`
- Owner：测试代理只写本文件；禁止修改 `types.ts`、`registry.ts`、`src/tools/index.ts`。
- 目标：固定 Ledger v1 和 Review Report v1 的字段类型、必填项、统一 camelCase 命名、ISO-8601 UTC、workspace ref、所有诊断码及 Finish 决策分支。
- 验证命令：`bun test src/tools/task/contract.test.ts`；预期 RED 覆盖 Ledger/Review schema 的必填字段和类型、统一 camelCase、缺失 block、非法 JSON/版本、重复任务、缺失/循环/失败依赖、文件冲突、非法 UTC 时间、stale/degraded evidence、缺失/REJECT/过期/矩阵不全 Review 报告及 Finish 决策诊断码。

### C3：收敛 Agent 全局契约与阶段 Skills

- Wave：2
- Depends on：C1
- Files：`src/agents/sisyphus.ts`、`src/agents/metis.ts`、`src/skills/sisyphus-intake.ts`、`src/skills/sisyphus-brainstorm.ts`、`src/skills/sisyphus-plan.ts`、`src/skills/sisyphus-execute.ts`、`src/skills/sisyphus-review.ts`、`src/skills/sisyphus-finish.ts`（新增）、`src/skills/index.ts`
- Owner：Skill/Agent 实现代理；禁止修改测试、task 工具和文档文件。
- 目标：Agent 仅保留全局角色/顺序/跨阶段不变量；各 Skill 声明完整阶段契约；Plan 加入 Momus 后人工批准；Review 加入 subagent、Momus 和测试；Finish 仅读取 Review 报告。
- 验证命令：`bun test src/skills/stages.test.ts`；C1 全部转 GREEN，逐阶段 8 字段通过；Finish 文案明确只读取 Review 报告且不执行测试/构建/CBM/subagent；Skill 注册包含六阶段 Skill。

### C4：实现 ledger 解析与 advisory 校验

- Wave：2
- Depends on：C2
- Files：`src/tools/task/contract.ts`（新增）、`src/tools/task/contract.test.ts`
- Owner：contract 实现代理只写 `contract.ts`；C2 测试代理拥有 `contract.test.ts`，C4 仅在 C2 完成后追加测试；禁止修改 `TaskRegistry`、宿主状态解析、task 调度/取消 API，并在测试中断言 contract 模块不触碰这些 API。
- 目标：实现独立 Ledger/Review schema、解析器、依赖/文件冲突/证据 freshness 校验和 Finish 决策函数；所有校验返回 advisory 诊断，不接管宿主调度。
- 验证命令：`bun test src/tools/task/contract.test.ts`；C2 全部转 GREEN。另运行 `bun test src/tools/task/registry.test.ts src/tooling-registration.test.ts`，证明既有 TaskRegistry 状态、清理、ownership 和 task 三件套行为未改变。

### C5：补齐 Agent/Skill/工具回归测试

- Wave：3
- Depends on：C3、C4
- Files：`src/agents/index.test.ts`、`src/agents/cbm-usage.test.ts`、`src/tools/task/registry.test.ts`、`src/tooling-registration.test.ts`
- Owner：回归测试代理只写列出的测试文件；不得修改 C1/C2 测试或生产代码。
- 目标：覆盖 Intake 由 Sisyphus 完成且 Metis INTAKE 次数为 0 的协议 fixture；候选方案已定跳过 SOLUTION_ANALYSIS、未决时复用同一报告、需求变化时才重新分析；Plan `PLAN_OKAY → 人工 APPROVED → Execute` 状态顺序，缺任一状态均不得 Execute；Review fixture 明确 subagent 产出测试证据、Momus 只审 evidence/tests/completionMatrix、Sisyphus 汇总并判定 `REVIEW_OKAY/REVIEW_REJECT`；不改变旧 task 行为。
- 验证命令：`bun test src/agents/index.test.ts src/agents/cbm-usage.test.ts src/tools/task/registry.test.ts src/tooling-registration.test.ts`；每个 fixture 断言调用次数、顺序、Intake report 引用相等性、门禁状态和 Review 拒绝条件；host smoke 无真实 host 时保留 skip/blocked 诊断，静态测试不得声称证明真实 Agent 调用顺序。

### C6：统一用户文档与构建验证

- Wave：3
- Depends on：C3、C4、C5
- Files：`README.md`、`docs/tooling-and-runtime.md`、`docs/codebase-memory-mcp.md`、`docs/openagent-orchestration-review.md`、`docs/three-way-capability-comparison.md`、`scripts/verify-dist-skills.ts`
- Owner：文档/验证代理只写列出的文件；不得修改源码和测试。
- 目标：统一六阶段和六个阶段 Skill，标注历史文档，说明 Momus/人工审核矩阵、Finish 只读收口、Ledger/Review schema 和依赖校验 advisory 边界。
- 验证命令：`bun run typecheck && bun test && bun run build && bun scripts/verify-dist-skills.ts`。Review Report 的 Completion Matrix 每行绑定 taskId、证据状态和 workspace ref；每项证据记录命令、退出码、UTC 时间和 workspace ref。

### C7：最终审查与收口（历史 REJECT，已由 C11R 替代）

- State：superseded；不进入当前 Ledger，由 C11R 替代
- Wave：4
- Depends on：C6R
- Files：无（历史任务）
- Read-only scope：`src/**`、`scripts/**`、`README.md`、`docs/**`、`.oceanus/spec/sisyphus-contract-optimization.md`、`.oceanus/plan/sisyphus-contract-optimization.md`、`.oceanus/progress/sisyphus-contract-optimization.md`（只读范围不参与 file_scope_conflict）
- Owner：主会话 Review owner；只允许写结构化 Review 报告，不得修改源码、测试、文档或 ledger，不得执行实现任务；可调度只读 Review subagent，subagent 结果必须以 evidence/tests/findings 进入报告。C6 是主验证来源，C7 只补充独立审查，不重复执行 C6 命令。
- 目标：Review 阶段由 subagent 执行独立只读审查并产出结构化证据，测试命令由 C6 统一执行；Momus 审核 evidence/tests/completionMatrix 的完整性和契约合规性；Sisyphus 汇总并写入 `sisyphus-review:v1` 报告，判定 `REVIEW_OKAY/REVIEW_REJECT`；Finish 仅读取报告并输出结果。
- 验证：C8/C9 修改后实际重新执行 `bun run typecheck`、`bun test`、`bun run build`、`bun scripts/verify-dist-skills.ts`，重新绑定当前 gitHead/dirty 证据；并由 subagent 和 Momus 完成只读 Review。C11R 写入第二轮报告（覆盖第一轮 REJECT），Finish 仅消费第二轮报告，不重跑命令。

## Oracle findings 修复映射

- C7-01/C7-02：C8，收敛 Agent/Skill；Intake 由 Sisyphus 完成，Metis 仅条件式 SOLUTION_ANALYSIS。
- C7-03/C7-04/C7-05：C8，补 Plan/Review/Finish 门禁和角色边界；C9 验证 FinishDecision。
- C7-06：C10，修复 Ledger JSON、历史 null ref 证据状态和表格一致性。
- C7-07：C9，补 schema、矩阵 taskId 全覆盖和证据状态校验。
- C7-08：C8，清理 README/历史对比文档流程表述。
- C7-09：C8，统一 CBM 为 Intake 初始化、Review 可刷新且失败降级的明确协议。

### C8：修复 Agent/Skill Review 阻塞项

- Wave：5
- Depends on：C6R
- Files：`src/agents/sisyphus.ts`、`src/agents/metis.ts`、`src/skills/sisyphus-intake.ts`、`src/skills/sisyphus-brainstorm.ts`、`src/skills/sisyphus-plan.ts`、`src/skills/sisyphus-execute.ts`、`src/skills/sisyphus-review.ts`、`src/skills/sisyphus-finish.ts`、`src/skills/index.ts`、`README.md`、`docs/three-way-capability-comparison.md`
- Owner：契约修复代理；只修改 Agent/Skill 和指定文档，禁止修改 task contract、测试、progress。
- 目标：删除 Agent 中重复的阶段细节和 Finish 无 Skill 旧语义；明确 Metis 模式、Plan `PLAN_OKAY → 人工 APPROVED → Execute`、Review subagent/Momus/test 责任；Finish 必须读取 Review v1 并调用 `decideFinish`；清理指定文档旧流程。
- 验证命令：`bun test src/skills/stages.test.ts src/agents/index.test.ts src/agents/cbm-usage.test.ts`；每个 fixture 断言上述调用次数、顺序、模式、报告引用相等性和 humanReview 值。

### C9：修复 Review/Ledger contract 校验阻塞项

- Wave：5
- Depends on：C6R
- Files：`src/tools/task/contract.ts`、`src/tools/task/contract.test.ts`
- Owner：contract 修复代理；只修改上述两个文件，禁止修改 TaskRegistry、Agent/Skill、progress。
- 目标：统一 workspaceRef；校验所有非空字段、矩阵 taskId 唯一且覆盖 Ledger、空数组和 stale/degraded 规则；完成 Finish 输入解析链路、七个 reasonCode 及组合；保持独立纯函数和 advisory 边界。
- 验证命令：`bun test src/tools/task/contract.test.ts`。

### C10：修复结构化 progress ledger

- Wave：5
- Depends on：C8、C9
- Files：`.oceanus/progress/sisyphus-contract-optimization.md`
- Owner：主会话；只修正本计划 ledger JSON 和人工表格的一致性，禁止修改源码。
- 目标：移除非法根级字段，补齐当前 19 个任务的唯一合法 Ledger v1 记录；将前期 RED/旧 workspace ref 证据标记为 `degraded`，不作为当前 freshness 通过证据。
- 验证命令：执行以下可复制脚本；脚本解析唯一 JSON block 和人工表格，规范化 taskId、state、wave、dependsOn、files 后逐项比较，缺失、重复或不一致退出 1，全部一致退出 0：
  ```bash
  python3 - <<'PY'
  import json,re
  s=open('.oceanus/progress/sisyphus-contract-optimization.md').read()
  blocks=re.findall(r'```json\n(.*?)\n```',s,re.S)
  assert len(blocks)==1
  x=json.loads(blocks[0])
  expected={'C1','C2','C3','C4','C5','C6','C6R','C8','C9','C10','C14','C15','C15R','C14R','C11R','C17','C18','C19','C12'}
  assert len(x['tasks'])==19 and {t['taskId'] for t in x['tasks']}==expected
  table=re.findall(r'^\| (C\w+) \| (\w+) \| (\d+) \| ([^|]+) \| (.*?) \|',s,re.M)
  assert len(table)==19 and len({r[0] for r in table})==19
  for tid,state,wave,deps,files in table:
      t=next(t for t in x['tasks'] if t['taskId']==tid)
      table_files=[f.strip().strip('`') for f in files.split(';') if f.strip()]
      assert (state,int(wave),deps.strip(),table_files)==(t['state'],t['wave'],','.join(t['dependsOn']) if t['dependsOn'] else '无',t['files'])
  PY
  ```

### C11：修复后重新 Review（历史 REJECT，已由 C11R 替代）

- State：superseded；由 C11R 替代，不执行
- Wave：6
- Depends on：C10
- Files：无（历史任务记录）
- Owner：主会话 Review owner；可调度只读 subagent 和 Momus，禁止修改源码/测试/ledger。
- 目标：历史任务，改由 C11R 执行；不再作为当前可调度任务。

### C14：执行当前责任边界修复

- Wave：6
- Depends on：C8、C9、C10、C15
- Files：`src/agents/sisyphus.ts`、`src/skills/sisyphus-intake.ts`、`src/skills/sisyphus-review.ts`、`src/skills/sisyphus-finish.ts`、`src/skills/sisyphus-brainstorm.ts`、`src/skills/sisyphus-plan.ts`、`README.md`、`docs/three-way-capability-comparison.md`、`src/index.ts`、`.oceanus/spec/sisyphus-contract-optimization.md`
- Owner：契约修复代理；只修改上述文件，禁止修改 task contract、测试和 progress。
- 目标：以当前决策为准清理残留冲突：Intake 由 Sisyphus 完成；Metis 仅条件式 `SOLUTION_ANALYSIS`（不修改 Metis 的通用 INTAKE 能力）；Agent 仅保留全局六阶段契约；Plan 为 Momus OKAY 后人工 APPROVED；Review Momus 审 evidence/tests/matrix；Finish 读取 Review v1 + Ledger + workspaceRef 并调用 `decideFinish`；Intake/Review 人工审核均为 conditional；Review 报告落点为 `.oceanus/review/<plan-name>.md`；Finish 不测试/构建/CBM/委派。
- 验证命令：先执行 `if grep -nE "Finish has no dedicated skill|Finish 无 Skill|五阶段|四阶段|五个阶段 skill" src/agents/sisyphus.ts src/index.ts src/skills/sisyphus-intake.ts src/skills/sisyphus-review.ts src/skills/sisyphus-finish.ts src/skills/sisyphus-brainstorm.ts src/skills/sisyphus-plan.ts README.md docs/three-way-capability-comparison.md .oceanus/spec/sisyphus-contract-optimization.md; then exit 1; else exit 0; fi`；再执行 `grep -qE "Sisyphus.*Intake|Never delegate Metis for Intake" src/skills/sisyphus-intake.ts .oceanus/spec/sisyphus-contract-optimization.md && grep -qE "SOLUTION_ANALYSIS|条件使用 @metis" src/skills/sisyphus-brainstorm.ts && grep -qE "Momus.*evidence|tests.*completionMatrix|humanReview: conditional" src/skills/sisyphus-review.ts .oceanus/spec/sisyphus-contract-optimization.md && grep -qE "Review v1|Ledger|workspaceRef|decideFinish|不测试|不构建|不调用 CBM|不委派" src/skills/sisyphus-finish.ts`; 并执行 `if grep -nE "@metis.*执行.*INTAKE|@metis.*完成.*INTAKE" src/skills/sisyphus-intake.ts; then exit 1; else exit 0; fi`，确认 Metis 不执行 Intake；任一锚点缺失退出 1。C14 不运行阶段测试。

### C17：修复第二轮 Review 阻塞契约

- Wave：9
- Depends on：C11R
- Files：`src/agents/sisyphus.ts`、`src/skills/sisyphus-intake.ts`、`src/skills/sisyphus-review.ts`、`src/skills/sisyphus-finish.ts`、`src/tools/task/contract.ts`、`src/index.ts`、`README.md`、`docs/three-way-capability-comparison.md`
- Owner：契约修复代理；只修改上述生产代码/文档，禁止修改测试、progress、review。
- 目标：清除 Agent 阶段细节；统一 Intake/Review `humanReview: conditional`；修正 Review 报告路径；补 Finish 的可用收口接线与 Ledger 必填约束；修复 contract 非法输入/状态枚举的结构化诊断；清理全部旧阶段文案。
- 验证命令：目标测试先行由 C18 提供；随后运行 `bun test src/agents/index.test.ts src/agents/cbm-usage.test.ts src/skills/stages.test.ts src/tools/task/contract.test.ts`、`bun run typecheck`。

### C18：补第二轮 Review 阻塞回归测试

- Wave：9
- Depends on：C11R
- Files：`src/agents/index.test.ts`、`src/agents/cbm-usage.test.ts`、`src/skills/stages.test.ts`、`src/tools/task/contract.test.ts`
- Owner：回归测试代理；只修改上述测试，禁止修改生产代码、文档、progress。
- 目标：先行 RED 覆盖 Oracle 发现的 Agent 阶段细节、Intake/Review humanReview、报告路径、Finish 必填 Ledger/运行时收口、非法 contract 输入和全部旧文案扫描。
- 验证命令：同四文件 `bun test`，先记录 RED，再在 C17 后转 GREEN。

### C19：第三轮 Review

- Wave：10
- Depends on：C17、C18
- Files：`.oceanus/review/<plan-name>.md`（唯一写入）；其余源码、测试、plan、progress 只读
- Owner：主会话 Review owner；重新执行完整验证、覆盖 Oracle findings，并确保矩阵与 Ledger 一致。
- 验证命令：`bun run typecheck && bun test && bun run build && bun scripts/verify-dist-skills.ts`。

### C14R：修复 Skill 验证脚本 Intake 断言

- Wave：6
- Depends on：C14
- Files：`scripts/verify-dist-skills.ts`
- Owner：验证脚本修复代理；只修改该文件，禁止修改源码、测试、progress。
- 目标：移除 `sisyphus-intake` 必须包含 `@metis` 的旧断言，改为验证 Sisyphus Intake 责任边界；保持其他六阶段 Skill 验证。
- 验证命令：`bun run build && bun scripts/verify-dist-skills.ts`，并以正向 Sisyphus Intake 锚点和负向 Metis Intake 断言验证通过。

### C15：补责任边界回归测试（先行 RED）

- Wave：6
- Depends on：C10
- Files：`src/agents/index.test.ts`、`src/agents/cbm-usage.test.ts`、`src/skills/stages.test.ts`
- Owner：回归测试代理；只修改上述测试文件，禁止修改生产代码、文档和 progress。
- 目标：先用纯协议 fixture/Prompt 写出预期失败的断言（RED），再由 C14 实现后转 GREEN；不声称真实运行时调用（不声称真实运行时调用）：Intake 路由规则为 0 次 Metis；Brainstorm 在候选方案已定时为 0 次，在已有 Intake+澄清后仍未决且主 Agent 明确需要时为 1 次 SOLUTION_ANALYSIS，并要求复用 Intake report；需求变化时允许重新分析；同时断言六阶段引用、Agent 无阶段细节、Plan 双门禁、Review Momus 证据职责、Finish 输入和禁止动作。
- 验证命令：`bun test src/agents/index.test.ts src/agents/cbm-usage.test.ts src/skills/stages.test.ts`（C15 预期 RED；C14 完成后同命令必须 GREEN）。

### C15R：收口旧 humanReview 断言

- Wave：6
- Depends on：C14
- Files：`src/skills/stages.test.ts`
- Owner：回归测试代理；只修改该测试文件，禁止修改生产代码、文档和 progress。
- 目标：将 C15 中遗留的 Review `humanReview: required` 旧断言更新为当前 `conditional` 契约，并保留 C15 的 RED 证据与 C14 的 GREEN 验证。
- 验证命令：`bun test src/agents/index.test.ts src/agents/cbm-usage.test.ts src/skills/stages.test.ts`，必须全部通过。

### C6R：修复 Review 发现的历史阶段表述

- Wave：4
- Depends on：C6
- Files：`README.md`、`src/skills/index.ts`
- Owner：文档修复代理；只修正阶段数量/Skill 数量旧注释，不改变流程逻辑；禁止修改其他文件。
- 目标：清除 README 的“五阶段”及 Skill 聚合注释的“四个阶段”表述，统一为六阶段和六个阶段 Skill。
- 验证命令：`bun test src/skills/stages.test.ts && bun scripts/verify-dist-skills.ts`。

### C12：登记最终 Review 与 Ledger 状态

- Wave：8
- Depends on：C11R
- Files：`.oceanus/progress/sisyphus-contract-optimization.md`
- Owner：主会话（含 C14R 收口）；只更新 C10/C11R/C14/C15/C15R/C14R/C17/C18/C19/C12 的终态、当前 workspace ref 和证据，不修改源码。
- 目标：将第二轮 Review 结果和全部任务终态写入 Ledger，并确认人工表格与 JSON 一致。
- 验证命令：重复 C10 的 Python JSON/人工表格一致性脚本；Ledger 中当前全部 taskId（C1,C2,C3,C4,C5,C6,C6R,C8,C9,C10,C14,C15,C15R,C14R,C11R,C17,C18,C19,C12）全部为终态。

### C13：取消旧 Metis Intake 修复任务（历史记录，不进入当前 Ledger）

- State：cancelled（用户确认 Intake 由 Sisyphus 完成）
- 不执行，不纳入 C11R 依赖；保留本记录用于审计。

### C11R：修复后第二轮 Review

- Wave：7
- Depends on：C14R、C15R
- Files：`.oceanus/review/<plan-name>.md`（唯一写入）；`src/**`、`README.md`、`docs/**`、`.oceanus/plan/**`、`.oceanus/progress/**`（只读）
- Owner：主会话 Review owner；可调度只读 subagent 和 Momus，不修改源码、测试或 ledger。
- 目标：C14/C14R/C15/C15R 后实际重跑全量验证，完成第二轮 Review，覆盖上一轮 `REVIEW_REJECT`，写入新的 Review v1 报告；completionMatrix 必须唯一覆盖全部 16 个当前 taskId，Review/矩阵/tests 的 workspaceRef 必须匹配当前工作区且为新鲜证据，不得存在 `blocking: true` finding；C12 行仅记录待 Review 后执行的 Ledger 收口交接，不提前声称完成；Finish 只消费新报告。
- 验证命令：`bun run typecheck`、`bun test`、`bun run build`、`bun scripts/verify-dist-skills.ts`，并记录新证据。

## Momus 计划门禁

待本计划写入后委派 @momus。只有 `OKAY` 才能进入 Execute；`REJECT` 必须回到 Plan 修订。由于本计划涉及多文件和运行时校验，不能跳过该门禁。C6R 是 Review 发现后的计划修订，必须重新过门禁。

本轮修订：第 6 轮 Momus REJECT 后，已同步 C10 的 16 项校验、C12 Wave 8、C14R 串行修复与 C15R 并行 GREEN、Review 矩阵覆盖和 workspace freshness 验收。
