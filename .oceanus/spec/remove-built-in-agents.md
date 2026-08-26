# 删除内置 build/plan agent

## 目标

通过 OpenCode V2 插件 API 删除内置 `build` 和 `plan` agent，并保留插件现有的默认 agent 设置逻辑。

## 决策

- 在 `ctx.agent.transform` 中使用 `draft.get()` 判断 agent 是否存在。
- 对存在的 `build`、`plan` 调用 `draft.remove()`。
- 保留现有 agent 更新、默认 agent 和 reload 流程。
- 不在本次变更中改造 V2 API 下自定义 agent 的注册方式。

## 验证

- `bun run typecheck`
- `bun run build`
