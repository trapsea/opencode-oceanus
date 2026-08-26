# Oceanus、omo-slim 与 oh-my-openagent 三方能力对比

> 调研日期：2026-08-26  
> 对比仓库：
> - 当前项目：`/apple/workspace/ocean/opencode-oceanus`
> - 参考项目：`/apple/workspace/ai/oh-my-opencode-slim`
> - 参考项目：`/apple/workspace/ai/oh-my-openagent`

本文基于三个仓库当前源码、配置、测试和文档进行静态对比，目标是区分：

1. 三个项目实际具备的能力；
2. 哪些能力是产品功能，哪些只是兼容层或平台扩展；
3. 哪些能力适合移植到 Oceanus；
4. 哪些能力应当暂缓或明确不移植。

## 1. 总体定位

| 项目 | 当前定位 | OpenCode 形态 | 主要价值 |
|---|---|---|---|
| Oceanus | 轻量 Agent 编排插件 | 原生 OpenCode v2 beta | Agent 分工、Sisyphus 五阶段工作流、Skill、preset、TUI |
| omo-slim | 完整编排运行时 | v1 主体 + v2 适配层 | 工具、MCP、Hooks、后台任务、multiplexer、CLI |
| oh-my-openagent | 平台化 Agent Harness | 主要基于 v1 插件 API | 多模型编排、复杂后台任务、模型能力系统、多 Harness 生态 |

核心判断：

> oh-my-openagent 的能力最多，但不是最适合直接移植的来源。Oceanus 应保持原生 v2 架构，优先吸收 oh-my-openagent 的 Agent 设计和运行时思路，并优先参考 MIT 许可的 omo-slim 实现。

## 2. 版本、架构与规模

| 项目 | 版本/依赖 | 插件入口 | 代码规模与结构 |
|---|---|---|---|
| Oceanus | `0.2.3`；`@opencode-ai/plugin@0.0.0-beta-18230` | `src/index.ts`，`Plugin.define({ setup })` | 单包、约 2.8K 行核心代码，结构简单 |
| omo-slim | `2.2.17`；`@opencode-ai/plugin@1.18.13` | v1 `server` + `src/v2/setup.ts` | 单包、约 50K 行非测试代码，包含大量 v1 运行时逻辑 |
| oh-my-openagent | `5.0.0-beta.21`；`@opencode-ai/plugin@1.18.22` | `packages/omo-opencode/src/index.ts`，v1 `PluginModule` | Bun workspace，约 34 个 workspace 包，主包约 119K 行非测试代码 |

### 架构差异

- **Oceanus**：直接使用 v2 的 `agent.transform`、`skill.transform`、`command.transform`。
- **omo-slim**：保留 v1 工厂，再通过 v2 adapter 翻译 Agent、Tool、Hook、Event 等对象。
- **oh-my-openagent**：主要仍是 v1 事件和 Hook 模型，没有完整的 v2 插件入口；其多包结构主要服务 Codex、Senpi、Pi 等其它 Harness。

因此，不建议把 omo-slim 或 oh-my-openagent 的完整 v1 工厂移植到 Oceanus。

## 3. 能力矩阵

| 能力领域 | Oceanus | omo-slim | oh-my-openagent |
|---|---|---|---|
| 主编排 Agent | `oceanus`、`sisyphus` | `orchestrator`、`council` | `sisyphus`、`atlas` 等 |
| 专家 Agent | explorer、librarian、oracle、designer、fixer、observer、metis、momus | 以上角色 + Council/Councillor | 以上角色 + metis、momus、hephaestus、multimodal-looker、sisyphus-junior |
| Agent 配置 | prompt、model、temperature、权限、preset | Agent override、模型数组、preset | 动态 prompt、模型能力、类别模型、fallback 链 |
| 自定义 Tool | 当前没有插件自有 Tool 注册 | task 生命周期、AST-grep、webfetch、ACP、wait-for-user | delegate-task、后台任务、grep/glob、hashline-edit、monitor、team message 等 |
| MCP | `skills/mcps` 字段当前不直接映射到 v2 Agent | context7、gh_grep | ast-grep、git-bash、LSP、MCP OAuth、codegraph 等 |
| Hooks | 当前基本没有运行时 Hook | phase reminder、任务管理、缓存安全、错误恢复等 | 80+ Hooks，覆盖模型、压缩、工具、规则、任务和通知 |
| 后台任务 | 主要依赖 Agent prompt | 任务板、status/result/cancel/message/revive | 任务注册、轮询、父会话唤醒、重试、熔断、快照、并发控制 |
| 模型能力 | 静态单模型或跟随会话 | 支持模型数组，但 v2 适配取首模型 | provider、模型能力、fallback、reasoning、模型族策略 |
| 上下文管理 | Sisyphus Skill 约束流程 | 缓存安全、阶段提醒 | 主动压缩、压缩续跑、todo 保留、上下文恢复 |
| 规则注入 | 当前无专用实现 | 有部分 Skill/配置能力 | AGENTS.md、规则文件、目录规则注入引擎 |
| TUI | Agent/model sidebar、`/preset` | Agent 状态、模型、preset 管理、任务状态 | roster、job board、loop、session bridge、tmux 状态 |
| CLI | 无 | install、doctor | install、doctor、config、迁移、OAuth、worktree、Codex 安装 |
| Multiplexer | 无 | tmux、zellij、cmux、kitty 等 | tmux、cmux、原生进程和多 Harness 集成 |
| Companion | 无 | 桌面 companion | OpenClaw、Discord/Telegram 等外部网关 |
| 记忆系统 | 无 | 无 | `memory-core`，主要服务其它 Harness |
| 遥测 | 无 | 无 | PostHog telemetry，默认配置可能启用 |

## 4. Oceanus 当前已经具备的能力

关键文件：

- `src/index.ts`
- `src/agents/index.ts`
- `src/agents/oceanus.ts`
- `src/agents/sisyphus.ts`
- `src/config/loader.ts`
- `src/config/schema.ts`
- `src/commands.ts`
- `src/tui.tsx`
- `src/skills/`

### 4.1 Agent 编排

- `oceanus`：主工作流编排器；负责探索、计划、委派、验证和结果整合。
- `sisyphus`：五阶段工作流 Agent：
  `brainstorm → plan → execute → review → finish`。
- `explorer`：代码库探索。
- `librarian`：外部文档和库研究。
- `oracle`：架构决策和复杂调试。
- `designer`：UI/UX 设计与实现。
- `fixer`：有界实现。
- `observer`：视觉和多媒体分析，默认禁用。
- `metis`：实现前方案分析（需求缺口/风险/边界/反例/验收标准），只读、默认启用。
- `momus`：执行前方案质量检查（依赖/范围/测试/可执行性），输出 `OKAY`/`REJECT`，只读、默认启用。

对复杂任务，工作流遵循 `@metis`（方案前置分析）→ `@momus`（方案质量检查）→ `execute` 的协议：`@momus` 返回 `REJECT` 时回到 plan 修订后重新检查，`OKAY` 才放行 execute；简单任务可明确跳过并说明理由。该门禁是 **prompt 工作流门禁**（由 sisyphus/oceanus 提示词强制执行），不是插件注册的自动运行时 supervisor。`metis`、`momus` 默认启用、只读，不写文件、不委派、不执行 task。

### 4.2 配置与 preset

- 用户级和项目级 JSON/JSONC 配置。
- preset 与显式 Agent override 合并。
- 每个 Agent 可独立配置模型、温度、prompt、颜色、权限和 options。
- `explorer`/`librarian`/`oracle`/`observer`/`metis`/`momus` 在无显式 `agents.<name>.permission` 时应用默认只读 v2 permission（allow 只读工具，deny `bash`/`edit`/`write`/`apply_patch`/`ast_grep_replace`/`hashline_edit`/`task`/`todowrite`）；显式配置始终覆盖默认值。
- `/preset` 命令支持查询和切换 preset。
- 配置变更支持原子写入。

### 4.3 内置 Skill 与 TUI

- 通过 `ctx.skill.transform` 注入 Skill，不需要额外复制 Skill 文件。
- Sisyphus 各阶段拥有独立 Skill。
- TUI sidebar 展示 Agent、模型、variant 和当前会话状态。
- 已有配置、命令、TUI、Agent 单元测试。

## 5. omo-slim 的主要优势

omo-slim 相比 Oceanus 已经补齐了较完整的插件运行时：

### 5.1 工具层

- 后台任务消息、状态、结果、取消和恢复。
- AST-grep 搜索和替换。
- 带缓存和模型处理能力的 `webfetch`。
- ACP 外部 Agent 执行。
- `wait_for_user` 用户等待协议。

### 5.2 MCP

- `context7`：官方文档查询。
- `gh_grep`：GitHub 代码搜索。

### 5.3 Hook 与任务管理

- 工具执行前后 Hook。
- phase reminder。
- apply-patch 修复和错误恢复。
- 任务板和 session 生命周期跟踪。
- 缓存安全注入。
- 前台模型 fallback。

### 5.4 工程能力

- install CLI。
- doctor 诊断。
- 配置生成和 provider preset。
- 更完整的 TUI 状态持久化。
- v1/v2 兼容验证和发布检查。

## 6. oh-my-openagent 的新增能力

### 6.1 真正的产品能力

这些能力对用户有明显可感知的提升（其中 `metis`、`momus` 已被 Oceanus 采纳，见 §4.1）：

1. `metis`：计划前需求和风险分析。
2. `momus`：计划质量审查。
3. `hephaestus`：强执行型 Agent。
4. `atlas`：并行编排和探索。
5. 动态、模型特化的 Sisyphus prompt。
6. 统一的 `delegate-task` 路由和类别模型选择。
7. 后台任务 parent-wake。
8. 模型 fallback 和模型能力判断。
9. 编辑错误恢复、输出截断和工具循环保护。
10. AGENTS.md 和规则文件注入。
11. 主动上下文压缩和压缩后续跑。
12. 更完整的 doctor 和安装诊断。

### 6.2 平台扩展或工程负担

以下内容不应直接视为 Oceanus 的核心产品功能：

- Codex、Senpi、Pi 等其它 Harness 支持。
- 12 个平台原生二进制包。
- OpenClaw Discord/Telegram 网关。
- companion 和 btw-side。
- 多平台安装器和历史配置迁移。
- PostHog telemetry。
- `memory-core` 跨 Harness 记忆系统。
- 完整 team mode 和 multiplexer 生态。

这些功能增加了发布、进程、隐私、跨平台和维护成本。

## 7. 建议移植到 Oceanus 的功能

### P0：低风险、高收益

| 功能 | 推荐做法 | 来源 | 状态 |
|---|---|---|---|
| `metis` | 新增只读计划前分析 Agent | oh-my-openagent | **已完成**：默认启用、只读，见 §4.1 |
| `momus` | 新增只读计划审查 Agent | oh-my-openagent | **已完成**：默认启用、只读，见 §4.1 |
| Agent 默认权限矩阵 | 为只读、编辑、编排 Agent 设置明确 allow/deny | omo-slim、oh-my-openagent | **已完成**：只读 agent 默认 v2 permission |
| 能力一致性检查 | 检查 prompt 引用的 Tool/MCP 是否实际存在 | 三方共同问题 | 部分：方案检查门禁已就位；工具级一致性校验待补 |
| `ast_grep_search/replace` | 作为原生 v2 Tool 注册 | omo-slim、oh-my-openagent | **已完成**：作为原生 v2 Tool 注册 |
| 轻量 `doctor` | 检查配置、模型、Agent、Tool、MCP 和版本 | omo-slim、oh-my-openagent | 待办：尚未实现 |

### P1：中等成本、明显提升体验

| 功能 | 推荐边界 |
|---|---|
| 后台任务状态 | 先做 status/result/cancel/message，不做复杂恢复 |
| 工具错误恢复 | 独立实现 edit、apply-patch、JSON 参数修复 |
| 工具输出截断 | 防止超长结果破坏上下文 |
| 工具循环保护 | 检测重复工具调用并提示或熔断 |
| 模型 fallback 配置 | 先支持模型数组和静态首选模型解析 |
| TUI 任务状态 | 在现有 sidebar 中显示运行中、成功、失败和取消 |
| rules/AGENTS.md 注入 | 先确认 OpenCode v2 是否已经原生支持，避免重复实现 |
| 模型特化 prompt | 只支持少量主要模型 profile，不复制完整模型矩阵 |

### P2：等待 v2 API 稳定

| 功能 | 原因 |
|---|---|
| parent-wake | 依赖稳定的 session/event/message 生命周期 |
| 主动上下文压缩 | 依赖 compaction API 和上下文预算语义 |
| 完整后台任务板 | 状态、恢复、并发、快照和 session 查询复杂 |
| 动态 Council | 依赖运行时动态 Agent 注册和多模型协调 |
| 完整模型 fallback | 需要可靠的错误事件和安全重试语义 |

## 8. 明确不建议移植的功能

### 8.1 完整 v1 适配层

Oceanus 已经是原生 v2 插件。复制 v1 工厂和 shim 会带来：

- 双 API 维护成本；
- prompt、权限和 Tool 语义转换问题；
- v1 事件模型与 v2 session 模型的不一致；
- 更难定位的运行时错误。

### 8.2 Multiplexer、team mode 和 companion

这些能力依赖 tmux、cmux、zellij、外部 daemon 或桌面进程。OpenCode v2 已经具备原生子会话和 Agent 委托能力，继续移植容易重复实现宿主能力。

### 8.3 memory-core

目前主要是多 Harness 生态能力，并非 oh-my-openagent OpenCode 主路径的必要依赖。它会引入：

- 长期状态和数据迁移；
- 记忆一致性和隐私问题；
- 额外的同步、锁和 Git 存储机制。

### 8.4 telemetry

Oceanus 和 omo-slim 当前没有遥测。移植 PostHog 不会直接提升 Agent 编排质量，却会带来隐私、合规和用户信任成本。

### 8.5 直接复制 oh-my-openagent 源码

oh-my-openagent 使用 `SUL-1.0` 许可证，不应直接作为 MIT 项目的代码来源。可以借鉴架构和行为设计，但应：

- 优先使用 omo-slim 的 MIT 实现；
- 对 oh-my-openagent 的能力进行独立重写；
- 对长提示词、算法和代码做许可证审查。

## 9. 推荐目标架构

Oceanus 应继续保持单包、原生 v2 结构：

```text
src/
├── agents/       # Oceanus、Sisyphus 及专家 Agent
├── tools/        # v2 Tool 注册和任务工具
├── hooks/        # v2 session/tool Hook
├── rules/        # 必要时的规则注入
├── cli/          # doctor 等轻量命令
├── config/       # JSONC、preset、权限和模型配置
├── skills/       # 阶段 Skill
└── tui.tsx       # Agent、模型和任务状态
```

实现原则：

1. 使用原生 `Plugin.define({ setup })`，不引入 v1 兼容层。
2. 每个 Tool、Hook 和外部依赖独立开关。
3. 使用能力探测，Tool/MCP 不存在时动态删减 prompt。
4. 所有任务状态由主编排器统一维护，worker 不直接修改共享状态。
5. 运行时能力使用独立 try/catch，单个 Hook 失败不影响插件启动。
6. 不默认启用 telemetry、外部 daemon 或长期记忆。
7. 每项 v2 能力都增加 host smoke test，而不仅是单元测试。

## 10. 推荐路线

### 阶段 A：Agent 和安全边界

1. ✅ 增加 `metis`、`momus`（默认启用、只读；metis→momus→execute 门禁）。
2. ✅ 完善默认 Agent 权限（只读 agent 默认 v2 permission，显式配置可覆盖）。
3. 修正 v2 委派工具名称和参数。
4. 建立 prompt 与实际 Tool/MCP 的能力一致性检查（部分完成，工具级校验待补）。

### 阶段 B：工具和诊断

1. 添加 AST-grep。
2. 添加必要的文档/代码搜索 MCP。
3. 添加后台任务 status/result/cancel。
4. 添加轻量 doctor。
5. 增加工具错误恢复和输出截断。

### 阶段 C：长任务体验

1. 增加 TUI 任务状态。
2. 增加模型 fallback。
3. 评估 rules/AGENTS.md 注入。
4. 根据 v2 API 稳定性评估 parent-wake 和 compaction。

## 11. 当前不确定性

- Oceanus 依赖的 OpenCode v2 beta API 仍可能变化。
- `subagent`、Tool transform、MCP transform、session Hook、事件和 compaction 的具体语义必须通过真实 host smoke test 验证。
- OpenCode 是否已经原生处理 AGENTS.md/rules，需要在移植 rules-engine 前确认。
- 模型 fallback 是否安全，取决于请求失败事件、session 状态和副作用重试语义。
- 本文最初只记录对比结果和建议；其中 `metis`、`momus`、默认只读权限等已按上述路线实现，其余仍为待办建议。
