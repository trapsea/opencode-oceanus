# Preset 切换自动 reload 设计

## 目标

执行 `/preset <name>` 成功修改用户级 preset 后，自动调用 OpenCode v2 的 `ctx.agent.reload()`，让当前窗口的 agent registry 尽快加载新配置。

## 行为

- 只有成功切换到已存在的 preset 后调用 `ctx.agent.reload()`。
- `/preset` 查询、不存在的 preset、配置写入失败时不调用 agent reload。
- 保留现有 command/skill reload 与会话反馈。
- 明确提示：agent registry 已刷新；当前 session 是否立即替换已选 agent 取决于 OpenCode runtime，必要时仍需新建会话。

## 验收

1. 成功切换路径调用一次 `ctx.agent.reload()`。
2. 查询和失败路径不调用 `ctx.agent.reload()`。
3. 现有测试、typecheck、build 通过。
