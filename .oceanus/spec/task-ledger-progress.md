# 任务级进度 Ledger 设计

## 目标

将 `.oceanus/progress/` 从阶段摘要改为“每个计划对应一个任务状态 ledger”，持续记录所有计划任务的执行状态、并行 worker 和验证证据。

## 状态模型

每个任务必须拥有唯一 `Task ID`，状态只能是：

`pending` → `in_progress` → `completed`

异常终态为 `failed`，因依赖失败或取消而无法执行的任务为 `blocked`。

## Ledger 格式

文件名使用计划名，例如 `.oceanus/progress/<plan-name>.md`，包含任务表：

| Task ID | Wave | Depends on | Files | State | Worker/Session | Validation | Updated |
|---|---:|---|---|---|---|---|---|

计划阶段创建所有任务行并初始化为 `pending`。执行阶段在派发前更新为 `in_progress`，收到终态结果并完成验证后更新为 `completed`、`failed` 或 `blocked`。

## 并行安全

并行 worker 不直接写共享 ledger。由 orchestrator 串行执行 ledger 更新；同一 Wave 的任务仍可并行派发，不得为了写 ledger 而串行等待。每次更新保留任务 ID、状态变化、时间和验证证据。

## 非目标

- 不删除内存 todo；todo 仍用于即时调度。
- 不让阶段状态替代任务状态；阶段状态仅作为可选摘要。
