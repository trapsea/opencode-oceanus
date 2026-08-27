# Sidebar 模型数据延迟优化 设计规格

## 背景与根因

用户反馈 opencode TUI sidebar 的模型数据「更新慢、重启后加载慢」。

对比三个项目（opencode 本体、oh-my-opencode-slim、oh-my-openagent）确认根因：

1. **重启慢**：`src/tui.tsx` 的 `setup` 中 `await context.data.location.agent.sync(...)` **阻塞**到宿主 opencode 构建 agent/provider 状态（宿主启动会串行调用各 plugin 的 models() 网络 hook + models.dev 可能网络拉取）才挂载 sidebar。
2. **更新慢**：sidebar 模型数据完全依赖宿主 `location.agent` 的冻结快照，**无本地权威数据**；运行时靠事件驱动 `sync`/`invalidate` 重拉，新模型/新配置更新滞后，需重启/改 config 才反映。

## 目标

- 重启秒开：sidebar 首帧不再等待 `agent.sync`，直接从本地插件配置读模型渲染。
- 更新快：会话内切换 model / agent 配置变更能即时反映到 sidebar。
- 不新增缓存文件、不引入 version/updatedAt 字段。

## 已确认设计决策

1. **数据源：插件配置为唯一权威**。sidebar 模型直接读 `opencode-oceanus.json`（经 `loadPluginConfig`，本地同步读文件，秒开），作为权威来源。**不新增缓存文件**。
2. **回写仅内存、仅当前会话族**。监听 `session.model.selected`（当前宿主 opencode beta-18230 中唯一携带 `ModelRef` 的回写数据源；该版本**不存在** `message.updated` 事件），将「最近实际使用 model」写入**内存**，仅影响当前会话族（`family(props.sessionID)`）对应 agent 的展示；不落盘，重启/换 agent 后回退到配置 model。事件回调必须先校验 `event.data.sessionID ∈ family(props.sessionID)` 再记录，防止跨窗口串数据。
3. **setup 非阻塞**。去掉 `await agent.sync()`；改为先渲染配置 model，再 fire-and-forget 后台完成 `agent.sync` + `invalidate`，完成后刷新。
4. **展示优先级（不覆盖显式配置）**：
   - `agent.model`（配置）存在 → 显示配置 model；
   - 配置 model 为 undefined 且存在会话回写 → 显示回写 model，加视觉标记（如 `*`）；
   - 都无 → 显示「跟随会话」。
5. **回写优先级**：会话回写**永不覆盖** agent 显式配置的 model。
6. **修正 fallback 文案与行为一致**：现状文案「暂按会话模型降级」并未真正降级（rows 为空时无会话模型数据）；本次将其改为真实降级展示（agent 列表空时显示当前会话 model）或调整文案。

## 非目标（明确不做）

- 不改宿主 opencode 内核（provider/agent 冻结快照构建、串行 listModels 网络调用、`location.agent.sync` 宿主语义）。
- 不做 models.dev 快照打包（openagent 方案）。
- 不做 provider 全量模型目录 / 模型选择器 UI。
- 不改 `calibrateStatus` 的会话活跃点逻辑、`session.inbox.delivered → refreshAgents` 的 preset 切换链。
- 不改配置解析（`loadPluginConfig`/presets 合并逻辑）。
- 不改既有纯函数语义（normalizeModel/bareModelName/sortAgentRows/getRelatedRunningSessions）。
- 不跨机器同步、不做容量管理、不存敏感数据。

## Metis 分析

### 需求缺口（已通过决策覆盖）
- 缓存失效策略 → 不落盘，配置为唯一权威，事件驱动刷新即天然自愈。
- 回写优先级与生命周期 → 不覆盖显式配置；按 agent 维度聚合、最近一次使用胜出；仅当前会话族生效。
- 启动时序 → 无缓存即渲染 fallback + 后台 sync（不阻塞）；有配置 model 即渲染配置。
- 跨窗口一致 → 配置为主，配置变更经 `agent.updated` 事件驱动；不做持久化回写故无跨窗口回写冲突。
- 并发写 → 无磁盘回写，天然规避。
- scope key / workspaceID → 不落盘故无需 scope key。
- 手动刷新入口 → 不在本次范围。

### 风险
1. **回写覆盖显式配置**（最高成本）→ 已约束：仅当配置 model 为 undefined 时回写，显式配置永不被覆盖。
2. **启动时序竞态** → setup 去掉 await 后，无配置 model 时先渲染 fallback，sync 完成后跳变；可接受。
3. **事件风暴频繁触发** → 数据源仅 `session.model.selected`（低频，非流式逐 token 事件），且 `recordRecall` 同值短路不触发刷新，无渲染风暴。
4. **回写固化临时切换** → 回写仅内存、仅当前会话族，重启/换 agent 即回退，不会固化。
5. **fallback 文案与行为不一致** → 本次一并修正。
6. **回写仅覆盖会话显式切 model 场景** → `session.model.selected` 只在会话明确选择模型时触发；配置 model undefined 且从未切换模型的 agent 回写为空，显示「跟随会话」。此为本版本可回写数据源的边界，符合「配置为主」语义。

### 边界/非目标
见上「非目标」。

### 反例/边界条件（实现须处理）
- `context.location` 为 undefined → `loadPluginConfig` 传 directory 为 undefined 走用户配置路径即可；回写仍可按会话族记录。
- 事件 `session.model.selected` 早于 agent 列表就绪 → 回写按 agent id 存内存，展示时再 join。
- `agent.sync` 失败 → 保持 catch 静默，配置 model 兜底展示，不 crash。
- 会话回写对应 agent 已从白名单消失 → 展示时与 `OCEANUS_AGENT_NAMES` 求交过滤。
- 同 agent 多会话不同 model → 聚合取最近一次使用胜出。
- model 为 undefined（跟随会话）→ 显示「跟随会话」；undefined 回写不覆盖已有回写。

### 可验证验收标准
- **单元测试**（扩展 `src/tui.test.ts`）：
  1. 展示优先级：配置 model 存在 → 显示配置；配置 undefined + 回写 → 显示回写（带标记）；都无 → 跟随会话。
  2. 回写不覆盖显式配置：配置 model 存在时回写不影响展示。
  3. 聚合规则：同 agent 最近一次使用胜出。
  4. 白名单过滤：非 `OCEANUS_AGENT_NAMES` agent 不展示。
  5. 既有纯函数测试全绿；`bun run typecheck`、`bun run build` 通过。
- **启动时序**：mock 一个永不 resolve 的 `agent.sync`，断言 `setup` 仍返回、sidebar 挂载成功（不阻塞）。
- **人工行为**：
  - 启动 opencode：TUI 立即出现，不再卡在启动期。
  - 会话内 `/model` 切换：对应 agent 行更新为实际使用 model（回写路径）。
  - 改 agent 配置 model 保存：sidebar 显示配置 model（不覆盖）。
  - 重启 opencode：无 model agent 显示配置 model 或「跟随会话」，无需等待 sync。

## 约束

- TDD：先补可自动验证的测试，再做实现。
- 共享工作区；并行任务文件范围不重叠；并行任务不得改 ledger、运行 git 操作或越界编辑。
- 保持 `.oceanus/spec/`、`.oceanus/plan/` 可追踪，`.oceanus/progress/` 忽略。
