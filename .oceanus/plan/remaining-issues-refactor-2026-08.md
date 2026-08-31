# Oceanus 剩余问题修复计划（最终唯一版本）

## Scope

修复问题 3-18；问题 1/2 只做回归验证。本文替代此前所有 R1-R5、Revision、Correction 计划。

## Decisions and constraints

- 共享工作区；保留执行前已有未提交改动。流程文件由主 Agent 维护，worker 不修改 `.oceanus/**`。
- 双门禁为 Prompt/状态闭环：`question` 返回 APPROVED/NEEDS_CHANGES/CANCELLED，沉默为 PENDING；Plan 写 `Gate Status`；Execute 前必须 Momus OKAY 且 human APPROVED。不新增宿主运行时拦截。
- CBM CLI 优先 `--args-file`，其次 stdin JSON，最后仅在明确 unknown option/unsupported args-file/stdin 时 raw JSON fallback；业务非零、timeout、invalid JSON 不回退。
- CBM Review 预算：首次 30s，starting/in-progress/timeout 最多一次 60s 重试，总计 90s；仍失败返回 stale 降级，不伪造 indexed。Indexer 的 `IndexStatusKind` 为 `indexed|unindexed|starting|unknown`；starting 携带 `attempt: 1|2`、`elapsedMs`。
- Evidence：strict=RED+GREEN+real-surface；light=test-after+测试；exempt=白名单+理由；公共符号/高风险变更升级 strict。

## Baseline and verification

执行前记录 `git status --short` 与 `git diff --binary` 为会话证据。每个任务只修改 Files owner；任务完成后检查 `git diff --name-only`、`git diff --check` 和既有 hunks。最终运行 `bun test`、`bun run typecheck`、`bun run build`；真实 Host/CLI 无法运行时明确记录 skip。

## Tasks (strict serial order)

### P1 Agent 协议与边界（问题 3、6、8、15、16 部分）

Files owner：`src/agents/protocol.ts`、`src/agents/oceanus.ts`、`src/agents/sisyphus.ts`、`src/agents/metis.ts`、`src/agents/orchestrator-context.ts`、`src/agents/protocol.test.ts`、`src/agents/prompt-sections.test.ts`、`src/agents/index.test.ts`、`src/agents/orchestrator-context.test.ts`、`src/agents/cbm-usage.test.ts`。

实现公共协议单一来源、Metis trigger、disabledAgents、sections/Verify 回归、resolvePrompt/DelegationBrief 语义；同步清除 `oceanus.ts`/`sisyphus.ts` 中 Momus 执行完整 CBM 影响面扫描的旧文案，改为 Plan impact_estimate 责任引用；测试公共协议唯一来源、全禁用矩阵和问题 1/2。

### P2 Skill 文本质量（问题 4、13、14、16 部分）

Files owner：`src/skills/sisyphus-brainstorm.ts`、`src/skills/sisyphus-intake.ts`、`src/skills/stages.test.ts`。

修正 Brainstorm/Intake 编号、缩进、占位符和工具参数标点边界；测试明确断言两个文件的 `## Steps` 为 1..N 连续编号、无重复 `2.`、无异常前导空格、工具调用示例使用 ASCII 标点。其它 Skill 的 description/frontmatter 与格式归 P3/P4/P5/P6 各自 owner，不在 P2 修改。

### P3 Plan 双门禁与 impact estimate（问题 5、9）

Files owner：`src/skills/sisyphus-plan.ts`、`src/skills/gate.test.ts`。

实现 APPROVED/NEEDS_CHANGES/CANCELLED/PENDING、Gate Status、Plan-Change 重审和 Sisyphus impact_estimate；同时修正本文件 `## Steps` 为 1..8 连续编号和 frontmatter/TS description 重复字段。测试四种批准状态、缺失/覆盖不足影响面、Momus 放行条件、编号和字段唯一性。

### P4 Execute evidence tier（问题 11）

Files owner：`src/skills/sisyphus-execute.ts`、`src/skills/evidence.test.ts`。

实现 strict/light/exempt 选择、门禁前置检查、stale evidence 和高风险升级；同时校验 Execute skill 的 frontmatter/TS description 无重复字段。测试三档 tier、证据缺失、升级、重新 Plan 和字段唯一性。

### P5 Review CBM budget（问题 12）

Files owner：`src/skills/sisyphus-review.ts`、`src/skills/review-budget.test.ts`。

实现纯文档跳过、30s 初次 + 60s 一次重试 + 90s 总预算、stale fail-open、Completion Audit tier 校验；同时校验 Review skill 的 frontmatter/TS description 无重复字段。所有 Review 文案和测试归 P5，P9 不修改 Review 文件。

### P6 Finish 判定（问题 10）

Files owner：`src/skills/sisyphus-finish.ts`、`src/skills/finish.test.ts`。

删除 `decideFinish`，以 Review 存在、矩阵全绿、ledger 无 failed/blocked/pending、Gate 无 PENDING 进行自包含判定；同时校验 Finish skill 的 frontmatter/TS description 无重复字段。测试所有缺失和全绿组合及字段唯一性。

### P7 Momus/CBM 文案（问题 9、12）

Files owner：`src/agents/momus.ts`、`src/cbm/registry.ts`、`src/cbm/registry.test.ts`。

Momus 改为校验 Plan impact_estimate 覆盖，不执行完整 CBM trace；同步 registry 文案。验证命令：`bun test src/cbm/registry.test.ts`。

### P8 CBM CLI 兼容（问题 17）

Files owner：`src/tools/cbm/cli.ts`、`src/tools/cbm/types.ts`、`src/cbm/process.ts`、`src/tools/cbm/cli.test.ts`。

实现 args-file/stdin/raw fallback、unsupported 条件判断、stderr warning 分离和临时文件清理；测试三种调用、业务失败不回退、timeout/invalid JSON 和清理。

### P9 CBM 状态机（问题 18）

Files owner：`src/cbm/indexer.ts`、`src/cbm/commands.ts`、`src/cbm/guidance.ts`、`src/hooks/cbm-guidance.ts`、`src/cbm/indexer.test.ts`、`src/cbm/guidance.test.ts`、`src/hooks/cbm-guidance.test.ts`。

实现精确类型：`IndexStatusKind = 'indexed' | 'unindexed' | 'starting' | 'unknown'`；`IndexStatusInfo = { kind: 'indexed' | 'unindexed' } | { kind: 'starting'; attempt: 1 | 2; elapsedMs: number } | { kind: 'unknown'; errorCode?: IndexStatusErrorCode; errorMessage?: string }`；`IndexerOutcome = { kind: 'indexed' } | { kind: 'index_started' } | { kind: 'starting'; attempt: 1 | 2; elapsedMs: number } | { kind: 'skipped_auto_index_disabled' } | { kind: 'skipped_no_project' } | { kind: 'degraded'; reason: 'index_failed' | 'index_status_failed' | 'exception'; status?: 'stale'; previous?: 'starting'; attempts?: 1 | 2; elapsedMs?: number; errorCode?: IndexStatusErrorCode; message?: string }`。状态优先级为 indexed > starting > unindexed > unknown，真实 failed/timeout/invalid JSON 不得转为 starting。只修改状态传播/guidance，不修改 Review。P9 测试只验证 Indexer 自身的 attempt/elapsedMs 和状态转换，不验证 Review 的 cbm_index 预算；Review 30s+60s+90s 预算只由 P5 测试。

### P10 文档与最终审计（全部问题）

Files owner：`docs/prompt-workflow-review-2026-08.md`、`docs/tooling-and-runtime.md`。

更新 1-18 实际状态、实施证据、真实 Host/CLI 限制和工具/hook 数量。

## Test commands

- P1-P2：`bun test src/agents src/skills/stages.test.ts`
- P3-P7：`bun test src/skills/gate.test.ts src/skills/evidence.test.ts src/skills/review-budget.test.ts src/skills/finish.test.ts src/cbm/registry.test.ts`
- P8：`bun test src/tools/cbm/cli.test.ts`
- P9：`bun test src/cbm/indexer.test.ts src/cbm/guidance.test.ts src/hooks/cbm-guidance.test.ts`
- Final：`bun test`、`bun run typecheck`、`bun run build`、`git diff --check`

## Gate Status

- Momus verdict：OKAY
- Momus round：1
- Human approval：APPROVED
- Impact estimate：CBM 当前 daemon 接入失败，使用静态调用方证据；受影响入口为 `runCbmCli`、`IndexerOutcome`、commands、guidance 和 Agent prompt builders。

## Review Follow-up Plan（P11-P14）

Review 已确认 P1-P10 的基础测试通过，但发现以下必须补修的实现缺口。P11-P14 是当前唯一待执行任务，依赖 P10，按顺序串行执行；不重做已通过的任务。

### P11 Finish 严格默认拒绝

Files owner：`src/skills/sisyphus-finish.ts`、`src/skills/finish.test.ts`。

导出纯函数 `decideFinish(input: FinishInput): FinishDecision`；`FinishInput` 至少包含 `reviewStatus: 'accepted' | 'rejected' | 'missing'`、`completionMatrix: 'green' | 'gaps' | 'missing'`、`ledger: 'complete' | 'pending' | 'failed' | 'blocked'`、`momus: 'OKAY' | 'REJECT' | 'PENDING'`、`human: 'APPROVED' | 'NEEDS_CHANGES' | 'CANCELLED' | 'PENDING'`、`evidence: 'fresh' | 'stale' | 'missing'`；`FinishDecision` 为 `{ done: true; gaps: [] }` 或 `{ done: false; gaps: string[] }`。只有 accepted/green/complete/OKAY/APPROVED/fresh 全部满足才完成；所有其它状态默认拒绝。补纯判定函数和完整状态矩阵测试。

### P12 CBM CLI 进程与错误契约

Files owner：`src/tools/cbm/cli.ts`、`src/cbm/process.ts`、`src/tools/cbm/types.ts`、`src/tools/cbm/cli.test.ts`。

保持现有 `CbmCliResult` 的 `ok/data/tool/error/truncated/truncatedReason` 公共字段兼容，并保留 `error.exitCode?: number`；仅扩展或统一内部错误码为 `timeout`、`spawn_failed`、`exit_nonzero`、`invalid_json`、`output_oversize`、`internal`、`unsupported_input`，不得删除消费者依赖字段；确保 stdout 结束但进程/stderr 未结束时仍受 timeout 约束并清理 timer；CLI 内部异常、JSON.stringify 失败和安装失败统一为 `internal`，不抛出；unsupported 只匹配明确 option/args-file/stdin unsupported 文本，`invalid argument` 不回退；覆盖 trace canonical fallback 的旧 CLI 组合。P12 只修改 CLI/process/types 及 CLI 测试，消费者迁移和 `normalizeIndexStatus`/`normalizeListProjects` 对 `truncatedReason`/`exitCode` 的兼容验证归 P13。测试必须包含公共字段保留、`error.exitCode` 保留、stdout 已结束而 stderr/进程未结束、invalid argument 不回退、旧 trace_path 组合、错误码和资源清理。

### P13 Indexer 查询放行与 starting/stale 闭环

Files owner：`src/cbm/indexer.ts`、`src/tools/cbm/builders.ts`、`src/cbm/commands.ts`、`src/cbm/guidance.ts`、`src/hooks/cbm-guidance.ts`、`src/cbm/indexer.test.ts`、`src/cbm/guidance.test.ts`、`src/hooks/cbm-guidance.test.ts`、`src/tools/cbm/builders.test.ts`。

统一 `IndexerOutcome` 精确联合类型，禁止 `index_started` 直接视为 indexed；查询 guard 不得放行 stale/starting 为 fresh indexed，必须传播 `status: 'starting' | 'stale'`、`attempt: 1 | 2`、`elapsedMs` 并给出 grep/read fallback；`checkedIndex` 状态按项目/session 保存最近 attempt，starting 时允许同一 session 恰好一次 attempt 2，stale 后才永久去重；保留项目隔离和最多一次重试。覆盖 starting→indexed、starting→stale、guard fallback、缓存不完整和 session attempt 2。

### P14 协议与命令文案一致性

Files owner：`src/agents/protocol.ts`、`src/agents/oceanus.ts`、`src/agents/sisyphus.ts`、`src/config/constants.ts`、`src/agents/index.ts`、`src/agents/index.test.ts`、`src/agents/cbm-usage.test.ts`、`src/cbm/registry.ts`、`src/cbm/commands.ts`、`src/cbm/guidance.ts`、`src/cbm/wiring.ts`、`src/index.ts`、`src/tools/index.ts`、`src/tools/cbm/index.ts`、`docs/codebase-memory-mcp.md`、`src/agents/protocol.test.ts`、`src/cbm/registry.test.ts`、`src/cbm/commands.test.ts`、`src/cbm/guidance.test.ts`、`src/hooks/cbm-guidance.test.ts`。

统一 starting→stale、fail-open、Review/Plan 的职责词汇；删除 Agent 重复协议；Metis 不默认允许 cbm_index；文案统一指向已注册的 `cbm_index` 工具，明确不新增或宣称存在 `/cbm index` 命令；同步 createAgents、registerOceanusTools、buildCbmTools 和 buildCbmSharedDeps 的实际权限/注册边界；更新 `src/cbm/guidance.test.ts`、`src/hooks/cbm-guidance.test.ts`、`src/agents/cbm-usage.test.ts` 中过时的 `/cbm index`、`indexing in progress`、`in-progress` 断言，使测试锁定新术语；新增命令/协议一致性测试。真实 daemon/Host 仍只记录为未验证，不伪造成功。

### P15 最终文档与影响面审计

Files owner：`docs/prompt-workflow-review-2026-08.md`、`docs/tooling-and-runtime.md`；`.oceanus/review/Review v1.md` 由主 Agent 独占维护，worker 不修改任何 `.oceanus/**` 文件。

在 P11-P14 后重新核对问题 1-18、工具/Hook 数量和命令注册状态；主 Agent 在 Review 报告中记录实际 `cbm_index`/`cbm_detect_changes`/`cbm_search_graph` 调用响应中的原始错误 `index_status_failed:unparsed_status`、会话时间戳、降级方式、静态 qualified name/调用方清单、与计划 impact estimate 的差异及残余风险。P15 不得把 mock/fake/静态证据写成真实 Host/daemon 成功。

### Follow-up acceptance and impact estimate

- P11 必须证明所有负向 Gate 状态默认拒绝；P12 必须证明超时最终收敛且不误回退；P13 必须证明查询不会把异步/陈旧索引当 fresh；P14 必须证明 prompt、registry、guidance、commands 术语与注册表一致。
- 静态影响面：`SISYPHUS_FINISH_SKILL`、`runCbmCli/runPass`、`createIndexer/guardForQuery/ensureIndexed`、`createCbmGuidanceHook`、`registerOceanusHooks`、`METIS_DEFAULT_PERMISSION`、`createCbmCommand`、`createAgents`、`registerOceanusTools`、`buildCbmTools`、`buildCbmSharedDeps`。CBM 查询若仍不可用，主 Agent 在 `.oceanus/review/Review v1.md` 记录原始响应、会话时间、qualified name/路径/行号、静态调用方和残余不确定性。

## Gate Status（Review Follow-up）

- Momus verdict：OKAY
- Momus round：1
- Human approval：APPROVED
