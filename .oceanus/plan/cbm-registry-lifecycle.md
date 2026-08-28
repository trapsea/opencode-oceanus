# Plan：CBM 规则注册表 + 三阶段主线闭环

Spec: `.oceanus/spec/cbm-registry-lifecycle.md`
策略：TDD（契约测试先行 RED→GREEN）；Worktree：共享工作区（Wave 内 Files 零重叠，见用户确认）

## Tasks

### T1 · Wave 1 · 注册表模块
- **Goal**: 新建 CBM 单一来源注册表：`CBM_TOOLS`（7 工具名）、`CBM_QUERY_EXAMPLES`（OrderHandler 示例族）、`CBM_LIFECYCLE`（三阶段主线文本：intake 初始化 → momus 影响面预估 → review 影响面复查）、`cbmSection(role)`（explorer/oracle/fixer/librarian/momus/metis 角色段落，含公共边界句与 fail-open 降级）。
- **Files**: `src/cbm/registry.ts`、`src/cbm/registry.test.ts`
- **Depends on**: 无
- **Validation**: RED→GREEN：`registry.test.ts` 先失败后通过（断言导出齐全、工具名 `cbm_` 前缀规范、主线三阶段关键词、角色段落差异化内容与证据句）；`bun test src/cbm/registry.test.ts` 绿。

### T2 · Wave 2 · Agent prompts 接入注册表
- **Goal**: 删除 agents 硬编码 CBM 文本，改为 import 注册表；momus 新增影响面预估 checklist（`cbm_search_graph`→`cbm_trace`→`cbm_code` 排查计划修改符号、计划外受影响调用方/契约 → REJECT、结论写入 plan status、只查询不建索引、fail-open）；sisyphus `buildCbmPhaseBoundary` 用 `CBM_LIFECYCLE` 且 momus 门禁条目补影响面预估；oceanus CBM 调度段同源化；metis 补简短查询段。
- **Files**: `src/agents/{sisyphus,oceanus,momus,explorer,oracle,fixer,librarian,metis}.ts`、`src/agents/{cbm-usage,index}.test.ts`
- **Depends on**: T1
- **Validation**: 更新后的 `cbm-usage.test.ts`/`index.test.ts` 全绿；momus prompt 含影响面排查与 REJECT 判定；`## CBM 阶段边界` 在 sisyphus prompt 只出现一次；工具名负向断言（`(?<!cbm_)search_graph` 等）不破。

### T3 · Wave 2 · Skills 主线同步
- **Goal**: `sisyphus-plan.ts` momus 审查清单加"影响面预估"项 + 结论（预估影响面+差异）记入 plan status；`sisyphus-review.ts` Step 1 扩为"cbm_index 重建 → 实际 diff 影响面复查（cbm_trace/cbm_detect_changes）→ 与 momus 预估对比（一致记证据/不一致解释或退回 execute）"；intake/brainstorm/execute/finish 措辞对齐主线（逻辑不变）。
- **Files**: `src/skills/{sisyphus-plan,sisyphus-review,sisyphus-intake,sisyphus-brainstorm,sisyphus-execute,sisyphus-finish}.ts`、`src/skills/stages.test.ts`
- **Depends on**: T1
- **Validation**: 更新后的 `stages.test.ts` 全绿（plan 含影响面项断言、review 含三步复查+对比断言、既有 CBM-04 负向断言不破）。

### T4 · Wave 2 · 工具层与测试同源化
- **Goal**: `tools/cbm/builders.ts` 工具名清单改 import `CBM_TOOLS`（消除重复定义）；同步引用工具清单的测试文件改为注册表驱动断言。
- **Files**: `src/tools/cbm/builders.ts`、`src/tools/cbm/builders.test.ts`、`src/tooling-registration.test.ts`、`src/tooling-integration.test.ts`、`src/smoke/host-smoke.test.ts`
- **Depends on**: T1
- **Validation**: 上述测试全绿；`builders.ts` 中不再有独立工具名数组字面量（grep 验证）。

### T5 · Wave 2 · 文档同步
- **Goal**: README.md CBM 段与 docs/codebase-memory-mcp.md 工作流段补齐三阶段主线（intake 初始化 → momus 影响面预估 → review 复查对比）。
- **Files**: `README.md`、`docs/codebase-memory-mcp.md`
- **Depends on**: 无
- **Validation**: 文档表述与注册表 `CBM_LIFECYCLE` 一致；提及 momus 预估与 review 对比。

### T6 · Wave 3 · 全量验证与完成审计
- **Goal**: 全量 `bun test`；typecheck（tsc --noEmit）；覆盖率矩阵核对验收标准 4 条；权限回归确认（momus `cbm_index: deny`、查询 allow）。
- **Files**: 无新改动（验证任务）
- **Depends on**: T2、T3、T4、T5
- **Validation**: 测试/类型全绿；权限断言（`agents/index.test.ts` 现有权限测试）通过；完成审计矩阵全绿。

## 调度说明
- Wave 1 串行（T1 是共享依赖）。
- Wave 2 四任务并行：Files 零重叠（agents/ vs skills/ vs tools/+测试 vs docs/README），共享工作区安全。
- Wave 3 串行收尾。
- 共享工作区约束：worker 不跑 git add/commit/reset、不越界改 Files 之外文件；编排器串行提交。
