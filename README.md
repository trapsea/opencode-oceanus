# opencode-oceanus

opencode **v2** 插件：注册 Oceanus agent 编排器及其专家 agent，agent 定义参考 oh-my-opencode-slim 实现（oceanus 颜色 #0FFFFF）。

## 兼容性

- 需要 **opencode v2（beta）**
- 依赖 `@opencode-ai/plugin@beta`（当前锁定 `0.0.0-beta-18230`）
- 入口为 v2 的 `Plugin.define({ id, setup })`，通过 `ctx.agent.transform` 注册 agent

## Agent 列表

| Agent | 角色 | mode |
|-------|------|------|
| `oceanus` | AI 编码编排器（颜色 `#0FFFFF`） | primary |
| `sisyphus` | superpowers 五阶段工作流主导（brainstorm → plan → execute → review → finish） | primary |
| `explorer` | 快速代码库检索 | subagent |
| `librarian` | 外部文档 / 库研究 | subagent |
| `oracle` | 架构决策 / 复杂调试 / 评审 | subagent |
| `designer` | UI/UX 设计与实现 | subagent |
| `fixer` | 有界实现执行 | subagent |
| `observer` | 视觉 / 多媒体分析（**默认禁用**，需要视觉模型） | subagent |

## 安装

opencode v2 有两种加载插件的方式。注意配置字段是 **`plugins`（复数）**，v1 的 `plugin`（单数）已废弃。

### 方式 1：放入插件目录（推荐，本地使用）

构建后把产物放入插件目录，启动时自动加载：

```bash
bun install
bun run build
```

将 `dist/index.js` 复制到以下任一目录：

- 项目级：`.opencode/plugins/opencode-oceanus.js`
- 全局：`~/.config/opencode/plugins/opencode-oceanus.js`

`.opencode/plugins/`（v2 规范，复数）目录下的文件在启动时自动加载。

### 方式 2：`plugins` 数组（opencode.json）

在 `opencode.json`（或 `~/.config/opencode/opencode.json`）的 `plugins` 数组加入：

**本地路径引用构建产物：**

```json
{
  "plugins": ["./opencode-oceanus/dist/index.js"]
}
```

**绝对路径：**

```json
{
  "plugins": ["/path/to/opencode-oceanus/dist/index.js"]
}
```

**发布到 npm 后使用包名：**

```json
{
  "plugins": ["opencode-oceanus"]
}
```

**对象形式（携带插件 options）：**

```json
{
  "plugins": [{ "package": "opencode-oceanus", "options": {} }]
}
```

> 本地文件 / 未发布 npm 时建议方式 1 或方式 2 的路径引用。构建产物已将 zod 内联，插件自包含，仅依赖运行时提供的 `@opencode-ai/plugin`。

### 内置 skill

插件在启动时通过 `ctx.skill.transform` 注入 sisyphus 工作流的四个阶段 skill，**安装插件即可使用，无需拷贝任何 skill 文件**：

| Skill | 作用 |
|-------|------|
| `sisyphus-brainstorm` | 探索上下文、一次一个问题澄清需求、提出 2-3 方案、产出并保存设计 spec 到 `.oceanus/spec/` |
| `sisyphus-plan` | 映射文件、right-size 任务、保存实现计划到 `.oceanus/plan/`、确认 TDD 与 Worktree 策略 |
| `sisyphus-execute` | 按计划实现、后台并行委派 `task(run_in_background=true)`、同步 todo 状态 |
| `sisyphus-review` | 阶段间证据化评审、重评审转交 @oracle、验证发现后才接受 |

`sisyphus` agent 会按阶段自动加载对应 skill。

## 配置

每个 agent 的模型等可通过独立 jsonc 配置文件定制：

- 用户级：`~/.config/opencode/opencode-oceanus.jsonc`
- 项目级：`.opencode/opencode-oceanus.jsonc`（优先，与用户级合并）

```jsonc
{
  "agents": {
    "oceanus":  { "model": "openai/gpt-5.6-luna" },
    "explorer": { "model": "ollama-cloud/deepseek-v4-flash", "temperature": 0.2 },
    "designer": { "color": "#FFB3BA" }
  },
  "disabled_agents": []
}
```

- `model`：格式 `provider/model` 或 `provider/model#variant`；未配置时跟随当前会话模型
- `temperature`：映射到 agent 请求设置
- `prompt` / `description` / `color`：覆盖默认提示词 / 描述 / 颜色
- `disabled_agents`：默认 `["observer"]`；置空数组 `[]` 可启用全部 agent（`oceanus` 受保护，不可禁用）

Sisyphus 执行时还会为每个计划维护任务级进度 ledger：`.oceanus/progress/<plan-name>.md`。ledger 按任务记录 `pending`、`in_progress`、`completed`、`failed` 或 `blocked` 状态、worker/session、验证证据和更新时间。并行 worker 不直接写共享 ledger，由 orchestrator 在派发前及每个任务完成后串行更新。

## 开发

```bash
bun install       # 安装依赖
bun run build     # 构建到 dist/（zod 已内联，产物自包含）
bun run typecheck # 类型检查
```

## 项目结构

```
.
├── package.json        # npm 包定义，main 指向 dist/index.js
├── tsconfig.json
├── src/
│   ├── index.ts        # v2 插件入口：Plugin.define + ctx.agent.transform + ctx.skill.transform
│   ├── config/         # jsonc 配置加载与 schema（paths / loader / schema / utils / constants）
│   ├── agents/         # 各 agent 定义（oceanus / sisyphus + 6 个子 agent）
│   └── skills/         # sisyphus 四个阶段 skill（插件注入，安装无需拷贝）
└── dist/               # 构建产物
```
