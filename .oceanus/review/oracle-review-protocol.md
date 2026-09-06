# Review: oracle-review-protocol

- 日期：2026-09-06
- Plan: `.oceanus/plan/oracle-review-protocol.md`
- Verdict: **PASS**（oracle diff-review 首轮 FAIL → 2 BLOCKER + 4 SUGGESTION 全部修复后复验通过）

## 1. 验证证据

| 检查 | 结果 | 证据 |
|---|---|---|
| bun run typecheck | ✅ | exit 0（修复轮复跑） |
| bun test | ✅ | 739 pass / 0 fail / 58 文件（基线 715 → 净增 24 用例） |
| bun run build | ✅ | index.js 0.82MB + tui.js 0.52MB |
| check:dist | ✅ | verify-dist-auto-update OK + verify-dist-skills OK |
| check-prompt-chinese | ✅ | SCAN_OK（含 fence 转义解析缺陷修复） |
| 残留 grep | ✅ | metis/momus 仅存负向防回归断言/迁移注释/测试用例名 |

## 2. oracle diff-review 场景审查（新协议首次实战）

首轮 verdict：**FAIL**（2 BLOCKER + 4 SUGGESTION）→ 修复映射：

| ID | 问题 | 修复 |
|---|---|---|
| B1 | explorer findings 落盘契约与只读默认权限（write: deny）硬冲突，运行时必然被拒 | 新增 `EXPLORER_DEFAULT_PERMISSION`（write 资源级：`.oceanus/findings/*` allow 在前、`*` deny 兜底，findLast 语义下两种 glob 解释均 fail-closed）+ index.ts 特判 + explorer prompt 增加 `STATUS: FINDINGS_UNAVAILABLE` 回落双保险 + README/AGENTS.md「不写文件」表述修正 + explorer-permission.test.ts 3 用例 |
| B2 | REVIEW_GATE_PROTOCOL「复审续用原会话」与 sisyphus/plan skill「复审必须新会话」自相矛盾；注释引用关系失实 | protocol.ts 统一口径：复审使用新会话（不复用 consult/analysis/前轮 gate 会话），round 与前轮 BLOCKER 经 prompt 显式传递；注释修正为「仅 sisyphus.ts 注入」；sisyphus.ts:69 措辞对齐 |
| S1 | diff-review 白名单不匹配 `.oceanus/**/*.diff/.patch` 落盘路径 | globs 扩展 + scenes.test 2 用例 |
| S2 | oracle_scene 标签（gate）与注册表场景名（plan-gate）双轨、枚举不全 | oceanus.ts oracle 描述补充双命名对应与交付级场景说明 |
| S3 | spec 验收「六场景」与实现（五场景+consult 协议外）不一致 | spec §4.5 措辞修正 |
| S4 | AGENTS.md 版本号 0.34.0 过时 | 更新 0.46.0 |

修复过程额外发现并修复 2 个问题：
- explorer.ts 模板字符串裸反引号（TS1010）——修复转义
- check-prompt-chinese.ts fenced 解析不识别转义反引号（预置缺陷，错位把代码行当 prompt 扫描）——与引号分支对齐转义处理，全仓复验无新报告

## 3. CBM 影响面复查

- 索引重建：`cbm_index` 成功（2215 节点 / 6314 边，status: indexed）
- `detect_changes`：seed_symbols 102，impacted_total 27，全部为 hop1-2 的已知调用方/测试（tui、oceanus 工厂、getAgentDefinitions、setup-stages、verify-dist-skills、各测试模块）
- 与 plan impact_estimate 对比：**一致，无预估外新调用方**；全部 impacted 项已被 typecheck（全仓）+ 739 测试 + check:dist 覆盖

## 4. Completion Audit（矩阵）

| 验收标准 | 证据 | 状态 |
|---|---|---|
| 1. typecheck 通过 | 多轮 exit 0 | ✅ |
| 2. bun test 全过且契约迁移保留 | 739/0；scenes.test 20 用例含 momus 契约锚点（BLOCKER/max3/最小修订集/impact_estimate）、finish.test gate 矩阵、gate.test 四项批问+负向断言 | ✅ |
| 3. build + check:dist 通过 | verify-dist-auto-update/skills OK | ✅ |
| 4. agent 10→8 + 执行纪律段 + 场景路由段 | 运行时脚本：ALL_AGENT_NAMES=8；oceanus/sisyphus 含「执行纪律/逃生舱/大输入隔离」；oracle 含 oracle_scene/[OKAY]/gate；无 @metis/@momus | ✅ |
| 5. review/protocol 导出 + 场景注册 + 契约迁移 | 五场景注册（plan-gate/solution-analysis/diff-review/completion-audit/visual-acceptance）；spec 勘误已修 | ✅ |
| 6. loop-guard 编辑后重读豁免有测试 | tool-loop-guard.test 20 用例（豁免 12 + 回归 8） | ✅ |
| 7. skills 六阶段无 @metis/@momus 残留 | grep 验证（负向断言字面量除外） | ✅ |
| 8. 文档与新拓扑一致 | README/AGENTS.md/docs×2 零残留；AGENTS.md 版本同步 | ✅ |

非目标确认：未实现 Context Pack/温池/SQLite MCP（未越界）；fixer/designer 未删除（按计划仅降级）。

## 5. 残余风险（如实记录）

1. `src/review/` 目前为纯契约模块（无运行时消费方），白名单/组装逻辑仅由单测保证，接线时的端到端行为待后续任务验证
2. explorer findings 写权限的宿主 resource glob 跨段语义未在真实宿主端到端验证；已按 fail-closed 设计（两种 glob 解释均不放大权限）+ `STATUS: FINDINGS_UNAVAILABLE` 回落兜底
3. oracle 三场景的实际审查质量依赖模型行为，prompt 契约（verdict 字面量、max-3、fresh-session）已由文本+测试锚定，但无真实门禁轮次的运行时校验（本次 diff-review 实战为首个样本，行为符合契约）

## 6. 追加修复（0.46.1，2026-09-06：用户反馈"oracle 审核上下文缺失严重"）

### 诊断（grep + 运行时验证确认）

1. **场景注册表是死代码**：`REVIEW_SCENES`/checks 在 `src/review/` 之外零引用——momus 契约迁移的检查清单只有测试验证，运行时无任何 prompt 使用
2. **oracle system 只有路由规则**：`<oracle_scene>` 块内容全靠委派方（主 agent LLM）即兴复述，检查清单/输出契约/必附上下文质量不稳定——上下文缺失主根因
3. **委派必附上下文无协议**：sisyphus 门禁只要求 plan 路径，spec/intake/findings/前轮 BLOCKER 全靠自觉

### 修复

- `review/protocol.ts`：ReviewScene 新增 `requiredContext: readonly string[]`（单一来源）
- `review/scenes.ts`：五场景 requiredContext 全部声明（plan-gate：plan+spec/intake+findings+前轮 BLOCKER；diff-review：diff+plan+验收来源；completion-audit：ledger+matrix+spec+门禁记录；visual-acceptance：基准图+产出图+契约清单；solution-analysis：spec+候选方案+已有 findings）
- `agents/oracle.ts`：system 内嵌四个 oracle 场景完整标准指令（`buildSceneDirectives()` 从注册表拼装：checks+契约+独立性+复审上限+必附上下文+「信息缺口」降级声明）；`<oracle_scene name>` 降级为场景选择器（gate↔plan-gate 等价标注）；委派方内联指令只能加严不得放宽；oracle system 6113 字符（可控）
- `agents/sisyphus.ts`：buildOracleReviewGate 注入必附上下文清单（从 REVIEW_SCENES 拼装）+「缺失任何一项都会造成审核信息缺口」警示
- `agents/protocol.ts`：REVIEW_GATE_PROTOCOL 补必附上下文条目
- `agents/oceanus.ts`：oracle 描述委派方式行同步
- 测试：oracle.test 新增内嵌指令断言（四场景锚点+注册表一致性+visual-acceptance 不内嵌）；scenes.test 新增 requiredContext 断言+sisyphus 注入断言

### 验证

typecheck ✅ / **746 pass / 0 fail**（+7 用例）/ build ✅ / check:dist ✅ / check-prompt-chinese ✅；oracle system 含 impact_estimate 维度与四场景内嵌、sisyphus 含必附上下文清单（运行时冒烟确认）

## 7. 追加调整（0.46.1，2026-09-06：批问默认值/改名/适用范围）

1. **批问四项默认全关**：Oracle 审查/SDD/TDD 默认推荐关闭（原 >12 任务推荐开的规则移除，改为"选项说明中可提示何种规模值得开启"）；连续执行授权默认推荐拒绝（每阶段结束停顿汇报）
2. **「Oracle 门禁审核」→「Oracle 审查」**：全仓 36 处改名（sisyphus/intake/plan/execute/review/finish skills、gate.test、README、AGENTS.md、docs×2），grep 零残留
3. **批问按任务类型适用**：仅实现类任务（产出涉及代码/文件实现改动）执行批问；调研、查询、方案设计等非实现类任务跳过批问，四项按默认关闭记录并标注 `not_asked: non-implementation`（sisyphus 批问规则 + intake skill 适用判定 + execution_config 字段说明三处一致）

### 验证（追加轮）

typecheck ✅ / **747 pass / 0 fail**（+1 批问契约用例）/ build ✅ / check:dist ✅ / check-prompt-chinese ✅；运行时冒烟：默认全关/改名/非实现类跳过/连续执行默认拒绝四项锚点全部命中
