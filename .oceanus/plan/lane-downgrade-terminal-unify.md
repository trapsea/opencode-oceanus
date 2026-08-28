# lane 契约降级 + 终态类型统一计划

关联排查：本计划由 CBM 影响面排查驱动（2026-08-28，索引 2767 节点/6991 边，重建后）。

## 排查结论（已验证事实）

- `formatBoard` / `resolveReusable` 生产调用为 0（CBM trace 排除测试=0、含测试=0、grep 仅定义+测试，三方一致）→ 死代码。
- `extractLane` 唯一调用者：`subagent-bridge.execute.before`；laneKey 生产文件封闭在 4 个 task 域文件。
- 提示词契约三处断裂：① TASK_CONTINUITY 教模型传不存在的 `subagent(lane_key:...)` 参数；② 声称"同 lane 并发会被 LANE_CONFLICT 拒绝"不实（guard 不查 lane，LANE_CONFLICT 在 after 阶段被吞、任务照跑）；③ Task Board"注入摘要"无任何生产机制。
- 实际缺陷两个：bridge 无 lane 登记失败 → 兜底登记丢失真实 agent（防重派守卫对 unknown 失效）；并发兜底登记在 `host-fallback` lane 上 LANE_CONFLICT 互相顶掉（误报 task 不存在）。
- `TaskStatus('unknown')` 为死枚举值，生产无产出；终态类型触点 7 处、5 个文件，封闭。
- 用户决策：方向 A（降级 lane 为纯元数据）+ ②（终态统一）。

## 设计决策

1. 哨兵 lane：`UNLABELED_LANE = 'unlabeled'`（导出自 task-index）。`extractLane` 未命中时 bridge.after 直接以 pending 真实 agent + 哨兵登记；`ensureRegistered` 兜底 lane 从 `'host-fallback'` 改为哨兵。`TaskIndex.registerLaunch` 冲突扫描跳过哨兵 lane（显式 lane 冲突检查保留）。
2. `registerRevive` 对同任务 running/uncertain 抛 `ACTIVE_CONFLICT`（不再借用 LANE_CONFLICT 消息）。
3. 删除 `formatBoard` / `resolveReusable` 及其测试；相关断言改用 `listByParent`。
4. 终态类型唯一源：`tools/task/types.ts`（TaskState 5 值 + TERMINAL_STATUSES + isTerminalStatus + 新增 `outcomeToState()`）；`task-index.ts` 改为 import；`TaskStatus` 独立定义删除（引用点改用 TaskState）；`resolveTaskHostStatus` 入参改 `{ taskID, state }`；`dispatch-guard.TERMINAL_STATES` 改由共享 `TERMINAL_STATUSES` 派生；bridge 的 `rec.state as 'completed'` 强转改为 `isTerminalStatus` 类型守卫。
5. 提示词改写（三份）：删除 Task Board 注入指令、`lane_key` 参数签名、LANE_CONFLICT 不实陈述；如实描述 dispatch-guard 两规则 + task_status 轮询 + task_result→task_revive 协议；派发签名改为真实 schema `subagent(agent, description, prompt, background)`。
6. 非目标：不新增 lane 拦截/看板工具（方向 B 已否决）；不动 `host-fallback` 相关测试 stub 防御分支（`typeof ensureRegistered === 'function'`）；不改 dispatch-guard 两规则语义；旧 tasks.json 记录 `laneKey:'host-fallback'` 无 schema 变化，仅字符串差异，自然兼容；`src/config/task-state.ts`（9 值 TASK_STATES，仅自身测试引用、无生产导入，Momus r1 提出）保留不动，声明为后续独立清理项——本计划"唯一源"指 task 运行时域（runtime/tools）内的唯一源。

## 任务

### T1 — RED：运行时行为测试

- Wave：1；Depends on：无
- Files：`src/runtime/task-index.test.ts`、`src/runtime/subagent-bridge.test.ts`、`src/runtime/task-coordinator.test.ts`、`src/runtime/task.test.ts`、`src/runtime/native-orchestration.e2e.test.ts`
- 目标：a) 哨兵 lane 并发登记不冲突、显式 lane 冲突保持；b) bridge 无 lane → pending 真实 agent + `unlabeled` 登记；c) registerRevive active → `ACTIVE_CONFLICT`（含 e2e:124 断言数组 `['NOT_REVIVEABLE','LANE_CONFLICT']` 改为 `['NOT_REVIVEABLE','ACTIVE_CONFLICT']`）；d) `outcomeToState` 映射表；e) `task.test.ts` 全量改写为新签名 `resolveTaskHostStatus({taskID, state})` 等价断言（含宿主不可达回退本地，删除 `status:'unknown'` 死枚举用例）；f) ensureRegistered 兜底 lane 断言改 `unlabeled`。先跑出失败。
- 验收：新增断言在 T2 前失败。
- 命令：`bun test src/runtime/task-index.test.ts src/runtime/subagent-bridge.test.ts src/runtime/task-coordinator.test.ts src/runtime/task.test.ts src/runtime/native-orchestration.e2e.test.ts`

### T4 — RED：提示词契约测试

- Wave：1；Depends on：无（与 T1 文件无交集，可并行）
- Files：`src/agents/orchestrator-context.test.ts`
- 目标：断言编排提示词不再包含 `Background Job Board` 注入指令与 `lane_key` 参数签名；包含 dispatch-guard agent+objective 规则与 task_result→task_revive 协议的如实描述。先跑出失败。
- 验收：新断言在 T5 前失败。
- 命令：`bun test src/agents/orchestrator-context.test.ts`

### T2 — GREEN：运行时生产实现

- Wave：2；Depends on：T1
- Files：`src/tools/task/types.ts`、`src/runtime/task-index.ts`、`src/runtime/task-coordinator.ts`、`src/runtime/subagent-bridge.ts`、`src/runtime/task.ts`、`src/runtime/dispatch-guard.ts`、`src/tools/index.ts`、`src/tools/task/revive.ts`；条件性修改（仅按失败需要修正断言、不改语义）：`src/tooling-integration.test.ts`、`src/tooling-registration.test.ts`
- 目标：实现设计决策 1/2/4 全部要点。
- 禁区：不删 formatBoard/resolveReusable（T3 做）；不改工具对外行为语义。
- 验收：T1 全绿 + `bun run typecheck`。
- 命令：`bun test src/runtime src/tools/task && bun run typecheck`

### T3 — 删除死代码 + 测试清理

- Wave：3；Depends on：T2（与 T5 无文件交集，可并行）
- Files：`src/runtime/task-coordinator.ts`、`src/runtime/subagent-bridge.test.ts`、`src/runtime/task-coordinator.test.ts`、`src/runtime/native-orchestration.e2e.test.ts`
- 目标：删 `formatBoard`/`resolveReusable`；3 个测试文件共 16 处引用改为 `listByParent` 等价断言；不放宽断言。
- 验收：typecheck + 定向测试绿；grep 全仓无 formatBoard/resolveReusable 残留（生产与测试均无）。
- 命令：`bun test src/runtime && bun run typecheck && grep -rn "formatBoard\|resolveReusable" src || true`

### T5 — GREEN：提示词改写

- Wave：3；Depends on：T4（与 T3 无文件交集，可并行）
- Files：`src/agents/sisyphus.ts`、`src/agents/oceanus.ts`、`src/agents/orchestrator-context.ts`、`src/skills/sisyphus-execute.ts`
- 目标：三份编排提示词按设计决策 5 改写，内容保持相互一致；`sisyphus-execute.ts` 第 30/59/69 行三处 `lane_key` 教学同步删除（Momus r1 问题 3，第四个提示面）；不改工具实现。
- 验收：T4 转绿；`bun test src/agents src/skills` 全绿（index.test.ts 既有协议断言不破坏；stages.test.ts 已确认无 lane 断言）。
- 命令：`bun test src/agents src/skills`

### T6 — FINAL：全量验证与账本收尾

- Wave：4；Depends on：T3、T5
- Files：无生产修改；仅允许按失败需要修正 T1/T4 测试文件
- 目标：`bun test` 全量 + `bun run typecheck`；diff 审计仅限本计划 Files；更新 progress 账本至终态。
- 命令：`bun test && bun run typecheck`

## 执行策略

- TDD：RED（T1/T4）→ GREEN（T2/T5）→ 删除清理（T3）→ FINAL（T6）；删除型任务以 typecheck + 全量绿为验收，不得放宽断言。
- Worktree：共享工作区；同 Wave 任务 Files 无交集（T1⊥T4、T3⊥T5）才并行，其余串行；禁止 worker 执行 git 写操作。
- 基线：T1 派发前对全部 Files 执行 `git diff -- <files>` 存档，T6 逐文件比对。

## 风险与缓解

- 旧 tasks.json 的 `host-fallback` 记录：无 schema 变化，旧行可查；仅新登记使用哨兵。
- subagent-bridge.test 8 处 formatBoard 断言改写量大但机械；以 listByParent 组装等价文本断言。
- 契约文本断言可能散布：已 grep 确认仅 orchestrator-context.test.ts:21-23 一处 + index.test.ts 工具协议断言（不涉及 lane/Board）。
- 残余风险（如实陈述，Momus r1）：`ensureRegistered` 兜底登记路径 agent 仍为 `'unknown'`（工具层无 agent 信息可带）——bridge 正常登记路径的 agent 丢失由本计划修复，但 bridge 完全未运行的兜底场景下 dispatch-guard 规则②对该记录依旧无法命中；彻底解决需把 agent 传入工具上下文，超出本计划范围。

## Momus 门禁

- 状态：r1 REJECT → 已修订，待 r2 复审
- 轮次：2
- r1 结论（2026-08-28，ses_fb917c65cffe3WQnZu51qwknf6）：REJECT——问题1 e2e:124 断言未纳入（已并入 T1）；问题2 task.test.ts 旧签名缺失（已并入 T1）；问题3 sisyphus-execute.ts 第四提示面（已纳入 T5）；三条一致性建议（T2 条件文件、config/task-state.ts 非目标声明、兜底 agent 残余风险）均已采纳。
