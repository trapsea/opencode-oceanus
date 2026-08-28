# Review: native-session-orchestration

日期：2026-08-28 ｜ 审查人：Sisyphus（主 Agent）｜ Plan: `.oceanus/plan/native-session-orchestration.md`（Momus 第 3 轮 OKAY + 人工 APPROVED）

## 完成度审计（覆盖矩阵）

| # | 验收标准（spec） | 证据 | 结论 |
|---|---|---|---|
| 1 | 原生后台 subagent 派发后立即登记，可 task_status/task_cancel | `native-orchestration.e2e.test.ts` 验收1（bridge 同步 registerLaunch，立即 status 返回 running/laneKey）；cancel 经 `tooling-integration.test.ts` 生命周期与 `task.test.ts` mock 验证 | ✅ |
| 2 | 首任务完成后同 task_id revive 执行第二项工作（generation+1） | e2e 验收1：task_result 消费 → task_revive ok/generation=2/prompt 送达原 session | ✅ |
| 3 | 重启恢复 tasks.json，reconcile 以宿主状态收敛 | e2e 验收2：三段进程（active→uncertain→succeeded→completed），磁盘 TaskIndex 直读核验 | ✅ |
| 4 | lane 缺失/冲突、跨 parent 续用拒绝 | `task-index.test.ts`（LANE_REQUIRED/LANE_CONFLICT/PARENT_OWNERSHIP 各 1 pass）；e2e 验收4 + lane 重复派发不重复登记 | ✅ |
| 5 | prompt/wait/get 失败收敛 uncertain，不伪造终态 | `task-coordinator.test.ts`（宿主不可确认→uncertain）；`revive.ts` 无 outcome 时保持 running 不写终态；e2e 验收2 uncertain 不可 revive | ✅ |
| 6 | 全量测试通过 | `bun test` 889 pass / 0 fail；`tsc --noEmit` 0 错误；`bun run build` 成功（index.js 0.84MB / tui.js） | ✅ |

## 执行审计

- 9/9 任务（T1-T8、T5a）全部 completed，账本 `.oceanus/progress/native-session-orchestration.md` 有 RED→GREEN 证据与时戳。
- 实际执行顺序：T1→T2→T3（串行）→ T4（主）∥ T5a（@fixer 后台）→ T5 → T6（与 T5 语义收口后）→ T7 → T8。与计划依赖边一致；T5 先于 T6 收口（Momus 留意项 1 已遵守）。
- 门禁：Momus 3 轮（REJECT/REJECT/OKAY）+ 人工 APPROVED，均记录于 plan。

## 实施中发现并修复的缺陷

1. Board 摘要缺少 Completed(unconsumed) 分区 → 编排器无法发现需消费的结果（T2 修复，补分区）。
2. 只读工具不回写宿主确认的终态：task_result 读取后本地仍 running，导致 task_revive 被 LANE_CONFLICT 误拒（T7 发现；task_result 回写 markTerminal + task_revive 前置 reconcile）。
3. revive 语义：uncertain 视为 active 拒绝续用（LANE_CONFLICT），与"不伪造终态"一致，测试固化该行为。
4. e2e 首版对 dup 派发断言过强：bridge fail-open 吞 LANE_CONFLICT，正确断言是"第二条任务不被登记"（已修正断言以匹配诚实语义）。

## 遗留与风险（如实记录）

1. **未在真实 OpenCode 宿主中端到端运行**：bridge 依赖宿主 `execute.before/after` 对原生 `subagent` 的事件形状（`result.sessionID`）。本会话开头的真实 subagent 测试观察到的返回形状与此一致，但宿主 beta 版本升级可能改变形状；bridge 全链路 fail-open，形状不匹配时退化为"不登记"而非崩溃。建议后续在真实宿主跑一次 `/oceanus` 冒烟。
2. **TaskIndex 多实例覆盖风险**：`tasks.json` 为整文件覆盖写，无跨进程 CAS；生产单 coordinator 单实例无问题，但并发多编排器进程共用同一 workspace 会互相覆盖（非目标范围，spec 已声明）。
3. **旧 `.oceanus/task-board.json` 不迁移**：首次运行生成新 `tasks.json`，旧 board 文件留置不读。
4. CBM review 期重建索引超时（daemon 30s 未接受连接），降级为 grep/read 验证；影响面核查已用直接读源完成。
5. `task-capabilities.ts`（旧 V2 适配器）已随 T8 删除，无残留引用。

## 结论

覆盖矩阵全绿，门禁齐全，测试/类型/构建三重验证通过。计划完成；风险 1 建议作为后续独立小任务在真实宿主冒烟。
