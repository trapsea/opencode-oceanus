# Preset 按 location 隔离设计（替代全局共享）

## 目标

让 `/preset <name>` 的切换**只对当前 location（工作目录）生效**，不再影响所有窗口/项目。
用户诉求：只对当前窗口及新开窗口生效，且**子 agent 实际模型也隔离**。

## 背景与现状问题

当前 `/preset`（`src/commands/preset.ts` → `updateUserPreset`）把所选 preset 写入
**用户级全局配置** `~/.config/opencode/opencode-oceanus.jsonc` 顶层 `preset`。
插件 setup 与 `/preset` 的 reload 都用 `process.cwd()` 加载该全局配置
（`src/index.ts:124,181-184`），然后 `applyAgentDefinitions` → `ctx.agent.transform + reload`。

由于 agent 注册表按 **location 共享**（见下方平台约束），修改全局配置后 reload，
会让**所有 location 的 agent 一起变**。这正是用户观察到的"多窗口模型全变"。

## v2 平台约束（源码确认）

- **无窗口 / 客户端 / 连接标识**。请求之间唯一的身份维度是
  `Location.Ref = { directory, workspaceID }`（`packages/server/src/location.ts:29-39`；
  `event-feed.ts:29-36` 订阅者匿名）。
- **Agent 注册表按 location 隔离共享**：同一 `directory+workspaceID` 命中同一缓存实例，
  其内 `Agent.node/Plugin.node/Config.node` 各一份（`packages/core/src/location-services.ts:115-166`）。
  `ctx.agent.transform` 只能改当前 location 的注册表（`plugin/host.ts:103-112`），**没有会话维度**。
- **`ctx.storage` 全局**，仅按插件名命名空间（`plugin/host.ts:457-484`；KV 全局 SQLite `kv.ts:36-92`）。
- **配置优先级**：项目 `.opencode/` 高于全局 `~/.config`（`config.ts:207-286`，`latest` 31-34）。

**结论**：子 agent 实际调用用的模型来自 location 级注册表，因此
"子 agent 实际模型隔离"**只能按 location（目录）做到，无法按会话/窗口做到**。

## 推荐方案：按 location（目录）隔离 preset

让 `/preset` 把选择写入**当前目录的项目级配置** `<cwd>/.opencode/opencode-oceanus.jsonc`，
并仅 reload 当前 location。项目配置优先级高于用户全局配置，因此只有该目录的窗口的
agent 实际模型改变；不同目录的窗口各自独立。

### 行为

1. `/preset <name>` 校验 name 存在后，写入 **当前 location 的项目配置**
   `<cwd>/.opencode/opencode-oceanus.jsonc` 顶层 `preset`（原子写，复用现有
   `updateUserPreset` 的临时文件+rename 逻辑，改为可指定目标路径）。
2. 以该 location 重新加载配置（`loadPluginConfig({ directory: location.directory })`），
   重新 `applyAgentDefinitions` + `ctx.agent.reload()`（作用于当前 location）。
3. 其他目录的窗口：不共享此项目配置，不受影响。
4. 新开窗口（同一目录）：读取该目录项目配置，继承该 preset。
5. 查询路径 `/preset`：展示当前目录的生效 preset + 可用列表。

### location 目录如何获取

插件 setup ctx 本身无 location 字段；但 `ctx.agent.list()` 的响应信封带
`location.directory / workspaceID / project`（`plugin/host.ts:55-72,100`）。
在 setup 里 `const { location } = await ctx.agent.list()` 取当前 location，
作为 `/preset` 写入目标与配置加载目录（替代 `process.cwd()`，二者当前一致，但语义更正确）。

## 改动文件

- `src/commands/preset.ts`：`runPresetCommand` 支持写入目标配置路径（location 项目配置而非全局）。
- `src/config/presets.ts`：`updateUserPreset` 增加可指定目标路径参数（已支持 `configPath`，扩展调用方）。
- `src/index.ts`：
  - setup 通过 `ctx.agent.list()` 取 location，作为配置加载目录；
  - `/preset` 的 `reloadAgents` 按该 location 重载配置并 `applyAgentDefinitions`。
- `src/commands/preset.test.ts` / 相关测试：覆盖写入目标路径、目录级优先。

## 限制与取舍（必须让用户知情）

- **同一目录下的多个窗口仍共享**同一 location 的 agent 注册表与项目配置。
  这是 v2 平台级限制（无窗口标识 + agent 按 location 共享），插件无法绕过。
  若用户真实场景是同目录多窗口，本方案无法实现"按窗口"隔离，只能做到"按目录"。
- 项目配置写进 `<cwd>/.opencode/`，若该目录是 git 仓库，`opencode-oceanus.jsonc`
  会成为未跟踪文件（可 `.gitignore`，或接受它进入项目配置）。

## 待确认决策点

1. 是否接受"按目录隔离"（子 agent 实际模型真隔离的唯一可行粒度）？
   - 是 → 进入 plan/execute 实现本 spec。
   - 否 → 需重新定义需求（例如仅会话级隔离 sidebar 显示 + 主模型，放弃子 agent 模型真隔离）。
2. 项目配置写入是否接受（git 未跟踪文件）？或改用 location 级 storage（需在
   `loadPluginConfig` 引入 storage 读取，复杂度更高）。

## 验收

1. `/preset <name>` 只改变当前目录项目的 agent 实际模型；不同目录窗口不受影响。
2. 新开窗口（同目录）继承该目录 preset。
3. 查询路径展示当前目录生效 preset 与可用列表。
4. 现有 preset/命令/agent/TUI 行为不回归（typecheck、测试、build 通过）。
5. 同目录多窗口限制有文档说明与运行时提示（不静默）。
