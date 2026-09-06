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
