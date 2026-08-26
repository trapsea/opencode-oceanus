# Oceanus Sidebar 设计规格

## 目标

通过独立的 `opencode-oceanus/tui` 入口，在 OpenCode TUI 的 sidebar 中显示 Oceanus 标题、当前会话 agent，以及 Oceanus 内置 agent 的模型映射。

## 范围

- 保持主插件与 TUI 插件双入口：主入口注册 agent/skill，`opencode-oceanus/tui` 注册 sidebar。
- 显示 `oceanus`、`sisyphus` 及各 specialist agent。
- 从 OpenCode 当前 agent registry 读取模型和 agent 状态；未指定模型时显示“跟随会话”。
- 显示当前活动 agent，并保留 agent 颜色和模型 variant 信息。
- 补充 README 中的 TUI 插件配置与使用说明。
- 不实现 preset、模型编辑、运行时模型切换或任何 agent prompt/权限/skills/MCP 配置变更。

## 运行语义

- TUI 启动时同步 agent 数据；sidebar 使用 `sidebar.content` slot 追加面板。
- 面板数据以当前会话和 agent registry 为准，避免读取另一套可能过时的配置模型。
- agent registry 不可用时显示同步中的降级提示，不阻塞 TUI。

## 验收标准

1. `npm/bun` 构建和 TypeScript 类型检查通过。
2. README 明确说明需要同时配置主入口和 `/tui` 入口。
3. sidebar 面板显示 Oceanus 标题和所有已注册 Oceanus agent 的模型；模型缺失时有明确降级文本。
4. 当前 agent 有可见状态标识，variant 可见。
5. 不引入 preset 配置或修改现有 agent prompt、权限、skills、MCP 语义。

## 约束与已确认决策

- 采用 OpenCode v2 TUI API 的标准双入口方式。
- 参考 omo-slim 的 sidebar 信息展示思路，但不迁移 preset 功能。
- 现有工作区中 `.oceanus/spec/` 和 `.oceanus/plan/` 可追踪，`.oceanus/progress/` 保持忽略。
