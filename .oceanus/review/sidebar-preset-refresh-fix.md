# Review Report: sidebar-preset-refresh-fix

日期: 2026-08-27
Reviewer: Sisyphus（低风险变更，未升级 @oracle）

## CBM 状态

cbm_index 重试仍超时（daemon 30s 无法接受连接）→ fail-open，降级为直接代码验证 + diff 审阅。

## 变更清单（工作树叠加，锚点基于当前未提交状态）

1. `src/tui.tsx`：新增导出 `createPresetWatcher({read, intervalMs=2000, onChange}) → dispose`（fail-open：read 抛异常/undefined 视为指纹不变）；AgentModelPanel 消费它（L225-228 接线、onCleanup L332）；保留原事件监听快路径。
2. `src/index.ts` applyAgentDefinitions：def.model 缺失分支显式 `delete agent.model`。
3. `src/tui.test.ts`：新增 2 个 watcher 行为测试。
4. （经用户授权的越界修复）`src/tools/task/message.ts`：memoryMode 补 async —— 该文件为用户未跟踪的新文件，原状阻塞所有构建。

## Completion Audit 覆盖矩阵

| # | spec 验收标准 | 证据 | 结论 |
|---|---|---|---|
| 1 | 切换后 ≤1 tick 全窗口一致更新 | 机制级：watcher 代码验证+dist 标记（tui.js 含 createPresetWatcher×3、disposePresetWatcher 接线）；端到端：需用户重载插件/新会话人工复核（plan 既定移交） | 机制✅ 端到端待人工 |
| 2 | 无事件路径自愈 | 测试「preset 变化触发 onChange」pass | ✅ |
| 3 | 不残留旧 model | index.ts delete 分支 + typecheck 零错误（plan 约定审阅验证，无 harness） | ✅ |
| 4 | 同值 tick 零网络开销 | 测试「同值、undefined、dispose 后均不触发」pass；实现仅本地 readFileSync 比较 | ✅ |
| 5 | typecheck / 不回归 / 新增纯函数测试 | RED（export 缺失失败）→GREEN（23 pass/0 fail）已捕获；typecheck 改动文件零错误；全量 bun test 932 pass / 7 fail 均归因用户未提交 task_status 改造区（M/?? 文件，基线即失败，与本任务改动路径无交集） | ✅ |

## Findings

- 【已处置】build clean 删除 dist 的事故经用户授权修复 message.ts async 后恢复，产物含新逻辑标记。
- 【advisory】undefined 指纹语义（读失败≈无配置）继承 momus R1/P4 决策，接受该 trade-off。
- 【遗留-非本任务】上游 opencode 的 Agent.Updated 广播缺 location 是根因，建议单独报 issue；工作区尚有大量用户未提交改动与 7 个基线失败测试，均不在本任务范围。

## Gate 结论

矩阵无 executor 可消除的缺口 → PASS。唯一开放项（验收#1 端到端）为计划内的人工验证移交，不阻塞收尾。
