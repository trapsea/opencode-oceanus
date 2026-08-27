# OpenAgent 编排能力对比评审报告（Oceanus vs oh-my-openagent）

> 报告类型：只读静态调研 / 架构评审（不包含任何代码改动）
> 评审日期：2026-08-26
> 评审对象：`opencode-oceanus`（本仓库）与 `code-yeongyu/oh-my-openagent`（旧名 oh-my-opencode）
> 配套文档：`docs/three-way-capability-comparison.md`（三方能力对比，本报告作为其编排维度的深入展开，不重复抄写全文）

> **范围声明**：本文是只读研究报告，**不代表本轮已经实现任何优化**。所有对现状的描述均基于 `src/**` 源码静态证据；涉及"真实 opencode v2 host 行为"的结论（尤其是 preset reload 的应用范围）一律标注为"静态代码显示存在重建风险 / 需 host smoke 最终确认"，不作绝对断言。

> **历史文档**：本文是 2026-08-26 的只读评审快照；当前六阶段契约以 README 与 Skill 为准。

---

## 1. 执行摘要

Oceanus 当前是一个**轻量、原生 v2、以"prompt 纪律 + 宿主观察"为主的 Agent 编排插件**。它的编排能力绝大部分落在两处：

- **注册层**（`src/index.ts` + `src/agents/**`）：一次性把 `oceanus / sisyphus / explorer / librarian / oracle / designer / fixer / observer` 的定义写入 v2 `agent.transform`，并把编排规则写进系统提示词（`buildOceanusPrompt`、六阶段 workflow 注入）。
- **运行时层**（`src/runtime/**` + `src/tools/**` + `src/hooks/**`）：通过 `execute.before/after` Hook 观察宿主 `task`/`subagent` 调用，把信息写入本地 `TaskRegistry`，再由 `task_status / task_result / task_cancel` 三件套结合宿主 session 事实返回状态。

与 `oh-my-openagent`（下称 OpenAgent）对比的核心差异：

| 维度 | Oceanus | OpenAgent |
|---|---|---|
| 编排载体 | **原生 v2 prompt + 宿主观察**，不引入 v1 harness | **v1 插件 API + 自建 harness**（task 板、boulder/plans/notepads、模型能力系统） |
| 任务依赖 | 无持久化依赖、无 `blockedBy/blocks`、无跨会话 resume | experimental Task System：`task_create/get/list/update` + `blockedBy/blocks` 持久依赖；`boulder/plans/notepads` 跨会话恢复 |
| 并发 | 默认依赖宿主背景任务 + prompt 纪律 | 后台任务默认并发 5，可按 provider/model 限流 |
| 权限 | 仅配置覆盖时写 `agent.permissions`，**无完整默认硬矩阵** | 默认 agent tool restrictions + permission/guard hooks（AGENTS.md 仅作指令上下文） |
| 模型 | 配置数组只取首项，无 fallback 链 | agent/category 主模型 + models fallback 链，`model-fallback/runtime-fallback`，reasoning/variant |
| preset/reload | 切换写配置并 `ctx.agent.reload`，但 **setup 闭包与 agent definition 不会自动重建** | 动态 prompt + 模型能力即时解析 |
| hooks/tools | 5 Hook + 6 Tool，偏质量护栏 | 大量 hook composer、任务/上下文/恢复/团队门控 |

**总体判断**：OpenAgent 的能力最全，但**不是最适合直接移植的来源**——它主要基于 v1 插件 API，主包约 119K 行非测试代码、34 个 workspace 包，且为 SUL-1.0 许可证。Oceanus 应保持原生 v2 架构，仅**借鉴** OpenAgent 的编排设计（默认权限矩阵、模型 fallback、任务依赖/并发/恢复、AGENTS/rules 注入）作为行为参照，具体实现优先参考 MIT 许可的 omo-slim，或直接基于 v2 host API 自建轻量方案。

---

## 2. 对比范围、对象与证据方法

### 2.1 命名歧义说明

- **OpenAgent 实际仓库**：`https://github.com/code-yeongyu/oh-my-openagent`（旧名 `oh-my-opencode`，仓库 / `dev` 分支 均指向同一项目）。调研过程中存在"OpenAgent / oh-my-openagent / oh-my-opencode"三个名称指向同一仓库的歧义，本报告统一以 **OpenAgent** 指代该项目。
- 官方文档：`https://ohmyopenagent.com/docs`、`https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/orchestration.md`、`https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/reference/features.md`。
- 本仓库既有的三方对比文档（`docs/three-way-capability-comparison.md`）中"参考项目：`/apple/workspace/ai/oh-my-openagent`"即同一仓库。

### 2.2 证据方法

- **Oceanus 侧**：直接读取本仓库 `src/**` 源码（`index.ts`、`agents/**`、`config/**`、`commands/preset.ts`、`runtime/**`、`tools/**`、`hooks/**`），按行号标注证据。不做任何代码改动。
- **OpenAgent 侧**：基于调研任务提供的已确认结论（已核对其仓库与官方文档），包括 11 个 agent、background task 并发/限流、experimental Task System 的持久依赖、boulder/plans/notepads 恢复、默认权限矩阵、模型 fallback、prompt 注入体系等。本报告不重复第三方文档原文，只作为行为参照。
- **验证边界**：凡涉及"真实 v2 host 行为"（reload 是否重建 agent definition、`session.active/get/interrupt` 的运行时行为）的结论，静态代码只能证明"存在风险"，最终需在真实 host 上做 smoke 确认（见第 5 节）。

---

## 3. 逐项差异表

> "Oceanus 现状"均标注证据位置；"OpenAgent 行为"来自调研结论，用于对照与借鉴。

### 3.1 注册与路由

| 子项 | Oceanus 现状（证据） | OpenAgent 行为 | 差异 / 借鉴点 |
|---|---|---|---|
| 注册入口 | `src/index.ts:54-140`：`agent.transform → skill.transform → command.transform → tools/hooks`；agent 由 `createAgents` 一次生成 | v1 harness，Agent 定义 + 运行时路由分离 | Oceanus 是**一次性静态定义**，OpenAgent 是**动态解析**（category→Sisyphus-Junior、subagent_type 直调） |
| 主 agent | `oceanus`（primary）+ `sisyphus`（primary），`draft.default('oceanus')`（`index.ts:95`） | `sisyphus/hephaestus/prometheus/atlas` 等 | 均有多个 primary，均支持"工作流 lead"角色 |
| 子 agent | `explorer/librarian/oracle/designer/fixer/observer`（`constants.ts:8-15`），observer 默认禁用 | 增加 `multimodal-looker/metis/momus/sisyphus-junior` | OpenAgent 通过 **category→统一 Sisyphus-Junior、subagent_type 直调** 做规模化调度；Oceanus 无 category 机制 |
| 路由机制 | **纯 prompt 纪律**：`AGENT_DESCRIPTIONS` + `buildOceanusPrompt`（`oceanus.ts:61-145`）把"何时委派给谁"写进系统提示词；并行调度靠 `<Workflow>` 文字规则 | IntentGate keyword detector + 显式 task/subagent 直调 | OpenAgent 有**确定性意图门控**（keyword detector），Oceanus 完全依赖模型遵循 prompt，无确定性强路由 |
| 调度编排 | 六阶段 workflow 通过字符串标记替换注入（`sisyphus.ts:8-67`，`<Role>`/`</Workflow>` 替换） | category/planning 体系 + task 依赖 | Oceanus 调度是"文字约束"，OpenAgent 有可执行的 plan/依赖数据 |

### 3.2 任务（task）

| 子项 | Oceanus 现状（证据） | OpenAgent 行为 | 差异 / 借鉴点 |
|---|---|---|---|
| 任务观察 | `runtime/task-observer.ts`：观察宿主 `task`/`subagent` 的 `execute.before/after`，写本地 registry（fail-open） | 自建后台任务系统（注册、轮询、父会话唤醒、重试、熔断、快照） | Oceanus **依赖宿主任务**，OpenAgent **自持任务生命周期** |
| 状态解析 | `runtime/task.ts:48-64`：优先级 `session.active() → session.get().outcome → registry 回退`，**宿主事实优先**，绝不伪装完成 | 任务状态 + outcome 自持 | 设计一致（都强调"宿主/真实事实优先"），但 Oceanus 无重试/熔断/快照 |
| 结果读取 | `tools/index.ts` `task_result`：只接受宿主验证终态或 registry 已观察到的终态 | `task_result` 自持结果 | 一致的方向 |
| 取消 | `task_cancel`：`session.interrupt` 后验证 `outcome/active` 才置 cancelled（`tools/index.ts:341-409`） | 任务取消/重试 | 一致，但 Oceanus 无重试机制 |
| **依赖门控** | 无。registry 无 `blockedBy/blocks`，prompt 里要求"wave 依赖"靠模型自觉（`oceanus.ts:281-286`） | **experimental Task System：`task_create/get/list/update` + `blockedBy/blocks` 持久依赖** | **P0/P1 差距**：Oceanus 依赖是纯 prompt 纪律，OpenAgent 有可查询、可持久化的依赖图 |
| **持久化** | 无。registry 为进程级内存单例（`runtime/task.ts:20-26`），终态按 TTL 清理 | `boulder/plans/notepads` 跨会话恢复；任务可跨会话 | **P1 差距**：Oceanus 中断后 registry 丢失，无法 resume |
| 并发控制 | 无显式并发数限制；并行靠 prompt 提示"同一 turn 多发 background task"（`oceanus.ts:239-247`） | 后台任务**默认并发 5，可按 provider/model 限流** | **P1 差距**：Oceanus 并发完全靠宿主 + 模型自觉，无插件级限流 |

### 3.3 权限

| 子项 | Oceanus 现状（证据） | OpenAgent 行为 | 差异 / 借鉴点 |
|---|---|---|---|
| 权限写入 | 仅在配置覆盖时写 `agent.permissions`（`index.ts:11-36` 的 `toPermissions` + `index.ts:90-92`） | **默认 agent tool restrictions** + permission/guard hooks | **P0/P1 差距**：Oceanus 无开箱即用的默认硬矩阵 |
| 角色边界 | 主要靠 prompt 文案（`AGENT_DESCRIPTIONS` 中 "Permissions: read_files"、"read_files, write_files"）与工具路径边界 | 默认 tool restrictions 是**确定性限制** | **P0/P1 差距**：Oceanus 的"只读/可写"是文字承诺，不是强制约束；explorer/librarian/oracle/observer 标称只读但无硬权限墙 |
| 指令 vs 权限 | —（无对应） | **AGENTS.md 仅是指令上下文，不是确定性权限边界** | 需在 Oceanus 中明确区分"prompt 引导"与"硬权限"，避免把 AGENTS 注入误当权限控制 |

### 3.4 Prompt

| 子项 | Oceanus 现状（证据） | OpenAgent 行为 | 差异 / 借鉴点 |
|---|---|---|---|
| prompt 来源 | 内置 fallback prompt + 配置文件 `prompt`/`orchestratorPrompt`（`agents/index.ts` `applyOverrides`；`oceanus.ts` `resolvePrompt`） | **file-based prompt**、`prompt_append` | 方向一致；Oceanus 已支持 inline/file/append 三态（`resolvePrompt`） |
| 上下文注入 | 无专门 rules/AGENTS 注入 | AGENTS.md/rules/README/keyword/compaction/goal 注入；skills 优先级 project>opencode>user>builtin | **P2 评估项**：Oceanus 未接入 AGENTS/rules 注入，也未定义 skills 优先级 |
| 编排约束 | 全部写在 `<Role>/<Workflow>/<Communication>`（`oceanus.ts:159-329`） | prompt 纪律 + 可执行 task/plan | Oceanus 约束密度高，但**不可执行** |

### 3.5 模型

| 子项 | Oceanus 现状（证据） | OpenAgent 行为 | 差异 / 借鉴点 |
|---|---|---|---|
| 主模型 | `getPrimaryModelFromOverride`：`agents/index.ts:55-74`，字符串或数组**只取首项**，对象项无法映射则跟随会话 | agent/category **主模型 + models fallback 链** | **P1 差距**：Oceanus 配置模型数组时其余项被丢弃 |
| 降级 | 无 fallback | `model-fallback / runtime-fallback` | **P1 差距**：OpenAgent 有模型/运行时降级链 |
| category 级 | 无 | reasoning/variant 等 **category 设置** | **P2**：Oceanus 无 category 概念 |

### 3.6 Preset / Reload

| 子项 | Oceanus 现状（证据） | OpenAgent 行为 | 差异 / 借鉴点 |
|---|---|---|---|
| preset 定义 | `config/schema.ts`：`preset`+`presets`；`loader.ts:144-155` `resolvePresetAgents` 把当前 preset 与显式 agents 合并 | 动态配置/模型能力解析 | 功能等价物，但实现方式不同 |
| 切换命令 | `commands/preset.ts`（已目录化为 `src/commands/preset.ts`，旧 `src/commands.ts` 已删除）：写配置 + `ctx.agent.reload()`（`index.ts:118`） | — | — |
| **reload 风险** | **静态代码显示存在重建风险**：`loadPluginConfig` 与 `createAgents` 在 `setup` 时执行一次并闭包捕获（`index.ts:58-96`）；切换 preset 只重新 `ctx.agent.reload()`，**不会自动重建 setup 闭包内的 config 与 agent definition**。见第 5 节。 | 动态解析，无此问题 | **P0 待确认项**：需真实 v2 host smoke 验证 reload 对已注册 agent definition 的实际应用范围 |

### 3.7 Hooks / Tools

| 子项 | Oceanus 现状（证据） | OpenAgent 行为 | 差异 / 借鉴点 |
|---|---|---|---|
| Hook | `hooks/index.ts`：5 个（apply_patch / tool_output_truncator / json_error_recovery / tool_loop_guard / task_registry_observer），**偏质量护栏** | 80+ Hooks（模型、压缩、工具、规则、任务、通知） | Oceanus Hook 是护栏不是编排 runtime |
| Tool | `tools/index.ts`：6 个（ast_grep_search / ast_grep_replace / hashline_edit / task_status / task_result / task_cancel） | delegate-task、后台任务、grep/glob、hashline-edit、monitor、team message | Oceanus 无团队消息、无 monitor；task 三件套是主要编排工具 |
| 编排能力 | 无 team/multiplexer、无上下文压缩、无记忆 | team/multiplexer、压缩、memory-core | 见第 7 节（明确不移植） |

### 3.8 并行 / 恢复

| 子项 | Oceanus 现状（证据） | OpenAgent 行为 | 差异 / 借鉴点 |
|---|---|---|---|
| 并行 | prompt 要求同一 turn 批量发 background task（`oceanus.ts:239-247`、`281-286`） | 后台默认并发 5 + provider/model 限流 | **P1 差距** |
| 恢复 | 无持久化、无跨会话 resume；依赖 `progress.md` 文档式 ledteer（prompt 层面） | boulder/plans/notepads 跨会话恢复 | **P1 差距** |

---

## 4. Oceanus 当前编排链路图

```
┌─ setup 期（src/index.ts:54-140）────────────────────────────────────┐
│  loadPluginConfig({directory: process.cwd()})   ← 用户级+项目级合并   │
│      │ config（含 preset 解析后的 agents 覆盖）                       │
│      ▼                                                              │
│  createAgents(config)  → AgentDefinition[]                          │
│      │  (oceanus/sisyphus + 6 子 agent，应用 prompt/model/perm 覆盖) │
│      ▼                                                              │
│  ctx.agent.transform(draft)  → 写入 v2 Agent.Info（一次性生成）      │
│      │  draft.default('oceanus')                                     │
│      ▼                                                              │
│  ctx.agent.reload()                                                  │
│      │                                                              │
│  ctx.skill.transform + reload   （4 个 sisyphus-* skill）            │
│  ctx.command.transform + reload （/preset，注入 runPreset+reload+reply）│
│  registerOceanusTools  （ast_grep/hashline/task 三件套）              │
│  registerOceanusHooks   （5 Hook，含 task_registry_observer）        │
└──────────────────────────────────────────────────────────────────────┘

┌─ 运行期（一次会话）─────────────────────────────────────────────────┐
│  oceanus/sisyphus 系统提示词                                         │
│      │  buildOceanusPrompt：路由规则 + 并行示例 + 委派契约           │
│      │  sisyphus：<Role>替换 + <Workflow>六阶段注入（字符串标记）    │
│      ▼                                                              │
│  宿主 task(run_in_background=true) / subagent                       │
│      │  (并行、依赖由 prompt 纪律 + 模型自觉维护)                    │
│      ▼                                                              │
│  execute.before/after Hook（task_registry_observer）                │
│      │  解析 task/subagent 调用，写入本地 TaskRegistry              │
│      ▼                                                              │
│  task_status / task_result / task_cancel                             │
│      │  结合宿主 session.active / get.outcome / interrupt 判定       │
│      │  宿主事实优先，registry 仅作索引，绝不伪造终态                 │
│      ▼                                                              │
│  编排者 reconcile → 串行验证 → 提交/汇报                              │
└──────────────────────────────────────────────────────────────────────┘

┌─ preset 切换（/preset，src/commands/preset.ts）─────────────────────┐
│  runPreset → updateUserPreset(写用户配置 preset 字段)               │
│      → ctx.agent.reload()                                           │
│      → reply("当前 session 可能仍需新建会话以应用更改")              │
│  ⚠ 静态代码：setup 闭包内的 config/createAgents 不会被 reload 重建   │
│    （需真实 host smoke 最终确认，见第 5 节）                         │
└──────────────────────────────────────────────────────────────────────┘
```

**链路特征**：
1. 编排规则集中在系统提示词（prompt 纪律），无独立可执行调度器；
2. 任务事实以宿主 session 为准，本地 registry 只是"看得见的索引"；
3. 配置在 setup 期一次性固化，preset 切换存在重建风险（待 host 确认）。

---

## 5. 已确认事实 vs 推断 / 需真实 v2 host 验证

### 5.1 已确认事实（静态代码可直接证实）

- 注册链路是 `agent → skill → command → tools/hooks` 四段 transform，agent 由 `createAgents` 一次生成，`draft.default('oceanus')`。
- `getPrimaryModelFromOverride` 明确"数组取首项，对象项无法映射则跟随会话"（`agents/index.ts:55-74`）。
- `skills/mcps` schema 字段存在但映射到 v2 时仅打印 warning（`agents/index.ts:104-114`）。
- preset 已目录化为 `src/commands/preset.ts`，旧 `src/commands.ts` 已删除；切换写配置 + `ctx.agent.reload`（`commands/preset.ts:71`、`index.ts:118`）。
- 权限仅在配置覆盖时写 `agent.permissions`（`index.ts:90-92`），默认无硬矩阵；角色权限主要落在 prompt 文案（`oceanus.ts:61-122` 的 "Permissions: read_files / write_files"）与工具路径边界。
- task 状态解析优先级为 `session.active → get.outcome → registry 回退`，`verified:false` 时绝不伪装完成（`runtime/task.ts:48-64`）；`task_result` 只读宿主验证终态或已观察到的终态（`tools/index.ts:313-326`）。
- registry 是进程级内存单例，无持久化、无依赖门控（`runtime/task.ts:20-26`；`registry.ts`）。
- 5 Hook / 6 Tool 偏质量护栏，不构成完整编排 runtime（`hooks/index.ts`、`tools/index.ts`）。

### 5.2 推断 / 需真实 v2 host 验证

| 项 | 静态结论 | 需 host 验证点 |
|---|---|---|
| **preset reload 重建范围** | 静态代码显示：`loadPluginConfig` 与 `createAgents` 在 `setup` 执行并被闭包捕获（`index.ts:58-96`）；`runPresetCommand` 重新读配置 + `updateUserPreset`，然后 `ctx.agent.reload()`。**setup 闭包内的 config 与 agent definition 不会自动重建**，因此切 preset 后已注册 agent 可能仍是旧定义。这是"重建风险"，不是已证实的失败。 | 在真实 v2 host 上 smoke：切 preset 后 `agent.description/system/model` 是否随新配置生效；`agent.reload()` 是否仅刷新已注册 definition 的可变字段，还是重建整个 transform 回调。 |
| **reload 后权限/模型是否重算** | `agent.permissions/model` 在 `transform` 回调内由 config 决定；reload 若只是刷新 draft 而不再执行回调，则不会重算。 | 同上，需 smoke 确认 reload 是否重新执行 `transform` 回调。 |
| `session.active / get / interrupt` 的运行时形状 | 代码对缺失能力 fail-open 返回 undefined/false（`workspace.ts`）。 | 需确认真实 v2 host 是否暴露 `active()`；`interrupt({continue:false})` 的返回契约。 |
| `toPermissions` 的 v2 permissions 形状兼容 | 静态映射 `{action,resource,effect}`（`index.ts:11-36`）。 | 需确认 v2 `Agent.Info.permissions` 的实际 schema。 |

---

## 6. 优化建议（按 P0 / P1 / P2）

> 每项给出收益、成本、风险、建议边界。**仅作为建议，不代表本轮已实现。** 不复制 OpenAgent 的 SUL-1.0 源码，仅借鉴行为。

### P0（阻塞性 / 正确性风险，优先确认与修复）

**P0-1 preset / agent definition 重建**
- 收益：修复 `/preset` 切换可能"显示生效但实际未重建"的不一致，避免用户误以为配置已应用。
- 成本：中。可能需要重构 setup 闭包，把"读取 config → createAgents → transform"抽成可重入函数，或在 reload 路径重新构建。
- 风险：低；但必须先做真实 host smoke 确认 reload 语义，否则可能白改。
- 建议边界：**先 smoke，后动代码**。若 v2 reload 不重建 transform 回调，才需要抽"重建函数"方案；不要仅凭静态推断就重构。

**P0-2 默认权限矩阵**
- 收益：把"只读/可写"从 prompt 文案（文字承诺）升级为**确定性硬约束**，显著降低 explorer/librarian/oracle/observer 意外写文件、或 design 被绕过 @designer 直接改的风险。
- 成本：中。需为每个 agent 定义默认 tool restriction（read/glob/grep/bash 等），并保留配置覆盖能力（`toPermissions` 已具备）。
- 风险：中。过严会误伤合法用途（如 observer 需要 read 图片、oracle 需要只读 git 诊断）；需定义清晰的只读/可写边界与 override 逃生口。
- 建议边界：默认**只对当前标称只读的角色**加硬只读限制；designer/fixer 维持可写但可配置收紧。借鉴 OpenAgent"默认 tool restrictions + guard hooks"，但实现用 v2 `permissions`，不引入 v1。

### P1（重要的能力差距）

**P1-1 Agent 元数据单一来源（能力一致性）**
- 收益：当前 agent 的"角色/权限/路由描述"分散在 `AGENT_DESCRIPTIONS`（`oceanus.ts:61-122`）、`constants.ts`、各 `createXxxAgent`、schema 之间，易漂移（例如标称只读但实际无限制）。单一来源可做**能力一致性检查**。
- 成本：低-中。抽出统一元数据表，由它同时驱动 prompt 生成与（若做 P0-2）默认权限。
- 风险：低。
- 建议边界：只统一"身份/权限/角色"元数据；不合并 prompt 长文案（保持可读）。

**P1-2 能力一致性检查**
- 收益：在注册期自动校验"描述的能力 vs 实际配置"（例如标称只读的 agent 是否有写权限、被禁用的 agent 是否仍出现在 AGENT_DESCRIPTIONS 路由文本）。
- 成本：低。可在 `createAgents` 后做一次断言/日志。
- 风险：低。
- 建议边界：fail-warn 而非 fail-block，避免阻断合法自定义配置。

**P1-3 模型 fallback（数组只取首项）**
- 收益：`model` 数组目前只取首项（`agents/index.ts:63-69`），其余项被丢弃。支持 fallback 链可提升稳定性（主模型失败→降级）。
- 成本：中。需确认 v2 host 是否原生支持 model fallback；若不支持，需在插件层做"primary 失败后用次模型重试"或调用 `agent.request.settings.model` 切换。
- 风险：中。若 v2 host 已原生支持 fallback，插件层不该重复造轮子。
- 建议边界：**先查 v2 host 是否已支持**；只做"配置透传 + 文档"，把 fallback 行为留给 host，避免与 host 语义打架。

**P1-4 task 依赖门控（blockedBy/blocks）**
- 收益：把"wave 依赖靠模型自觉"升级为**可查询、可校验的依赖图**，减少并行写冲突。
- 成本：中。在 `TaskRegistry` 增加 `blockedBy/blocks` 边、容量与 TTL 内保留非终态；`task_status` 返回依赖未满足信息；prompt 里的 Wave 协议可引用它。
- 风险：中。若 host 不暴露真实依赖执行，插件只能提供"建议性门控"（阻止查询依赖未就绪任务的 result），需明确这是 advisory 还是 enforcement。
- 建议边界：做成 **advisory 门控**（`task_result` 对依赖未就绪返回提示），不强制拦截宿主调度。

**P1-5 task 并发 / 限流**
- 收益：默认并发 5、按 provider/model 限流，避免一次波次铺开太多背景任务导致资源/上下文爆炸。
- 成本：低-中。可在 `execute.before` 观察宿主 task 时维护"该父 session 活跃子任务数"，超限时在 prompt 或 result 中提示。
- 风险：中。插件无权真正阻止宿主并发，只能 advisory 提示；需避免与宿主自带并发冲突。
- 建议边界：advisory 限流 + 文档约定，不做硬拦截。

**P1-6 task 持久化 / 跨会话 resume**
- 收益：进程重启/会话中断后不丢任务，可恢复计划与进度。
- 成本：中-高。registry 落盘 + 恢复；或把计划落到 `.oceanus/progress` 并在启动时重新加载。
- 风险：中。持久化格式、TTL、多进程并发写需设计。
- 建议边界：先做"把当前 running 任务与 plan 落盘、启动时可恢复状态视图"的最小版本；完整 boulder/plans/notepads 机制不移植（见第 7 节）。

### P2（增强 / 需评估）

**P2-1 rules / AGENTS 注入评估**
- 收益：把项目规则（AGENTS.md/rules）作为指令上下文注入，提升遵守一致性。
- 成本：中。需设计"注入哪些文件、优先级、与 v2 `agent.system` 的合并顺序"。
- 风险：中。OpenAgent 明确 AGENTS.md 只是指令、非权限边界——若把它误当权限控制会有误导；且注入过多会膨胀上下文。
- 建议边界：**先做注入优先级约定（project>opencode>user>builtin）与白名单文件，评估上下文成本后决定**；仅作为指令，不与 P0-2 权限矩阵混淆。

**P2-2 category / reasoning / variant 设置**
- 收益：支持 category 级模型设置与 reasoning/variant 策略。
- 成本：中-高。依赖 v2 host 是否支持 category 语义。
- 建议边界：先验证 v2 host 原生能力，非必要不造轮子。

---

## 7. 明确不建议移植（v1 生态 / 许可 / 规模）

以下能力**不建议**在本轮或近期移植：

| 能力 | 原因 |
|---|---|
| **完整 v1 harness / `PluginModule` 工厂** | OpenAgent 主要基于 v1 插件 API；Oceanus 已是原生 v2，移植 v1 工厂会引入双轨复杂度，与"轻量 v2"定位冲突（三方对比文档同样结论）。 |
| **team / multiplexer（tmux/cmux/kitty 等）** | 重运行时、与 v2 host 会话模型不匹配；Oceanus 无此需求。 |
| **telemetry（PostHog 等）** | 隐私与依赖成本高，且非编排能力。 |
| **memory-core 记忆系统** | 主要服务其它 Harness，跨会话记忆与 Oceanus 现有轻量结构不匹配。 |
| **80+ Hooks 完整组合** | 规模庞大、以 v1 事件模型为主；Oceanus 保留少量、fail-open、明确职责的 v2 Hook 更符合定位。 |
| **boulder/plans/notepads 完整恢复机制** | 设计依赖 OpenAgent 自身存储体系；仅借鉴"跨会话恢复"的最小行为（P1-6）。 |
| **复制其长 prompt 原文** | 见第 9 节，只借鉴行为/架构。 |

---

## 8. 推荐路线图与验收指标

### 路线图（建议顺序）

| 阶段 | 内容 | 依赖 |
|---|---|---|
| 阶段 0（本轮之后） | 真实 v2 host smoke：确认 `agent.reload()` 重建范围、`session.active/interrupt` 契约、v2 permissions schema | 无 |
| 阶段 1 | P0-1（preset 重建）按 smoke 结果修复；P1-2（能力一致性检查） | 阶段 0 |
| 阶段 2 | P0-2（默认权限矩阵）+ P1-1（Agent 元数据单一来源） | 阶段 1 |
| 阶段 3 | P1-4（task 依赖门控 advisory）→ P1-5（并发限流 advisory）→ P1-6（持久化最小版） | 阶段 2 |
| 阶段 4 | P1-3（模型 fallback，取决于 v2 host 原生能力）→ P2-1（rules/AGENTS 注入评估） | 阶段 0 结论 |
| 阶段 5 | P2-2（category/reasoning）等增强（非必需） | 阶段 4 |

### 验收指标

- **阶段 0**：host smoke 文档化，明确"reload 是否重建 transform 回调"这一核心问题的结论（含截图/日志证据）。
- **阶段 1**：`/preset` 切换后实际生效配置与目标配置一致；启动时若 agent 能力声明与配置冲突，控制台给出明确 warning。
- **阶段 2**：标称只读的 agent 在无配置覆盖时无法执行写操作（硬约束验证通过）；元数据表驱动 prompt 与权限无漂移（一致性测试覆盖）。
- **阶段 3**：`task_result` 对依赖未就绪任务返回可读提示；连续 N 波次并行不超过限流上限；进程重启后能从落盘恢复 running 任务状态视图。
- **阶段 4**：模型数组 fallback 在（主模型失败场景）可观测；AGENTS/rules 注入后上下文增量有量化评估。

> 每阶段均有可自动/半自动验证的指标，避免仅以"能跑"为验收。

---

## 9. 许可证与引用边界

- **本报告为只读研究**，未复制、未改写任何 OpenAgent 源码或长 prompt 原文。
- OpenAgent 仓库许可证为 **SUL-1.0**（Source Available / 非 OSI 标准），**不可直接复制其源码、长 prompt、80+ Hooks 实现**。
- 本项目仅**借鉴行为与架构模式**（默认权限矩阵思路、模型 fallback 思路、task 依赖/并发/恢复的机制设计），在实现层面优先参考 MIT 许可的 omo-slim，或直接基于 opencode v2 host API 自建轻量方案。
- 引用 OpenAgent 时使用其官方文档与仓库路径，并保持"行为参照"而非"移植来源"的定位，符合既有三方对比文档的结论。
