# Spec：CBM 规则注册表 + 三阶段主线闭环

## 背景与问题

codebase-memory（CBM）的使用规则散落在 14+ 个文件中，且存在不一致：

- `src/agents/sisyphus.ts` 与 `src/agents/oceanus.ts` 各自维护一份 CBM 阶段规则，措辞不一致；
- `momus` agent 的方案审查清单完全没有 CBM 影响面排查；
- `sisyphus-review` skill 的"影响面验证"表述泛化，未落成显式 CBM 复查步骤；
- 7 个 CBM 工具名清单在 6 处硬编码；OrderHandler 查询示例族在 6 处重复；
- README 与 docs 中的主线描述缺 momus 预估与 review 对比环节。

## 目标

1. **单一来源**：新建 `src/cbm/registry.ts` 作为 CBM 规则注册表，agents/tools/测试统一引用。
2. **三阶段主线闭环**：
   - **Intake 初始化**：代码/混合任务由 Sisyphus 直接 `cbm_index` 一次，fail-open，全工作流唯一初始化点；
   - **Momus 影响面预估**（新增）：plan → execute 门禁审查时对计划声明的修改文件/公共符号用查询型 CBM（`cbm_search_graph` → `cbm_trace` → 必要时 `cbm_code`）排查影响面；发现计划未声明的受影响调用方/契约 → `REJECT` 并列出具体符号；预估结论写入 plan status 供 review 对比；momus 只用查询型工具（`cbm_index` 保持 deny）；CBM 不可用时标注不确定性不虚构；简单任务跳过需记录理由；
   - **Review 影响面复查**（强化）：`cbm_index` 重建索引 → 对实际 diff 用 `cbm_trace`/`cbm_detect_changes` 再次排查影响面 → 与 momus 预估记录对比：一致记为验证证据，不一致解释或退回 execute；CBM 不可用记录降级证据。
3. 其他阶段语义不变：brainstorm/plan 符号定位不重复初始化；execute 高风险公共符号修改前 trace/impact；finish 不调用 CBM。

## 注册表导出

| 导出 | 用途 |
|---|---|
| `CBM_TOOLS` | 7 个注册工具名唯一硬编码处 |
| `CBM_QUERY_EXAMPLES` | 共享 OrderHandler 示例族 |
| `CBM_LIFECYCLE` | 三阶段主线文本（sisyphus 阶段边界与 oceanus 调度段共用） |
| `cbmSection(role)` | explorer/oracle/fixer/librarian/momus/metis 角色 CBM 段落（差异化内容保留，工具名/示例/公共边界句从注册表拼装） |
| 公共边界句 | 文本→grep、AST→ast_grep、文件→glob 不用 CBM 替代；证据带 qualified name/路径/行号；fail-open 降级 |

## 文件改动

- 新增：`src/cbm/registry.ts`、`src/cbm/registry.test.ts`
- Agent prompts（import 注册表，删硬编码）：`sisyphus.ts`（buildCbmPhaseBoundary 用 CBM_LIFECYCLE；MetisMomusGate 的 momus 条目补影响面预估）、`oceanus.ts`、`momus.ts`（+影响面 checklist）、`explorer.ts`、`oracle.ts`、`fixer.ts`、`librarian.ts`、`metis.ts`（+简短查询段）
- Skills：`sisyphus-plan.ts`（momus checklist 加影响面项 + 结论记录要求）、`sisyphus-review.ts`（Step 1 扩为重建→复查→对比三步）；intake/brainstorm/execute/finish 措辞对齐主线、逻辑不变
- 工具层：`tools/cbm/builders.ts` 工具清单改 import `CBM_TOOLS`
- 文档：`README.md` CBM 段、`docs/codebase-memory-mcp.md` 工作流段同步主线
- 契约测试全量同步：`agents/cbm-usage.test.ts`、`agents/index.test.ts`（"四阶段"测试改为主线断言）、`skills/stages.test.ts`（CBM-04）、`tools/cbm/builders.test.ts` 等

## 约束

- 权限矩阵零改动（`config/constants.ts` 不动；momus 查询型 CBM 已 allow、cbm_index 已 deny）
- 不改 tools/cbm CLI 行为、hooks/cbm-guidance 逻辑、各角色差异化语义
- 注册表文本保持 `cbm_` 前缀工具名规范（契约测试有 `(?<!cbm_)search_graph` 等负向断言）
- sisyphus/oceanus 共用文本不得重复注入（保留"CBM 阶段边界只出现一次"类断言）

## Metis 分析

跳过理由：方案选择已由用户直接决策（方案 C：全面重构 CBM 规则注册表），设计已获批准；无未决方案选择需要独立分析。

## 验收标准

1. `bun test` 全绿；
2. 契约测试覆盖：momus prompt 含影响面预估 checklist 与 REJECT 判定；plan skill 的 momus 清单含影响面项与记录要求；review skill 含重建索引→复查→对比三步；注册表单一来源（agents 不再硬编码工具清单与示例）；sisyphus/oceanus 主线文本同源；
3. 权限回归：momus `cbm_index: deny`、查询型 allow 不变；
4. typecheck/构建通过。

## 非目标

- 不改 tools/cbm 的 CLI/工具执行逻辑；
- 不改 cbm-guidance hook 行为；
- 不统一各角色 CBM 段落的差异化语义（只统一来源，不统一内容）。
