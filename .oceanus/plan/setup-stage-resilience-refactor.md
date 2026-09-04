# Setup 阶段韧性有限重构计划

## 状态

- Spec：`.oceanus/spec/setup-stage-resilience-refactor.md`（用户已批准）。
- Momus：第 1、2 轮 REJECT 均已实质修订；复用会话结果读取异常；独立第 3 轮审查 OKAY，待人工 APPROVED。
- 影响面：`runSetup`、`applyAgentDefinitions`、`/preset` 的 `reloadAgents`、插件 cleanup 返回值，以及构建产物调用方 `scripts/verify-dist-skills.ts`；CBM 本轮索引超时，待 Momus 查询型复核并 fail-open 记录。
- 保护范围：不修改已有未提交的 `src/agents/*`、`src/skills/oceanus-execute.ts`、`xx.sql` 或既有删除项。

## 文件映射

- `src/runtime/setup-stages.ts`（新增）：阶段结果、报告、串行可选阶段执行器与 cleanup 组合。
- `src/runtime/setup-stages.test.ts`（新增）：阶段执行器 RED/GREEN 单元契约。
- `src/index.ts`：以阶段执行器编排现有注册，提取域注册闭包，组合安全 cleanup。
- `src/smoke/setup-resilience.test.ts`（新增）：mock-host 注册失败、后续阶段、报告、`/preset` 重试和 cleanup 集成契约。

## 任务

### S1 — RED：阶段执行器契约
- Wave：1
- Depends on：无
- Files：`src/runtime/setup-stages.test.ts`
- 目标：先定义 `StageOutcome`、可选阶段错误报告、串行执行和 cleanup 组合的失败测试。
- 验收：测试在实现前明确 RED；覆盖 sync/async 抛错、后续阶段继续、报告的阶段名/原始错误；导出的 awaitable cleanup runner 按逆序执行、隔离错误。面向宿主的组合 cleanup 保持 `() => void`，内部异步错误经 reporter 处理。
- 验证：`bun test src/runtime/setup-stages.test.ts`（预期失败）。

### S2 — GREEN：实现阶段执行器
- Wave：2
- Depends on：S1
- Files：`src/runtime/setup-stages.ts`
- 目标：最小实现 S1 契约；不感知 OpenCode draft API。
- 验收：S1 转绿且类型检查通过。
- 验证：`bun test src/runtime/setup-stages.test.ts && bun run typecheck`。

### S3 — RED：入口韧性集成契约
- Wave：3
- Depends on：S2
- Files：`src/smoke/setup-resilience.test.ts`
- 目标：使用 mock host 固定以下契约：
  - 配置加载失败是硬失败，且不启动可选阶段；
  - agents、skills、commands 的域对象缺失、transform/reload 同步或异步抛错，均报告稳定阶段名与原始错误，后续独立阶段仍被尝试；
  - MCP 保持 detached：`registerCbmMcp()` 的任何 rejection 统一报告 `mcp.async`，且不阻断 tools、hooks、update；mock MCP Promise pending 时 `runSetup` 必须已返回；
  - tools、hooks、auto-update 失败均报告并允许后续独立阶段；
  - 默认 reporter 使用 `console.warn`，注入 CBM logger 时仅 CBM 日志走该 logger，注册 reporter 不退化为 noop；
  - agent dispose、`/preset` 首次 reload 失败后再次调用可成功，以及 setup cleanup 调用 agent/auto-update cleanup。
- 验收：未接线时明确 RED；不修改生产代码；对 host-facing cleanup 验证调用已触发，对逆序与异步隔离使用 S1 的 awaitable runner 进行可靠断言。
- 验证：`bun test src/smoke/setup-resilience.test.ts`（预期失败）。

### S4 — GREEN：入口阶段化接线
- Wave：4
- Depends on：S3
- Files：`src/index.ts`
- 目标：使用 S2 阶段执行器重构 `runSetup` 与 agent 注册生命周期；保持成功顺序、公共签名 `Promise<(() => void) | undefined>`、现有 CBM/tools/hooks 行为；不实现未验证回滚/MCP teardown。MCP 保持非阻塞：调用立即作为 `mcp` scheduled 记录，`registerCbmMcp()` Promise 的任意 rejection 统一用 reporter 报告 `mcp.async`，不虚构同步失败分支。
- 验收：S3 转绿；失败不阻断独立阶段；报告稳定；agent/auto-update cleanup 经同步包装安全组合；`/preset` 失败可重试。
- 验证：`bun test src/runtime/setup-stages.test.ts src/smoke/setup-resilience.test.ts src/smoke/cbm-wiring.test.ts src/runtime/production-task-harness.test.ts src/runtime/native-orchestration.e2e.test.ts src/commands/index.test.ts && bun run typecheck && bun run build`。

### S5 — Surface：全量回归与构建证据
- Wave：5
- Depends on：S4
- Files：无
- 目标：运行完整测试、类型检查和构建。
- 验收：全部通过；构建后的 `runSetup` 仍能完成 skill 运行时注册验证；真实 host smoke 未运行时明确记录为环境限制。用户禁止 Git 操作，故不以 Git 命令作为本任务验证。
- 验证：`bun test && bun run typecheck && bun run build && bun scripts/verify-dist-skills.ts`。

## Momus 审查记录

- Verdict：OKAY（第 3 轮独立审查）
- Round：3
- 时间：2026-08-28
- 影响面预估：CBM daemon 在 30 秒内不可用，已 fail-open。文本回退确认 `runSetup` 调用方为默认插件入口、`src/smoke/cbm-wiring.test.ts`、`src/runtime/production-task-harness.test.ts`、`src/runtime/native-orchestration.e2e.test.ts` 和构建产物验证 `scripts/verify-dist-skills.ts`；`applyAgentDefinitions` 仅用于 setup 与 `/preset` reload。图谱完整性不确定，Review 阶段复查。
- 问题：第 1 轮要求已纳入 S1/S3/S4/S5：配置硬失败、所有可选阶段矩阵、cleanup 签名和异步隔离、非阻塞 MCP `mcp.async` 报告、默认 reporter/CBM logger 边界，以及移除 Git 验证命令。第 2 轮补充：按 `registerCbmMcp(): Promise` 的真实语义统一 mcp.async rejection，增加 pending 返回断言及 dist 调用方验证。第 3 轮确认依赖、范围、覆盖与已知调用方充分。

### S6 — Review 修复：reporter 故障隔离
- Wave：6
- Depends on：S5
- Files：`src/runtime/setup-stages.test.ts`、`src/runtime/setup-stages.ts`
- 目标：先验证 reporter 抛错不会阻断后续可选阶段或 cleanup，再以最小 try/catch 修复。
- 验收：RED 后 GREEN；失败阶段的 `StageOutcome.error` 保持原始错误对象；reporter 抛错不替换或传播它；cleanup 失败触发 reporter 再失败时，后续 cleanup 仍按逆序执行；`await runner.run()` 与调用 host cleanup 后的 `await runner.done` 均成功解析。
- 验证：`bun test src/runtime/setup-stages.test.ts && bun test && bun run typecheck && bun run build`。

### S6 Momus 复查
- 影响面：`runOptionalStages`、`createCleanupRunner`、`createHostCleanup`；文本回退确认其生产调用方为 `src/index.ts::runSetup`，但不改变调用契约。CBM daemon 不可用，图谱不确定性保留至 Review。
- Verdict：第 1 轮 REJECT，已修订后待审查。
- 问题：补齐原始错误对象、cleanup 逆序/隔离、`runner.run()` 与 `runner.done` 成功解析的可执行断言。
