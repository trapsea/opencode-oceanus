# Primary↔Subagent 通信优化设计

## 目标

建立清晰的 primary/subagent 通信边界，消除重复 queue 通知，保证宿主事实优先，并修复任务状态、generation、取消/恢复和消息投递的竞态。

## 已批准方案

采用分层混合模型 C，并先落地 B 作为止血步骤：

- OpenCode 宿主事件是运行状态和结果的唯一事实来源；
- JobBoard 负责持久化编排、generation、CAS、恢复和消息 outbox；
- TaskRegistry 仅作进程内索引/缓存，不独立确认终态；
- 默认不通过 `session.prompt({ delivery: 'queue' })` 发送终态通知；
- 需要唤醒时只发送可选、去重的摘要，不直接注入 subagent 原文。

## 范围与非目标

范围：`task/subagent` observer、任务状态查询/结果/取消/恢复、primary→subagent 消息、JobBoard 持久化和相关测试。

非目标：不重写 OpenCode V2 宿主调度器，不创建第二套 session，不把 prompt 通知当作可靠消息队列，不把 child 输出当作可信指令。

## Metis 分析

Metis 建议 B→C：先移除默认 queue 通知，再引入 event id、generation fence、受限状态转换和消息 outbox。A（完全依赖宿主）需先验证宿主是否提供完整的结果留存、消息确认、恢复和取消语义，当前不直接采用。

主要风险：before/after 持久化竞态；迟到事件覆盖新 generation；cancel 与完成竞态；消息发送失败后无重试；`uncertain` schema 不一致；结果文本直接注入 prompt；child session 解析过宽导致权限扩大。

## 实施原则

1. 终态通知默认关闭，保留状态更新和显式 `task_result` 查询。
2. observer 事件按 task、generation、event id 幂等；旧 generation 事件不得覆盖当前任务。
3. observer 使用 CAS/受限 transition，不用宽泛 replace 覆盖状态。
4. 宿主 confirmed outcome 优先于本地 observation；不确定时明确返回 uncertain/未验证。
5. 消息严格绑定 parent、child、generation，记录 pending/delivered/uncertain，并支持重试。
6. child 输出作为数据处理，不直接构造 primary 指令。

## 验收标准

- 默认运行不会因 subagent 完成产生额外 queue prompt；重复事件不会重复唤醒。
- 快速完成、重复 after、迟到 cancel/complete、revive 后旧事件均不会破坏当前状态。
- `task_result` 不返回旧 generation 结果，宿主事实优先。
- 消息无 child、跨 parent、非 running 或 generation 不匹配时被拒绝；发送失败可见且可重试。
- JobBoard 的状态 schema、CAS、恢复和消息上限行为一致。
- 定向测试、全量测试和类型检查通过。

## CBM 证据

Intake 阶段尝试 `cbm_index`，但 daemon 在 30 秒内未接受连接，按 fail-open 处理；本设计基于本地源码和既有测试证据。
