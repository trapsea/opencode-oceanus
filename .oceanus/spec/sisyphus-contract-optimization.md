# Sisyphus 阶段契约与审核优化设计

## 已确认决策

- 新增 `sisyphus-finish` Skill；Finish 只读取 Review 报告并收口，不重新测试、构建或分派 subagent。
- Agent 定义只保留全局角色、六阶段顺序、Skill 加载和跨阶段不变量；阶段细节下沉到对应 Skill。
- Plan 顺序固定为：Plan → Momus `PLAN_OKAY` → 用户人工批准 → Execute。
- Review 分派 subagent 执行独立只读检查，测试由 Review 主流程统一执行；Momus 审核实现证据和验收覆盖，Sisyphus 做最终 `REVIEW_OKAY/REJECT` 判定；高风险问题仍可交给 Oracle。
- 任务依赖和证据状态采用“两层方案”：结构化 Markdown ledger + 插件侧解析/校验；不改宿主 task 调度器，依赖门禁明确为 advisory。
- Sisyphus：Intake 只执行一次并直接持有主上下文；Metis 不参与 Intake，仅在候选方案仍未决且主 Agent 明确需要独立分析时显式执行 `SOLUTION_ANALYSIS`，必须复用既有 Intake 报告；需求实质变化时重新分析。

## 六阶段统一契约

每个阶段 Skill 必须声明固定的 8 个字段：`input`、`owner`、`output`、`entry`、`exit`、`failure`、`verification`、`humanReview`。字段值均为非空字符串或非空字符串数组；`humanReview` 允许值为 `required`、`conditional`、`none`。六阶段名称和顺序固定，不允许 Skill 自行新增阶段。

| 阶段 | 主责 | 输出 | 门禁 |
|---|---|---|---|
| Intake | Sisyphus | `intake_report` | 分类完成，CBM 状态诚实记录 |
| Brainstorm | Sisyphus | 用户批准的 spec | 用户批准设计 |
| Plan | Sisyphus + Momus | plan、ledger、`PLAN_OKAY` | Momus 通过后用户批准 |
| Execute | Sisyphus + workers | 变更和逐任务证据 | 任务按 ledger 状态收口 |
| Review | Sisyphus + subagents + Momus | Review 报告、Completion Matrix | 测试完成且 `REVIEW_OKAY`；高风险场景人工介入 |
| Finish | Sisyphus | 最终收口报告 | 仅接受有效的 `REVIEW_OKAY` |

## 结构化 ledger

每个任务至少包含：`taskId`（唯一非空字符串）、`wave`（正整数）、`dependsOn`（非空字符串数组，可为空数组）、`files`（非空字符串数组，可为空数组）、`state`（`pending|in_progress|completed|failed|blocked`）、`evidence[]`、`owner`（非空字符串）、`updatedAt`（ISO-8601 UTC）。Ledger 根对象和每条 evidence 的 `workspaceRef` 固定为 `{ gitHead: string|null, dirty: boolean }`；`dirty` 指实现范围文件是否有未提交变化，排除 `.oceanus/progress/` 与 `.oceanus/review/` 元数据文件。证据至少包含：`kind`、`status`（`missing|unverified|verified|stale|degraded`）、`source`、`command`（字符串）、`exitCode`（整数或 null）、`timestamp`（ISO-8601 UTC）、`workspaceRef`、`note`；未知字段允许保留但不参与校验，重复 taskId、缺失必填字段和旧版本必须返回诊断。

依赖校验包括缺失依赖、循环依赖、失败/阻塞上游和文件范围冲突。证据状态至少包括 `missing`、`unverified`、`verified`、`stale`、`degraded`。运行时校验只提供 advisory 结果，不宣称能阻止宿主调度。

Ledger 使用 `<!-- sisyphus-ledger:v1 -->` JSON block 作为机器可读权威数据，同时保留 Markdown 表格作为人类视图。统一使用 camelCase 字段：`taskId`、`dependsOn`、`updatedAt`、`workspaceRef`。Review 使用 `<!-- sisyphus-review:v1 -->` JSON block；Finish 只读取 `REVIEW_OKAY`、workspace ref 匹配且 Completion Matrix 全绿的报告。

Review Report v1 固定为：`status`（`REVIEW_OKAY|REVIEW_REJECT`）、`plan`、`spec`、`generatedAt`（ISO-8601 UTC）、`workspaceRef`、`completionMatrix`、`findings`、`tests`、`residualUncertainty`。`completionMatrix` 行为 `{ criterion: string, taskId: string, evidence: string[], workspaceRef: WorkspaceRef, status: 'verified'|'missing'|'stale'|'degraded' }`；`findings` 项为 `{ severity: 'info'|'warning'|'error', summary: string, blocking: boolean }`；`tests` 项为 `{ command: string, exitCode: number, timestamp: string, workspaceRef: WorkspaceRef, status: 'passed'|'failed'|'skipped' }`；所有 tests 都必需且必须 passed，且 tests 数组非空；`residualUncertainty` 为字符串数组。所有根字符串字段、矩阵字符串字段、finding.summary、test.command 及字符串数组元素均不得为空。Review 生成报告前捕获 workspaceRef；Finish 计算 current workspaceRef 时排除 `.oceanus/progress/` 和 `.oceanus/review/` 元数据文件。报告过期定义为报告 workspaceRef 的 `gitHead` 或 `dirty` 与 current workspaceRef 不一致，或任一 gitHead 为 null；Ledger evidence 使用相同规则。`decideFinish` 接收同一计划的 Ledger；`completionMatrix` 必须覆盖 Ledger 中每个 taskId，且每个 taskId 只能出现一次；只有矩阵全 verified、无 blocking finding、所有 tests 均 passed 且 `gitHead`/`dirty` 完全匹配时才允许 `REVIEW_OKAY`；矩阵和 tests 均必须非空，空矩阵返回 `incomplete_matrix`，空 tests 返回 `tests_not_passed`，skipped 也返回 `tests_not_passed`。Finish 输入为报告文本和 `WorkspaceRef`，空文本返回 `missing_report`，缺 block/非法 JSON/字段类型错误返回 `invalid_report`，解析成功后按 `review_rejected|stale_report|incomplete_matrix|blocking_finding|tests_not_passed` 顺序返回全部适用 reasonCodes。Finish 返回 `{ status: 'COMPLETED'|'NOT_COMPLETED', reasonCodes: FinishReasonCode[] }`；诊断码固定为 `missing_report|invalid_report|review_rejected|stale_report|incomplete_matrix|blocking_finding|tests_not_passed`。

## Metis 分析

### 风险

- Prompt 仍不是运行时状态机；静态测试不能证明真实调用顺序。
- Ledger 状态与宿主 TaskRegistry 状态不能直接混合。
- 结构化解析可能遇到旧 ledger，必须支持明确的诊断而非静默通过。
- Finish 只读 Review 报告会放大 Review 报告格式和 freshness 的重要性。

### 边界/非目标

- 不改 CBM daemon、watcher、宿主 task 调度器或完整 TaskRegistry 生命周期。
- 不把 advisory 依赖校验描述为硬阻断。
- 不在 Finish 重跑测试、构建、CBM 或完整 Completion Audit。

### 验收标准

- 代码、测试、README 和验证脚本统一描述六阶段及六个阶段 Skill。
- Agent prompt 不再重复阶段详细步骤；各 Skill 有完整阶段契约。
- Intake 由 Sisyphus 完成且不调用 Metis；Metis 仅条件式执行 `SOLUTION_ANALYSIS`，无无条件重复调用。
- Plan 的 Momus 通过和用户批准均是 Execute 前置条件。
- Review 具备 subagent、Momus、测试和 Completion Matrix 契约。
- Finish Skill 只读取通过的 Review 报告并输出收口结果。
- Ledger 依赖和证据字段可解析，并能诊断缺失、循环、失败上游和过期证据。
- Finish 对缺失、`REVIEW_REJECT`、过期或不匹配 workspace ref 的报告返回未完成，不执行测试、构建、CBM 或 subagent。
