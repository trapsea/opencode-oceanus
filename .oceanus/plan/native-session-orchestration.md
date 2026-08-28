# Plan: native-session-orchestration

Spec: `.oceanus/spec/native-session-orchestration.md`（C 方案全面重构，用户已批准）
状态：Momus 第 1 轮 REJECT → 修订 → 第 2 轮 REJECT（小修项）→ 已按 N1-N7 修订 → 第 3 轮审查回填

## 已定死的关键决策（Momus #1/#5）

- **dispatch-guard 采用 coordinator 方案**（非纯内存）：duplicate-objective 规则保留，TaskIndex 必含 `objective`（规范化全文）与 `resultConsumedAt` 字段；coordinator 提供 `markResultConsumed(taskId)`，由新 task_result 在终态结果被读取时调用。dispatch-guard 文案同步去掉 `task_reuse`/`Job Board` 术语。
- **旧栈文件逐一定去留**：
  - 删除：`src/tools/task/{reuse,job-board,registry,protocol,contract,ledger-bridge}.ts` 及各自测试、`src/runtime/{task-observer,task-reconcile,task-supervisor,task-notification,task-control}.ts` 及测试（task-control.ts 当前无引用方）。
  - 保留改造：`src/runtime/task.ts`（宿主状态助手 resolveTaskHostStatus/cancelChildSession/readSessionOutcome 供 facade 复用；删除其 registry 单例部分，getTaskRegistry/resetTaskRegistry 一并删除）；`src/tools/task/types.ts` 精简保留 TaskStatus；`src/tools/task/{message,revive}.ts` 重写。
  - 配置：`taskReuse` 配置项与 `getTaskReuseConfig` 保留但语义迁移为 coordinator 的 reuse 开关（ttlMs/maxRetained 仍用）。

## 任务分解

### W1 核心协调器（无外部依赖，可并行内部串行）

- **T1 task-index**：新增 `src/runtime/task-index.ts` —— 内存+`.oceanus/tasks.json` 持久化任务索引。字段定稿：taskID(=childSessionID)、parentSessionID、agent、laneKey、objective（规范化文本，供 dispatch-guard duplicate-objective）、generation、state、resultSummary、terminal、resultConsumedAt、timestamps。契约测试点名：lane 冲突拒绝（同 parent 同 laneKey 已 active 时 registerLaunch 报错）、跨 parent 读写拒绝、重启恢复。
  - Files: `src/runtime/task-index.ts`, `src/runtime/task-index.test.ts`
  - 验证: `bun test src/runtime/task-index.test.ts`；契约测试点名：lane 冲突拒绝、lane 缺失（无 laneKey 时 registerLaunch 拒绝或显式降级，测试固定该行为）、跨 parent 读写拒绝、重启恢复。

- **T2 coordinator**：新增 `src/runtime/task-coordinator.ts` —— registerLaunch/reconcile(session)/formatBoard(parent)/resolveReusable/acquireLease/nextGeneration/markTerminal/markResultConsumed。reconcile 用 `session.active/get` 覆盖本地，绝不伪造终态；uncertain 不允许续用。契约测试点名：宿主不可确认时收敛 uncertain 不伪造终态。
  - Depends: T1
  - Files: `src/runtime/task-coordinator.ts`, `src/runtime/task-coordinator.test.ts`
  - 验证: `bun test src/runtime/task-coordinator.test.ts`

- **T3 subagent 事件桥**：新增 `src/runtime/subagent-bridge.ts` —— `execute.before/after` hook 处理器：识别原生 `subagent` 调用（含结构化 laneKey 优先取自 input.lane/lane_key，回退 description 正则），返回 sessionID 即 registerLaunch；完成后经 coordinator 标记 terminal + resultSummary。fail-open。含单测。
  - Depends: T2
  - Files: `src/runtime/subagent-bridge.ts`, `src/runtime/subagent-bridge.test.ts`
  - 验证: `bun test src/runtime/subagent-bridge.test.ts`

### W2 工具重写与旧栈移除（依赖 W1）

- **T4 工具 facade 重写**：`task_status/task_result/task_cancel` 是 `src/tools/index.ts` 内联 builder（L327/L371/L458），直接在该文件内重写为 coordinator+原生 session facade；重写 `src/tools/task/{message,revive}.ts`（schema 化输入）；删除 `reuse.ts`+测试；删除 `registry.ts/protocol.ts/contract.ts/ledger-bridge.ts`+测试；精简 `types.ts`；task_result 终态读取时调用 `coordinator.markResultConsumed`；`src/runtime/task.ts` 删除 registry 单例部分保留宿主助手。
  - Depends: T2
  - Files: `src/tools/index.ts`, `src/tools/task/{message,revive,reuse,registry,protocol,contract,ledger-bridge,types}.ts` 及测试, `src/runtime/task.ts`(+test)
  - 验证: `bun test src/tools/ src/runtime/task.test.ts`

- **T5 旧栈移除与接线**：删除 `job-board*`、`task-observer*`、`task-reconcile*`、`task-supervisor*`、`task-notification*`、`task-control*`；`src/index.ts`/`src/hooks/index.ts` 改为 TaskCoordinator + subagent-bridge 接线；同步更新 `production-task-harness.test.ts`、`tooling-registration.test.ts`、`smoke/host-smoke.test.ts`、`tooling-integration.test.ts` 中涉及旧栈的断言（`agents/index.test.ts` 归 T6 独有，T5 不触碰；`dispatch-guard.test.ts` 归 T5a 独有，T5 只跑不改）。
  - Depends: T3, T4, T5a
  - Files: `src/index.ts`, `src/hooks/index.ts`, `src/runtime/{task-observer,task-reconcile,task-supervisor,task-notification,task-control}*`, `src/tools/task/job-board*`, 上述四个测试文件
  - 验证: `bun test`（全量）

- **T5a dispatch-guard 改造**：duplicate-objective 与 resultConsumed 规则改读 TaskIndex/objective 字段（coordinator 方案，已定死）；错误文案去除 `task_reuse`/`Job Board` 术语，改为原生 subagent 术语；重写 `dispatch-guard.test.ts`（现测试 import createTaskObserver/JobBoard fixture 且断言旧文案，随 dispatch-guard.ts 一并归属本任务）。
  - Depends: T2
  - Files: `src/runtime/dispatch-guard.ts`, `src/runtime/dispatch-guard.test.ts`
  - 验证: `bun test src/runtime/dispatch-guard.test.ts`

### W3 提示词与 skill（依赖 W2 语义定稿，可与 W4 部分并行）

- **T6 sisyphus 协议重写**：`src/agents/sisyphus.ts` 的 TASK_CONTINUITY/SUPERPOWERS 文本改为原生 `subagent(background:true)` + sessionID 续用协议，移除 task_reuse/Job Board 旧术语；`src/skills/sisyphus-execute.ts` 同步；更新 `src/agents/index.test.ts` 中 prompt 术语断言（L562 等）。
  - Depends: T4, T5a（文案依赖 dispatch-guard 新术语）
  - Files: `src/agents/sisyphus.ts`, `src/skills/sisyphus-execute.ts`, `src/agents/index.test.ts`
  - 验证: `bun test src/agents src/skills`

### W4 端到端与收尾

- **T7 端到端冒烟**：runSetup 级测试：注册工具+bridge → 模拟 subagent before/after → 立即 status/cancel → 完成后 revive 续用（generation+1）→ 重启恢复 tasks.json 并 reconcile。
  - Depends: T5
  - Files: `src/runtime/native-orchestration.e2e.test.ts`
  - 验证: `bun test src/runtime/native-orchestration.e2e.test.ts`

- **T8 全量回归与清理**：`bun test` 全绿；`bun run build`；确认无死代码引用（task-notification/task-control/registry 已删净）；同步 spec 设计节 TaskIndex 字段清单（补 objective/resultConsumedAt）与状态。
  - Depends: T6, T7
  - Files: 全局
  - 验证: `bun test && bun run build`

## 策略

- TDD：是（每任务先写契约测试再实现）。
- Worktree：共享工作区（当前目录），串行 Wave 内按依赖调度；T1→T2→T3 串行；T4 与 T5a 可并行（Files 不相交）；T5 收口；T6/T7 可并行；T8 最后。

## Momus 门禁

- 第 1 轮（2026-08-28）：REJECT。问题 8 项：#1 dispatch-guard 未决二选一+TaskIndex schema 缺 objective/resultConsumed（高）；#2 T4 Files 与代码事实不符（高）；#3 缺 T6→T8 边（中）；#4 漏 dispatch-guard.test.ts（中）；#5 旧栈文件去留未决（中）；#6/#7/#8 低。
- 修订：决策定死（coordinator 方案+字段补齐）、T4 Files 重写、T8 dep T6+T7、T5 补测试清单与文案、逐文件去留清单、T5a 拆分、T1/T2 契约测试点名验收项。
- 第 2 轮（2026-08-28）：REJECT。剩余 N1-N7：T5 缺 T5a 依赖边（高）、dispatch-guard.test.ts 归属 T5a、agents/index.test.ts 归 T6、账本未同步、删除预填 OKAY 句、spec 字段同步、lane 缺失契约。
- 修订：T5 Depends 补 T5a；测试文件归属单任务；删除预填句；T8 扩 spec 同步；T1 补 lane 缺失契约；账本同步。
- 第 3 轮（2026-08-28）：OKAY。N1-N7 全部落实；执行留意：T5 全量门禁与 T6 中间态的调度顺序（T5 先收口）、T5a 窗口期 runDispatchGuards 入参向后兼容。
