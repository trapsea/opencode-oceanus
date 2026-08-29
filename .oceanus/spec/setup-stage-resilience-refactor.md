# Setup 阶段韧性有限重构

## 目标

将 Oceanus 的插件注册改为显式、串行、可观测的内部阶段编排：单一可选注册阶段失败不能阻断其它独立能力，同时保持当前公共 API、注册顺序与 tools/hooks 行为。

## 范围

- 为 agents、skills、commands、MCP、tools、hooks、auto-update 提供统一阶段结果与故障报告。
- 提取 `runSetup` 的域注册函数，保留其为顺序编排入口。
- 组合已证实安全的 agent registration 与 auto-update cleanup。
- 为 mock-host 故障、阶段继续执行、报告、`/preset` 重试、cleanup 补充测试。

## 边界与非目标

- 不修改模型、供应商、额度、URL 或 `oh-my-opencode-slim`。
- 不引入多版本宿主 API 适配层，不包装 draft API。
- 不重构既有 tools/hooks 的局部隔离实现。
- 不实现未经真实 host 验证的 agent rollback、MCP teardown 或异步 MCP cancellation；这些保留给后续 host smoke。
- 不覆盖已有未提交的 agent/skill 提示词变更。

## 设计

内部 `StageOutcome` 和阶段执行器负责错误归一化、稳定报告及继续后续独立阶段。配置加载为基础阶段，保持硬失败；其余注册阶段 fail-open。报告使用专用注册 reporter，默认 `console.warn`，不改变 CBM logger 的 noop 语义。

agents 注册继续遵守现有“先释放旧 registration，避免闭包叠加”的保守语义；失败结果可观测、后续阶段可用、后续 `/preset` 可重试，但不声明回滚保证。

## 验收

1. agent/skill/command transform 或 reload 失败时，后续独立阶段仍执行；
2. 错误报告含 `[oceanus]`、稳定阶段名和原始错误；
3. setup cleanup 调用 agent registration dispose 与 auto-update cleanup；
4. 正常路径、`/preset` 重试与现有工具/Hook 接线回归通过；
5. `bun test`、`bun run typecheck`、`bun run build` 通过。

## Metis 分析

未执行。现有源码、日志归因与 Oracle 审查已消除方案选择不确定性；残余风险是宿主 registration 原子性与 teardown 语义，明确排除至真实 host smoke 后续任务。
