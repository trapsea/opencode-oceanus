# Spec: /preset 切换后 sidebar agent→模型展示不刷新的修复

日期: 2026-08-27
状态: 已批准（用户明确选择"批准，开始实施"）

## 根因（实证）

1. `/preset` 切换 → 插件写配置 + `ctx.agent.transform()+ctx.agent.reload()` → server registry 正确更新（GET /api/agent 验证返回新 model）。
2. **上游缺陷**：OpenCode server 的 Agent service 在 transform/reload 提交后发布的 `agent.updated` 事件 payload 为 `{}`、**不带 location**（二进制逆向 `finalize: () => _.publish(Event.Updated, {})` + SSE 抓包双证：两次 agent.updated 均 NO-LOC）。
3. TUI client 数据层内建自动失效路径要求 `event.location` 存在才执行 `location.agent.invalidate+sync`（client data 层 `if (!event.location) return;` 位于 agent.updated 分支之前）→ 标准同步路径完全失效。
4. 本插件 tui.tsx 兜底监听（agent.updated 无 location 也刷 / inbox.delivered 刷）是事件驱动单次触发；多窗口各自独立订阅 store，任一窗口错过事件即陈旧，且后续 session 状态事件只触发 memo 重算不重新拉数据——陈旧持续到挂载/重连/新会话。
5. 用户实测现象："部分行/部分窗口不一致"，与上述机制吻合。
6. 附带缺陷：`applyAgentDefinitions` 仅在 `def.model` 存在时赋值，切换到"该 agent 无 model 定义"的 preset 时 server registry 残留旧 model。

## 批准的设计（方案 A'：slim 哲学 × 热加载现实）

参考 /apple/workspace/ai/oh-my-opencode-slim/src/tui.ts 的 renderTimer 快照模式（1s interval 读盘 + requestRender，不依赖事件系统）。oceanus 因 preset 支撑对话中 agents 即时重定义（reloadAgents 有意热加载），model 行显示必须以 registry 为准，故采用"preset 指纹变化才拉取"的确定性兜底。

### 改动点

1. `src/tui.tsx` AgentModelPanel：
   - 新增 ~2s interval ticker；每 tick 同步读盘 `loadPluginConfig({directory}).preset` 与上次指纹比较；
   - 指纹变化 → `refreshAgents()`（invalidate+sync）；同值零网络开销；
   - `onCleanup` 清理 timer；
   - 保留现有 agent.updated / inbox.delivered 监听作快速路径。
2. `src/index.ts` applyAgentDefinitions：`def.model` 缺失时显式清除 draft 中残留的 `agent.model`。

### 非目标

- 不改回 slim 式"只写盘不热加载"（即时重定义是对话中的核心能力）。
- /preset 去 LLM 化（dialog 化）：后续独立任务。
- 上游 issue（Agent.Updated 应带 location）：另行报告，不在本仓库改动范围。

## Metis 分析

Metis 未委派（跳过理由）：实证证据链已将方案空间收窄到唯一可行方向（插件侧确定性兜底；SDK 无 publish 能力排除其他路径），无未决方案选择需要独立分析。残余风险：ticker 读盘在极端文件系统延迟下的抖动——影响可忽略（同步读本地 jsonc）。

## 验收标准

- [ ] 切换 preset 后 ≤ 一个 tick（~2s）+ sync 时长，所有窗口 sidebar agent 行与 preset 名一致更新（事件到达时秒级，事件丢失时 tick 兜底）。
- [ ] 无事件路径下（模拟错过 inbox.delivered）仍能自愈。
- [ ] 切换到含"无 model 定义的 agent"的 preset 后 registry 不残留旧 model。
- [ ] 同值 tick 不产生对 server 的额外请求（仅本地读盘）。
- [ ] typecheck 通过；现有测试不回归；新增纯函数测试覆盖指纹比较逻辑。
