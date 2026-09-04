# 工具运行时名称对齐修复计划

## 状态

- Spec：`.oceanus/spec/tool-runtime-name-alignment.md`（用户已批准）
- Momus：第 1 轮 REJECT，已按 5 点意见修订；待第 2 轮审查
- TDD 策略：RED→GREEN→SURFACE（已确认）；Worktree 策略：共享工作区，不创建 worktree（已确认）
- 人工批准：待 Momus OKAY 后确认
- 保护范围：已有未提交改动不回退；不修改 `src/runtime/*`、`src/index.ts` 或插件工具注册逻辑。

## 影响面预估（第 1 轮 Momus CBM 查询结论，已吸收）

- 直接修改：`src/config/constants.ts`、`src/cbm/registry.ts`、`src/agents/explorer.ts`、`src/agents/fixer.ts`、`src/agents/librarian.ts`、`src/agents/oceanus.ts`，及测试 `src/agents/index.test.ts`、`src/tooling-registration.test.ts`。
- `READONLY_FILE_OPERATIONS_RULES` 消费方：observer、metis、momus、oracle、explorer、librarian（共 6 agent 提示词）；`WRITABLE_FILE_OPERATIONS_RULES` 消费方：designer、fixer、oceanus（→sisyphus 继承）。改共享常量影响全部 10 个 agent 提示词。
- **实现约束（关键）**：非 owned agent（observer/metis/momus/oracle/designer）的契约句只能放进两个共享 RULES 常量，不能修改其 agent 文件。
- `CBM_BOUNDARY_NOTE`（registry.ts，含臆造名 `search_code`）经 `cbmSection('explorer')` 与 `buildOceanusPrompt` 注入 explorer/oceanus/sisyphus 提示词；oceanus.ts 中另有一份硬编码副本。`search_code` 必须改为 `grep`。
- 测试锚点约束：不得删除 `cbm-usage.test.ts` 锚定的 `'websearch/webfetch'`、`'fallback'`、`cbmSection`、`grep`、`read` 文本；不得破坏 `registry.test.ts` 对 `CBM_BOUNDARY_NOTE` 的内容断言（`search_code` 若被其断言，需同步更新该断言，将 `src/cbm/registry.test.ts` 列为必要时可改文件）。
- 权限键说明：`READONLY_DEFAULT_PERMISSION` 中的 `codesearch/list/lsp` 等是宿主权限键而非工具名，T2 保留不动。

## 任务

### T1 — RED：工具名称契约回归测试
- Wave：1
- Depends on：无
- Files：`src/agents/index.test.ts`
- 目标：新增提示词契约断言（RED，修复前失败）：
  - 全部 agent 提示词不含裸工具名 `search_code`（词边界断言，豁免 `websearch/ast_grep_search/cbm_search_graph/task_*/oceanus-execute`）；
  - explorer/fixer/librarian 与共享 RULES 注入的契约句：`grep` 用于文本搜索、宿主工具按当前会话工具目录直接调用、禁止通过 Code Mode `execute` 代理调用工具（用 `toContain` 必需句断言）；
  - 现有 tooling-registration 的 15 工具精确集合断言作为护栏确认无 `read/search/execute` 别名（此部分非 RED，预期即绿）。
- 验收：提示词断言在 T2 前失败（RED）；注册集合护栏断言即绿；不修改生产代码。
- 验证：`bun test src/agents/index.test.ts`（预期：新增提示词断言 RED，注册护栏 GREEN）

### T2 — GREEN：对齐工具契约文案
- Wave：2
- Depends on：T1
- Files：`src/config/constants.ts`、`src/cbm/registry.ts`、`src/agents/explorer.ts`、`src/agents/fixer.ts`、`src/agents/librarian.ts`、`src/agents/oceanus.ts`；必要时 `src/cbm/registry.test.ts`、`src/agents/cbm-usage.test.ts`（仅同步锚点断言）
- 目标：
  - `CBM_BOUNDARY_NOTE` 与 oceanus.ts 副本中 `search_code` → `grep`，保留 registry 注入锚点（`websearch/webfetch`、`fallback`、`cbmSection`、`grep`、`read`）；
  - 在两个共享 RULES 常量中加入通用契约句（宿主工具按当前会话工具目录直接调用；不得通过不存在的 Code Mode `execute` 代理调用工具；不得调用未列出的臆造工具名）；
  - explorer/fixer/librarian 提示词新增对应澄清句（新增，不是删除——当前无裸 `search` 指引）；
  - 不新增 `read/search/execute` 插件工具，不改工具注册集合，不改 `READONLY_DEFAULT_PERMISSION` 的宿主权限键。
- 验收：T1 转绿；`bun test` 全量不因锚点破坏变红（否则按锚点约束同步测试断言）；typecheck 通过。
- 验证：`bun test src/agents/index.test.ts src/agents/cbm-usage.test.ts src/cbm/registry.test.ts && bun run typecheck`

### T3 — SURFACE：全量验证
- Wave：3
- Depends on：T2
- Files：无
- 目标：全量回归、类型、构建，确认未触碰既有无关改动与工具注册集合。
- 验收：全部通过；`dist` 构建成功。
- 验证：`bun test && bun run typecheck && bun run build`

## Momus 审查记录

- 第 1 轮：REJECT（P1 臆造名 search_code 位于禁改文件且影响面遗漏；P2 共享常量消费方低估；P3 T1 验收措辞矛盾；P4 断言边界未定义；P5 测试锚点未声明）。时间：2026-08-28。
- 第 2 轮：OKAY（session ses_fb712d742ffePXFURpKL3Q3Ihz，2026-08-28）。核验：5 点意见全部落实；search_code 全仓仅 3 处（registry.ts:57、oceanus.ts:257、index.test.ts:546 或关系断言）；锚点断言不含 search_code，改后仍绿。留意：CBM daemon 超时，本轮为文本级影响面，Review 阶段重建索引后复查；断言须保持 \bsearch_code\b 不得放宽为裸 search；两处来源同改。
- 影响面预估结论：见上（来自第 1 轮 CBM 查询：CBM_BOUNDARY_NOTE→cbmSection('explorer')+buildOceanusPrompt 的全部注入路径；RULES 常量的 10 agent 消费方；registry.test.ts/cbm-usage.test.ts 锚点）。
