import type { SkillDefinition } from './types';

/** Oceanus 配置与 preset 使用说明，由插件运行时注入。 */
const OPENCODE_OCEANUS_SKILL: SkillDefinition = {
  name: 'opencode-oceanus',
  description:
    'Configure Oceanus agents and presets, understand configuration priority, and use /preset to select an agent preset.',
  slash: true,
  content: `---
name: opencode-oceanus
description: Configure opencode-oceanus agents and presets, including configuration priority, v2 limitations, and the /preset command.
---

# opencode-oceanus 配置

## 配置文件

Oceanus 只读取自己的配置文件（JSONC，也支持 JSON）：

- 用户级：\`~/.config/opencode/opencode-oceanus.jsonc\`
- 项目级：\`.opencode/opencode-oceanus.jsonc\`

项目级配置覆盖用户级配置；项目配置适合固定当前项目的 agent 行为。

顶层可配置字段：

- \`preset\`：当前使用的 preset 名称。
- \`presets\`：preset 名称到 agent 配置覆盖对象的映射。
- \`agents\`：按 agent 名称配置的显式覆盖。
- \`disabled_agents\`：禁用的 agent 名称（\`oceanus\` 受保护，不能禁用）。
- \`disabled_tools\`：禁用的工具名称数组。

## 优先级与合并

配置按以下顺序合并，越靠后优先级越高：

1. 用户级配置；
2. 项目级配置（同名 \`agents\` 与 \`presets\` 递归合并）；
3. \`presets[preset]\` 作为当前 preset 的 agent 配置基础；
4. 显式 \`agents\` 覆盖 preset，同一 agent 的同一字段以显式配置为准。

如果 \`preset\` 不存在于 \`presets\`，插件会警告并仅使用显式 \`agents\`。项目级 \`preset\` 会覆盖用户级选择。

Agent 覆盖支持 \`model\`、\`temperature\`、\`variant\`、\`prompt\`、\`orchestratorPrompt\`、\`displayName\`、\`description\`、\`color\`、\`options\` 和 \`permission\` 等字段。

## OpenCode v2 限制

\`skills\` 和 \`mcps\` 虽然被 Oceanus schema 接受，但当前 OpenCode v2 的 \`Agent.Info\` 没有对应的直接字段，因此不会映射到 agent，并会输出警告。它们也不会替代插件注入的 \`sisyphus-*\` skills。

## 使用 /preset

\`/preset\` 是 TUI 插件提供的斜杠命令（与内建 \`/models\` 同一通道），不经过模型，不会创建新的 LLM turn。

- \`/preset\`：打开三级 preset 管理器（列表 → agents → 单 agent 的 model/variant/temperature/options），支持应用、编辑、新建、删除。
- \`/preset <name>\`：按名称快速切换到已存在的 preset。

生效语义（参考 oh-my-opencode-slim）：切换只把 preset 名称原子写入用户级配置顶层 \`preset\`，保留其它字段；**不热切换当前 session 的 agent registry**。新 preset 在下一次新会话或重启 OpenCode 时由配置加载流程生效。这是刻意设计：会话内热切换 agent 模型可能截断上下文（新模型上下文窗口可能更小）、漂移历史 turn、使运行中的 subagent 引用悬空。当前会话保持现有 agent 模型不变，sidebar 顶部会显示已保存的 preset 名称。
`,
};

export { OPENCODE_OCEANUS_SKILL };
