# Oceanus Agent Preset 设计

## 目标

参考 oh-my-opencode-slim，为 Oceanus 增加配置文件中的 agent preset，并通过 TUI `/preset` 选择和切换预设。

## 范围

- 支持顶层 `preset` 当前预设名。
- 支持顶层 `presets`，按预设名保存 agent 完整覆盖配置。
- 支持字段：`model`、`temperature`、`variant`、`skills`、`mcps`、`prompt`、`orchestratorPrompt`、`options`、`displayName`、`description`、`permission`。
- `/preset` 在 TUI 中展示已有预设、标记当前预设，并将选择写入用户级 Oceanus 配置。
- 切换后提示 reload 或新建会话；不承诺当前会话即时重建 agent。

## 配置与优先级

复用 `opencode-oceanus.json/jsonc`。项目配置优先于用户配置；同一份合并后的配置中，当前 `presets[preset]` 为基础，显式 `agents` 覆盖 preset。不存在的 preset 只警告并回退到显式 `agents`。

## 实现约束

- 使用现有配置路径搜索规则；`/preset` 只写用户级配置。
- 保持 JSONC 的注释/尾逗号兼容；写入失败通过 toast/警告反馈。
- agent 定义层应用完整覆盖字段，无法映射到 v2 Agent.Info 的字段需保持配置兼容并按当前 API 能力处理。
- 保持现有 disabled agent 与 protected agent 语义。

## 验收

1. 配置可通过 schema 校验并正确解析 preset。
2. 当前 preset 与显式 agents 的合并优先级正确。
3. `/preset` 可列出、选择并持久化预设；无预设、未知预设和写入失败有明确反馈。
4. 现有 agent 注册、TUI sidebar 与配置行为不回归。
5. 通过 typecheck、测试和 build。
