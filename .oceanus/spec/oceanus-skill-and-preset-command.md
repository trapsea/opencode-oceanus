# Oceanus Skill 与原生 preset Command 设计

## 目标

为 `opencode-oceanus` 增加一个运行时注入的 `opencode-oceanus` skill，并通过 OpenCode v2 plugin command API 注入原生 `/preset` 命令，用于查看和切换 Oceanus agent preset。

## 已确认决策

- skill 由 Oceanus 插件运行时通过 `ctx.skill.transform` 注入，不写入用户目录。
- 使用 OpenCode 原生 command API，不保留现有 TUI `/preset` 命令，避免同名命令冲突。
- `/preset <name>` 切换用户级配置中的当前 preset。
- `/preset` 无参数时反馈当前 preset 与可用 preset 列表，不修改配置。
- 复用现有配置加载、preset 合并和原子写入逻辑。

## Skill 内容

新增 `opencode-oceanus` skill，参考 `oh-my-opencode-slim` 的配置说明，但仅描述 Oceanus 配置：

- 用户级 `~/.config/opencode/opencode-oceanus.jsonc`；项目级 `.opencode/opencode-oceanus.jsonc`。
- `preset`、`presets`、`agents`、`disabled_agents`、`disabled_tools` 字段。
- 用户级与项目级配置优先级，以及 preset 与显式 agents 的合并规则。
- OpenCode v2 中 `skills` / `mcps` 不直接映射到 `Agent.Info` 的限制。
- `/preset` 的查看、切换、reload/新会话说明。

## Command 行为

- command 名称：`preset`。
- 有参数时：trim 参数，校验是否存在于已加载配置的 `presets`，成功后调用 `updateUserPreset`；错误通过会话可见的 command 结果反馈。
- 无参数时：列出当前配置可见的 preset，并标记当前项。
- 项目配置覆盖 `preset` 时，切换用户级 preset 不改变项目最终生效值；结果中应明确这一点（如 API 能力允许）。
- 成功切换后提示 reload 或新建会话。

## 代码范围

- 新增 `src/skills/opencode-oceanus.ts` 并加入 `src/skills/index.ts`。
- 在 `src/index.ts` 注入 skill 和原生 command。
- 从 `src/tui.tsx` 移除旧 `/preset` command 注册，保留 sidebar。
- 增加 command/skill 注册与参数、配置行为测试。

## 验收标准

1. Oceanus 插件注册 `opencode-oceanus` skill。
2. Oceanus 插件注册唯一的原生 `preset` command。
3. `/preset` 能列出当前配置中的 preset。
4. `/preset sea` 能原子更新用户级配置并拒绝未知名称。
5. 现有 agent、sidebar、配置合并行为不回归。
6. `typecheck`、测试和 `build` 通过。
