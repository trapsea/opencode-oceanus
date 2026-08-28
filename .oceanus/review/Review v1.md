# Review v1 — cbm-registry-lifecycle

- 日期：2026-08-28
- 范围：CBM 规则注册表 + 三阶段主线闭环（spec: `.oceanus/spec/cbm-registry-lifecycle.md`）
- 门禁记录：Momus OKAY（Round 1，ses_fb90b2fbcffeUPQ6VW835zISYw）+ 人工 APPROVED（双门禁齐备）

## Step 1-3 影响面复查（CBM 主线自应用）

**降级证据（必须记录）**：Review 开始执行 `cbm_index` 重建索引失败——CBM daemon 超时（"could not accept this client within 30000 ms"，复测 `cbm_status` 同错误，exit_nonzero）。按主线规则 fail-open，改用 grep/git 降级路径完成影响面复查，未伪造索引成功。

降级路径复查结果（实际 diff vs 计划声明）：

| 复查项 | 命令/证据 | 结论 |
|---|---|---|
| 变更文件范围 | `git diff --name-only`（23 文件）逐一对照 plan T1-T6 Files | 全部在声明范围内，无越界 |
| 权限矩阵零改动 | `git diff src/config/constants.ts` = 0 行 | ✅ 与约束一致 |
| 注册表单一来源 | `grep CBM_TOOL_NAMES src/` 无残留；`grep OrderHandler src/agents/*.ts` 零 prompt 硬编码 | ✅ |
| 双重注入防范 | sisyphus prompt `## CBM 阶段边界` 恰好 1 次；`grep -c CBM_LIFECYCLE src/agents/oceanus.ts` = 0 | ✅ |
| 运行时行为 | `bun test` 921 pass / 8 skip / 0 fail（8 skip 为环境探测设计内跳过） | ✅ |
| 类型完整 | `bun run typecheck`（tsc --noEmit）exit=0 | ✅ |

**与 momus 预估对比**：Momus Round 1 的 4 个留意点全部落实——① oceanus 未嵌入 `CBM_LIFECYCLE.full`（grep=0）；② T3 未动 Review Ownership 段（diff 仅上下文出现）且 brainstorm/plan 无 `cbm_index` 字面量（grep=0，负向断言保持）；③ T4 未触碰 index.ts/types.ts/constants.ts/schema.ts/hooks；④ CBM-12 审计列表已扩为 8 agent（补 momus/metis）。一致 → 记为验证证据，无需退回 execute。

## 契约测试证据（摘要）

- `src/cbm/registry.test.ts`：16 pass（注册清单/示例/主线三阶段/六角色段落）
- `src/agents/cbm-usage.test.ts` + `src/agents/index.test.ts`：106 pass（momus 影响面+REJECT、主线唯一注入、CBM-12 八 agent 审计、负向前瞻）
- `src/skills/stages.test.ts`：53 pass（既有 CBM-04 全保 + 新增 plan 影响面项/review 三步复查断言）
- T4 相关（builders/tooling/smoke）：140 pass
- 全量：921 pass / 0 fail

## 断言调整记录（可审计）

1. cbm-usage.test.ts：librarian `toContain('fallback')` → `toContain('websearch/webfetch')`（语义等价迁移：注册表 librarian 段降级语义由 websearch/webfetch 表达）。
2. stages.test.ts / index.test.ts / cbm-usage.test.ts：仅新增断言，无既有断言删除；既有正则（含负向前瞻、次数断言）全部保持通过。
3. sisyphus-review.ts 顺带修复原有重复步骤编号（3、3 → 顺延 4-7），属同文件显式笔误修复。

## Completion Audit（覆盖率矩阵）

| 验收标准（spec） | 证据 | 状态 |
|---|---|---|
| 1. bun test 全绿 | 921 pass / 0 fail（本机终态复跑） | ✅ |
| 2a. momus prompt 含影响面预估 checklist 与 REJECT | momus.ts Checklist 新增项 + `cbmSection('momus')`；cbm-usage 断言通过 | ✅ |
| 2b. plan skill momus 清单含影响面项与记录要求 | sisyphus-plan.ts L40/41/59；stages.test 断言通过 | ✅ |
| 2c. review skill 重建→复查→对比三步 | sisyphus-review.ts Step 1-3；stages.test 断言通过 | ✅ |
| 2d. 注册表单一来源 | grep 验证（无字面量残留）+ 契约测试 | ✅ |
| 2e. sisyphus/oceanus 同源不重复注入 | `## CBM 阶段边界` 唯一性断言 + oceanus 零引用 | ✅ |
| 3. 权限回归（momus deny 查询 allow） | constants.ts diff=0；权限契约测试通过 | ✅ |
| 4. typecheck 通过 | tsc --noEmit exit=0 | ✅ |

**矩阵全绿，无缺口。** 遗留不确定性：CBM daemon 本轮不可用（环境性，非本次改动引入），review 影响面复查以 git/grep 降级证据替代；daemon 恢复后可复跑 `cbm_index` + `cbm_detect_changes` 做二次确认，但不构成缺口。
