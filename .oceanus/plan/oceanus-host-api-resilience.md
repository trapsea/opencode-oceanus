# Oceanus 宿主 API 韧性计划

## 状态

- Spec：`.oceanus/spec/oceanus-host-api-resilience.md`（用户已批准）
- TDD：严格 RED → GREEN；每个故障场景先写 mock-host 失败测试。
- Worktree：用户确认共享工作区、串行执行；禁止 Git 操作。
- 保护范围：不得修改已有未提交的 `src/agents/*`、`src/skills/sisyphus-execute.ts`、`xx.sql` 或既有删除项。
- Momus：第 1、4 轮 REJECT 均已实质修订；第 2/3/5 轮结果读取故障；独立第 6 轮复审 OKAY，待人工 APPROVED。
- 执行状态：用户在 R1 开始前要求停止，并扩大为允许且推荐重构的全面审计；本计划已失效，R1/R2 均未修改源码或测试。
- 影响面预估：CBM 查询因 `index_status_failed:unparsed_status` 降级为文本检索。受影响符号为 public `runSetup`、其生产入口 `Plugin.define(...).setup`、内部共享函数 `applyAgentDefinitions`，以及 `/preset` 通过 `PresetCommandHandlers.reloadAgents` 间接调用的 reload 契约。直接测试调用方为 `src/smoke/cbm-wiring.test.ts`、`src/runtime/production-task-harness.test.ts`、`src/runtime/native-orchestration.e2e.test.ts`。计划不改变对外 API；新增的诊断仅为控制台日志。

## 文件映射

- `src/index.ts`：`runSetup` 的 agent、skill、command transform/reload 注册阶段。
- `src/smoke/setup-resilience.test.ts`（新增）：针对 mock-host 缺失或拒绝 API 的 RED/GREEN 回归契约，含 `/preset` reload。

## 任务

### R1 — RED：固化宿主注册失败隔离契约

- Wave：1
- Depends on：无
- Files：`src/smoke/setup-resilience.test.ts`
- 目标：新增 mock host 测试，固定下列矩阵：
  - agent、skill、command 三个域分别覆盖 `transform` 缺失/抛错、`reload` 缺失/抛错；
  - agent、skill、command 三个域对象自身缺失时，分别验证阶段隔离与稳定诊断；
  - agent 的已有 registration `dispose()` 抛错也必须隔离；
  - `agents.dispose` 失败时不再尝试新的 agent transform/reload（避免残留注册叠加），但 skill、command、tools、hooks 必须仍被尝试；`/preset` 必须以包含 `agents.dispose` 的可诊断错误拒绝本次切换；
  - 每个失败场景中，后续独立注册域以及 tools/hooks 注册均仍会被尝试；
  - 诊断须包含稳定阶段标识（`agents.transform`、`agents.reload`、`skills.transform`、`skills.reload`、`commands.transform`、`commands.reload` 或 `agents.dispose`）及原始错误文本；
  - 经注册的 `/preset` 调用 agent reload 缺失/抛错时，命令失败可诊断但不会留下未处理异常；正常 `/preset` reload 行为保持不变。
- 禁区：不修改生产代码；不编辑现有测试或未提交文件。
- 验收：在未实现前测试明确 RED；测试仅依赖 mock host（包括捕获注册的 `preset` command）与 console spy，不需要真实 OpenCode。
- 验证：`bun test src/smoke/setup-resilience.test.ts`（预期先失败）。

### R2 — GREEN：阶段化能力预检与降级

- Wave：2
- Depends on：R1
- Files：`src/index.ts`
- 目标：为 agent、skill、command 域对象、`transform` 和 `reload` 添加阶段化能力预检、异常隔离和稳定诊断；agent registration 的 dispose 失败时跳过本轮 agent 更新以避免叠加旧闭包，但继续后续独立阶段，并使 `/preset` 以可诊断错误拒绝切换；保持 `applyAgentDefinitions` 被 setup 与 `/preset` 共用时的明确错误语义；保持正常成功路径和注册顺序。
- 诊断通道：新增注册阶段错误仅使用专用 `registrationLog`，默认 `console.warn` 输出 `[oceanus] <stage>` 与原始错误；若测试/调用方提供 `options.cbm?.logger`，则优先通过该 logger 输出。既有 CBM 子系统的 `log` 默认 noop 语义不改变。
- 禁区：不引入跨版本 draft 适配、不修改供应商配置、不修改现有未提交文件。
- 验收：R1 转绿；现有 `runSetup` smoke/生产任务/原生编排测试继续通过；错误日志含 `[oceanus]`、稳定阶段名及原始错误；`/preset` reload 仍满足命令契约。
- 验证：`bun test src/smoke/setup-resilience.test.ts src/smoke/cbm-wiring.test.ts src/runtime/production-task-harness.test.ts src/runtime/native-orchestration.e2e.test.ts src/commands/index.test.ts && bun run typecheck`。

## Momus 审查记录

- Verdict：OKAY（第 6 轮独立复审）
- Round：6
- 时间：2026-08-28
- 问题：第 1 与第 4 轮问题已修订。第 2/3/5 轮的宿主结果载荷为空，不能据此推定裁决；第 6 轮独立 Momus 审查确认文件边界、TDD 依赖、三域/dispose/`/preset`/日志测试矩阵和回归命令充分。
- 影响面预估：见“状态”；CBM 不可用导致图谱路径不确定，已记录文本检索的已知调用方。
