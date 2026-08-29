# Oceanus 宿主 API 韧性

## 背景

OpenCode 日志显示其它插件在宿主 API 漂移时出现 `draft.update is not a function` 与上下文桥接缺失。该证据不归因于 Oceanus；但 Oceanus 的 agent、skill、command 注册路径缺少与 tools/hooks 一致的阶段化诊断和降级边界。

## 目标

在不修改 OpenCode 供应商配置、不触碰既有未提交源码变更的前提下，使 Oceanus 对宿主注册 API 缺失或注册失败能够：

1. 输出包含阶段名称和原始错误的可诊断日志；
2. 隔离独立注册阶段，避免单一注册阶段阻断后续可用功能；
3. 通过回归测试固定上述行为。

## 方案

为 agents、skills、commands 注册及相应 reload 建立能力预检与阶段化 fail-open 包装。缺失或抛错时记录稳定的 Oceanus 日志前缀和阶段名，继续尝试不依赖该阶段的后续注册。保留现有成功路径、注册顺序与 public API。

## 范围与非目标

- 范围：`src/index.ts` 的 setup 注册流程及对应测试。
- 非目标：修复 `oh-my-opencode-slim`，修改模型渠道、额度、base URL 或实现猜测性的多版本 draft 兼容层。
- 保留工作区已有未提交的 `src/agents/*` 及其他变更；实现不得覆盖它们。

## 验收

- mock 宿主缺失/拒绝 agents、skills、commands 的注册或 reload 时，setup 不抛出且记录阶段化诊断；
- 未受影响的独立阶段仍被调用；
- 正常宿主路径仍通过现有测试；
- 新增测试、相关测试和 `bun run typecheck` 通过。

## Metis 分析

未调用：方案选择已由日志归因和现有代码路径直接确定，且不存在需要独立权衡的候选架构。残余风险是 OpenCode beta API 的实际语义只能通过 mock 契约覆盖，不能由本地日志完全证明。
