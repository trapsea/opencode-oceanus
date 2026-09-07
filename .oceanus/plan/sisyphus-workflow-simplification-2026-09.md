# Sisyphus 工作流简化与调研协议优化

状态: draft
Spec: `.oceanus/spec/sisyphus-workflow-simplification-2026-09.md`

## 全局约束

- 当前目录执行；不创建 worktree，不运行 git add/commit/reset。
- 每个任务只修改声明的 Files；worker 不修改共享 ledger。
- TDD 开启：先更新契约测试，再实现对应 prompt/skill/doc。
- Oracle 仅按需调用，不作为固定门禁；Momus 已按用户选择关闭，不伪造 OKAY。

## 文件变更地图

- 核心编排：`src/agents/sisyphus.ts`、`src/agents/protocol.ts`、`src/agents/orchestrator-context.ts`
- 调研 agent：`src/agents/explorer.ts`、`src/agents/librarian.ts`
- 阶段 skill：`src/skills/oceanus-intake.ts`、`src/skills/oceanus-brainstorm.ts`、`src/skills/oceanus-plan.ts`、`src/skills/oceanus-execute.ts`、`src/skills/oceanus-review.ts`、`src/skills/oceanus-finish.ts`
- Oracle/CBM：`src/agents/oracle.ts`、`src/review/scenes.ts`、`src/cbm/registry.ts`
- 测试：`src/agents/orchestrator-context.test.ts`、`src/agents/oracle.test.ts`、`src/agents/cbm-usage.test.ts`、`src/skills/gate.test.ts`、`src/skills/evidence.test.ts`、`src/skills/review-budget.test.ts`、`src/skills/finish.test.ts`、`src/review/scenes.test.ts`
- 文档/检查：`README.md`、`AGENTS.md`、`docs/tooling-and-runtime.md`、`docs/codebase-memory-mcp.md`、`scripts/verify-dist-skills.ts`

## Tasks

### T1 — 研究结果协议与契约测试

- Wave: 1; Depends on: —; 预估 diff: 120 行
- Files: `src/agents/orchestrator-context.ts`, `src/agents/orchestrator-context.test.ts`, `src/agents/explorer.ts`, `src/agents/librarian.ts`
- 动作：扩展 ResearchBrief 与格式化输出；定义统一研究结果字段；强化 Explorer/Librarian 的证据、版本、负向结果、阻塞和 findings 交接要求。
- Validation: `bun test src/agents/orchestrator-context.test.ts src/agents/explorer-permission.test.ts`; 预期通过且覆盖新字段。

### T2 — Sisyphus 核心路由精简

- Wave: 2; Depends on: T1; 预估 diff: 180 行
- Files: `src/agents/sisyphus.ts`, `src/agents/protocol.ts`
- 动作：删除固定 Oracle gate 与双门禁描述；保留六阶段入口/出口、自查、按需 Oracle 触发条件、连续执行边界和 CBM 阶段边界。
- Validation: `bun test src/skills/gate.test.ts src/agents/cbm-usage.test.ts`; 预期不含 plan-gate 放行要求，保留阶段顺序和按需 Oracle 锚点。

### T3 — Intake/Plan/Execute/Review/Finish 衔接迁移

- Wave: 2; Depends on: T2; 预估 diff: 420 行
- Files: `src/skills/oceanus-intake.ts`, `src/skills/oceanus-plan.ts`, `src/skills/oceanus-execute.ts`, `src/skills/oceanus-review.ts`, `src/skills/oceanus-finish.ts`, `src/skills/gate.test.ts`, `src/skills/evidence.test.ts`, `src/skills/review-budget.test.ts`
- 动作：移除 Oracle 门禁依赖、SKIPPED_BY_USER 门禁状态和 plan-gate 对比；改为 Sisyphus 自查与按需 Oracle 记录；修正阶段输入/输出和连续执行配置。
- Validation: 对应 skill 契约测试；预期不再要求 Oracle verdict，Review/Finish 仍保持证据化和只读边界。

### T4 — Oracle 场景与 CBM 语义收敛

- Wave: 3; Depends on: T2, T3; 预估 diff: 220 行
- Files: `src/agents/oracle.ts`, `src/review/scenes.ts`, `src/review/scenes.test.ts`, `src/agents/oracle.test.ts`, `src/cbm/registry.ts`
- 动作：将 Oracle 场景从 gate 审核语义收敛为 consult/analysis；保留 spec/plan 上下文质量、风险与建议输出；清理 plan-gate 作为固定生命周期节点的描述。
- Validation: `bun test src/agents/oracle.test.ts src/review/scenes.test.ts`; 预期场景单一来源仍成立，禁止固定放行语义。

### T5 — 文档、dist 检查与全量回归

- Wave: 4; Depends on: T1, T2, T3, T4; 预估 diff: 260 行
- Files: `README.md`, `AGENTS.md`, `docs/tooling-and-runtime.md`, `docs/codebase-memory-mcp.md`, `scripts/verify-dist-skills.ts`, `src/skills/finish.test.ts`
- 动作：同步新工作流契约、按需 Oracle 边界、研究输出协议和 SDD 产物说明；更新 dist 检查锚点。
- Validation: `bun run typecheck && bun test && bun run build && bun run check:dist && bun run check`; 全部通过。

## 影响面预估

- `sisyphus` prompt 影响其六阶段 skill 消费与所有 Sisyphus 工作流契约测试。
- `ResearchBrief/formatResearchBrief` 影响其测试及编排 prompt 的调研委派格式。
- `REVIEW_SCENES`/CBM 生命周期文本影响 Oracle 测试、场景测试和文档锚点；不改变宿主 API。
- 旧 plan-gate 测试需迁移为“按需 Oracle/自查”负向断言，避免残留固定门禁。

## 计划自查

- [x] Spec 唯一路径且已批准
- [x] 任务按依赖排序，文件范围声明且无同 Wave 重叠
- [x] 每项有验证命令、预期结果和预估 diff
- [x] Momus 按用户选择关闭，已记录残余风险
- [x] 无需 Oracle 固定 verdict；复杂场景按需调用由 Sisyphus 决定
