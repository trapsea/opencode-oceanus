# Native Session Orchestration（C 方案：TaskCoordinator 全面重构）

## 目标

以 OpenCode V2 原生 session/subagent 为唯一执行事实源，新建 `TaskCoordinator` 单写入者替换现有 `JobBoard + task-observer + task-reconcile + task-supervisor + task_reuse` 调度栈，使 Sisyphus 能可靠地并行调度、查询、续用、取消后台 subagent。

## 背景与问题（已验证）

1. Sisyphus prompt 使用不存在的 `task(run_in_background=true)`；V2 原生为 `subagent(..., background:true)`。
2. `task_reuse` 实测返回 `NO_REUSABLE_TASK`：原生 subagent 派发未形成可复用 board 记录（`.oceanus/task-board.json` 未生成），且 lane 仅从 `description` 正则提取（task-observer.ts:97-103），prompt 内 lane 不被识别。
3. 登记发生在 `execute.after` 事后观察（task-observer.ts:348-366），非派发事实源；后台任务启动期无可用 task ID。
4. task_status/result/cancel 与原生 session 生命周期重叠但无统一 ID（task ID / child session / board ID 三套）。

## 设计

### 架构

- OpenCode V2 sessions = 执行事实源（创建/续用/取消/终态/结果全部走原生）。
- `TaskCoordinator` = 单写入元数据协调器：
  - `TaskIndex`：内存 + `.oceanus/tasks.json` 持久化（sessionID/parent/agent/laneKey/generation/objective/resultSummary/terminal/resultConsumedAt/timestamps）。
  - `registerLaunch`：subagent 调用返回 sessionID 即登记（同步优先，事件兜底）。
  - `reconcile(session)`：用 `session.active/get` 覆盖本地状态，本地永不伪造终态。
  - `formatBoard(parent)`：生成 active/unreconciled/reusable 摘要注入提示。
  - lease/generation：续用与取消防陈旧。
- `taskID === childSessionID`，单一标识。

### 工具面（5 个，全部为原生 session facade）

- `task_status(task_id)`：coordinator 元数据 + 原生 active/get。
- `task_result(task_id)`：仅返回经原生确认 completed 的最终文本。
- `task_cancel(task_id)`：`session.interrupt` + 宿主确认收敛。
- `task_message(task_id, message)`：`session.prompt(delivery:'queue')`，语义=排队。
- `task_revive(task_id, prompt)`：对 reusable completed session 用原生 prompt 续用，generation+1。
- 删除 `task_reuse`。

### Sisyphus 协议（prompt + sisyphus-execute skill）

派发前读 Board 摘要 → 同 lane active 等待；reusable completed 用 sessionID 续用；否则 `subagent(background:true)` 新建；终态只信 `session.get().outcome`。

## Metis 分析

Metis 未执行：方案选择已在前序对话由用户逐项确认（原生事实源 + 薄元数据 + 全面替换），无剩余未决方案分歧。

- 需求缺口：无阻塞项；端到端宿主事件形状为唯一外部不确定点，以 fail-open + 测试兜底。
- 风险：宿主 `execute.after` 对原生 subagent 的 result 形状可能变化；旧 45 个 task 测试需重写。
- 边界/非目标：不做 V1 `task` 兼容层；不做跨进程多编排器并发（单父 session 单写入）；不迁移旧 `task-board.json`。
- 反例/边界：lane 冲突拒绝；跨 parent 续用拒绝；uncertain 不允许续用；取消未确认不得标记 cancelled。
- 验收标准：
  1. 原生后台 subagent 派发后立即在 coordinator 登记，可 task_status/task_cancel。
  2. 首任务完成后，同 task_id 经 task_revive 执行第二项工作（generation+1）。
  3. 重启后 tasks.json 恢复，reconcile 以宿主状态收敛。
  4. lane 缺失/冲突、跨 parent 续用被拒绝。
  5. prompt/wait/get 失败收敛为 uncertain，不伪造终态。
  6. 全量 bun test 通过（新契约测试替换旧测试）。

## 实施波次

全部已完成（2026-08-28）：T1 TaskIndex、T2 TaskCoordinator、T3 subagent-bridge、T4 工具 facade 重写、T5a dispatch-guard 改造、T5 旧栈移除与接线、T6 sisyphus/oceanus 协议重写、T7 端到端冒烟、T8 全量回归（895 tests / 0 fail，tsc 干净，build 成功）。实施中修复的设计缺陷：① Board 摘要补 Completed(unconsumed) 分区；② 只读工具（task_status/task_result）不回写宿主确认的终态导致 revive 被误拒——task_result 现回写 markTerminal，task_revive 前先 reconcile。

- W1：TaskIndex + TaskCoordinator 核心（register/reconcile/formatBoard/lease/generation）+ 单测。
- W2：工具重写（status/result/cancel/message/revive）+ 删除 reuse/job-board + 接线（index/hooks/tools）+ dispatch-guard 改造。
- W3：sisyphus prompt + skill 调度协议重写。
- W4：端到端冒烟（runSetup 级）+ 清理旧测试 + review。
