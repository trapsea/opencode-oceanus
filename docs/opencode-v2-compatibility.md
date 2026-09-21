# OpenCode v2 兼容性记录

## 适用范围

本文记录 `opencode-oceanus` 当前依赖和实际代码针对的 OpenCode v2 API。OpenCode 2 已发布正式版（`@opencode/*@2.0.x`）；本文同时记录 beta 锁定现状与 2.0 正式版实测结论。它不是对所有 OpenCode v2 版本的兼容承诺，也不从 build 号推断宿主应用版本号。

## 当前版本基线

| 项目 | 当前值 | 证据 |
|---|---|---|
| 插件包 | `opencode-oceanus@1.0.4` | `package.json:2-4` |
| OpenCode 插件 API | `@opencode/plugin@2.0.10`，精确锁定 | `package.json`、`bun.lock` |
| OpenCode schema | `@opencode/schema@2.0.10`，精确锁定 | `package.json`、`bun.lock` |
| 正式版包族 | `@opencode/{plugin,schema}@2.0.10` 已核实；目标宿主为 `@opencode/cli@2.0.10`，真实 Host 尚待复测。旧 `@opencode-ai/*` 仍是 v1 线；CLI bin 双名 `opencode`（主）+ `opencode2`（别名）。 | npm tarball 与官方 tags（2026-09-20），详见 [`../opencode2/versions/changelog.md`](../opencode2/versions/changelog.md) 2.0.7 → 2.0.10 条目 |
| 实测宿主 | `@opencode/cli@2.0.5`：升级前发布包在 `skill.transform` 报 `SchemaError: Missing key at ["path"]`，宿主将插件标为 `failed`；修复后在隔离 Host 加载本仓库 `dist`，`/api/plugin` 返回 `opencode-oceanus: active`（server+tui），`/api/skill` 返回全部 10 个 Oceanus skills，均有 `path`。 | `~/.local/share/opencode/log/opencode.log`、隔离 `opencode serve` + `/api/{plugin,skill}`（2026-09-17） |
| 2.0.3 → 2.0.5 类型面差异（对本插件） | `Skill.Info.location` → 必填 `path`【本插件受影响，已迁移】；`catalog` 拆为 `provider`/`model`、`Session.rename` → `update`、`Vcs.branches` → `Vcs.branch.list`、`PermissionDomain.rules` 移除、`websocket` → `transport`。其余均未被本插件消费。 | plugin/schema 2.0.3/2.0.5 tarball 全量 diff，见 [`../opencode2/versions/changelog.md`](../opencode2/versions/changelog.md) |
| 可选 peer | `@opentui/solid >=0.5.10`、`solid-js >=1.9.0`、`zod ^4.0.0`；前两者 optional | `package.json:47-59`（对齐 `@opencode/plugin@2.0.3` peerDeps 的 `@opentui/* >=0.5.10`；正式版 plugin 另有 optional `@opencode/theme` 与 `@opentui/core`，本插件不消费不声明） |
| 构建目标 | Bun build，Node/ESM；OpenCode plugin、schema、OpenTUI 和 Solid 外部化 | `package.json:25` |
| 入口 | CLI `dist/index.js`，TUI `dist/tui.js` | `package.json:6-16` |

锁定版本不是宿主版本号映射。升级时应同时检查 `package.json`、`bun.lock`、安装后的类型声明和真实 OpenCode Host，而不是只替换 beta 编号；**升 2.0 正式版需整体迁 `@opencode/*` 新 scope**（包坐标 + import 路径）。

## 2.0.7 → 2.0.10 兼容性审查（2026-09-20）

- `ToolEditor.list()` 是唯一 plugin 声明新增面；Oceanus 只通过 `ctx.tool.transform` 注册工具，不枚举宿主工具，**无需代码调整**。
- provider/model/agent 请求设置的 schema 收敛：`compaction` 由顶层 `{ mode: "local" } | { mode: "provider"; threshold? }` 改为 `settings.compaction: { type: "summary" } | { type: "native" }`，`transport` 同样迁入 `settings`。Oceanus 不消费 provider/model 字段；对 agent `request.settings` 写入的 `temperature` 和自定义 options 仍受扩展 record 支持，**无需代码调整**。
- `@opencode/client` 的 `SessionStatus` 声明未变，`src/tui.tsx` 的类型消费安全；`EnsureTiming.attempts` 移除及 shell status 联合重排均未命中 Oceanus。
- 本次升级仅已完成静态兼容性审查。真实 `@opencode/cli@2.0.10` 中的插件加载、agent/skill/tool/hook 注册、更新桥接与 TUI sidebar 仍是交付前运行时复测项；不得将类型、mock 或构建通过表述为真实 Host 通过。

## 2026-09-20 审查修复记录

- `/preset` 会话模型切换的 `#variant` 解析修复：原先手工 `slice(slash+1)` 会把 `provider/model#variant` 字符串中的 `#variant` 误并入 model id；现统一经宿主 `Model.Ref.parse` 语义解析（`src/config/presets.ts` 的 `resolveSessionModelRef`），与 `src/agents/index.ts` 的配置解析口径一致，并补齐数组对象项 variant 与优先级语义的单测。
- 删除 `draft.remove('build'/'plan')` 兼容逻辑：宿主 2.0.3 起内置 agent 清单已无 build/plan（[`../opencode2/versions/changelog.md`](../opencode2/versions/changelog.md)），在 `@opencode/*@2.0.10` 精确锁定下为死代码。
- 配置 schema 补齐 `tools.clipboard_image` / `tools.oceanus_config_generate` 与 `hooks.image_materializer` / `hooks.image_error_hint`：此前结构化写法会被 `.strict()` 拒绝，进而使整份配置在 loader 侧失效回落全默认，与 hooks/tools 实际查询的键不一致（README 已先行文档化这些键）。
- preset-watcher 注册 cleanup 后 `hasCleanup` 置 true：无其他 cleanup 来源时 `runSetup` 也会向宿主返回 cleanup，卸载/重载时可释放 2s 轮询与 fs.watch。
- 文档台账同步：直接工具数为 5（非 9）、版本基线统一 2.0.10、`src/*.ts` 行号引用改为符号引用（行号随代码演进漂移，符号引用更稳定）。

## 已核实的 v2 API 约束

| API/行为 | 当前代码依赖或防御 | 证据与状态 |
|---|---|---|
| `Plugin.define({ id, setup })` | CLI 和 TUI 使用 v2 插件定义；`Plugin.tui` 字段已于 beta-18721 移除，CLI 不再声明，TUI 入口经 `exports["./tui"]` 结构性声明 | `src/index.ts`、`src/tui.tsx:681-686`；类型/mock 已验证 |
| `ctx.tool.transform` + `Tool.Options.codemode` | 5 个直接工具（`DIRECT_TOOL_NAMES`：`ast_grep_search` / `ast_grep_replace` / `clipboard_image` / `oceanus_config_generate` / `cbm_index`）在注册包装层注入 `codemode: false` 进入会话直接工具目录；CBM CLI wrapper 工具同款注入，`codebase-memory-mcp` MCP server 亦显式 `codemode: false`（`src/cbm/mcp.ts`，2026-09 变更：direct 工具进会话目录按名称直接调用，此前缺省 Code Mode 导致调用摩擦使实际全走 wrapper）。宿主 registry 实证（beta-18230 二进制）：`codemode !== false`（含缺省）只进 Code Mode catalog，仅 `execute` JS 运行时内 `tools.<name>` 可调；subagent 不走该路径（实测回退宿主原生 `edit`）。宿主原生 write/webfetch/websearch 均显式 `codemode: false` | `src/tools/index.ts`（DIRECT_TOOL_NAMES 注入）、`src/cbm/mcp.ts`、`docs/tooling-and-runtime.md`、`docs/codebase-memory-mcp.md`；运行中宿主二进制反编译 + fixer 工具目录实测已验证 |
| `ctx.agent.transform` + `ctx.agent.reload` | 通过 transform 注册/更新 agent，并在 preset 切换后 reload | `src/index.ts`（applyAgentDefinitions / mergeAgentPermissions）；类型/mock 已验证 |
| `Context.location` 已正式声明（beta-18721+） | 目录解析仍统一经 `resolvePluginDirectory`：`ctx.location.directory` → 旧 `ctx.directory` → `process.cwd()`；探测链降级为运行时防御，不因类型声明移除 | `src/runtime/host-adapter.ts`、`src/runtime/types.ts`、`src/index.ts`（runSetup 内 resolvePluginDirectory 接线）；宿主 beta-18743 复测 |
| `SkillEditor` 使用 `list/add/update/remove` | 注册 skill 只调用官方 `draft.add()`，不依赖未公开的 `source()`；2.0.5 的 skill `path` 使用绝对路径 | `src/index.ts`（skills 阶段 ctx.skill.transform）；类型/mock 已验证，真实 Host 复测待执行 |
| TUI `SlotClaim.render` 是 Solid 组件一次性挂载（beta-18721+ 宿主反编译） | 宿主 SlotHost 以 `createComponent(claim.render, props)` 挂载，仅随 claim 集合/slot input（sidebar 仅 `{sessionID}`）变化重执行；`renderer.requestRender()` 只调度重绘帧、不重跑组件函数。面板刷新改为 tick 信号 + keyed Show 整树重建：宿主插件运行时把 `solid-js`/`@opentui/solid` 别名到宿主共享实例，插件信号参与宿主 reactive graph；solid-js 不可用时 fail-open 回退 requestRender 模式。另注意裸 `solid-js` 在 node 条件下解析为无响应式的 server 构建，真实响应式在 `solid-js/dist/solid.js`（`@opentui/solid` 同款路径），运行时按"裸名优先（宿主别名）、子路径兜底"探测，每个候选经响应式自检（server 构建被拒）。2026-09-11 起新增宿主 store 驱动刷新（beta-prime observer）：在共享 graph 内以 effect 读 `context.data.session.*`（宿主 solid store）自动 bump，封死事件丢失/静默窗口的面板冻结——沙箱实验（复刻宿主 loader 重写加载真实 dist）实证对照组重建 0 次、实验组双向传播；`observe` 随实例能力 fail-open 缺省 | `src/tui.tsx`（`loadPanelReactivity`/`PanelReactivity`/wirePanel observer 注释）、`src/tui.test.ts`（beta-prime observer 用例）；宿主 beta-18743 二进制反编译（SlotHost `Zl(a.render, Use(s))`、模块别名表 `"solid-js":QJ`）+ solid 1.9.15 源码（keyed Show 要求 `child.length > 0`）+ 2026-09-11 沙箱实验（Bun onLoad 重写 + build.module 注入，真实 dist/tui.js）；真实 TUI 端到端未复测（实施后按 T4-③ 日志判定重写生效） |
| `SessionDomain` 未暴露 `active` | 任务运行时探测宿主能力，并在缺失时降级到可用 session/registry 信息 | `src/runtime/types.ts`（SessionLike 契约）、`docs/tooling-and-runtime.md:167-168`；真实 Host 未完整验证 |
| agent model 是单个 `ModelRef` | 配置数组只取首项，不能假设 Agent.Info 接受模型数组 | `src/agents/index.ts`（getPrimaryModelFromOverride）；源码已验证 |
| `plugins` 与 TUI 配置 | CLI 和 TUI 是两个入口；配置字段/加载差异应以当前宿主文档和真实 Host 复测 | `README.md:124-147`；这是 README 声明，仓库代码未独立验证 |
| `plugins` 本地路径必须是含 index 入口的目录（宿主 `0.0.0-beta-18721` 实测） | 配置条目指向目录时宿主在目录内解析 `index` 入口文件（`dist/` 目录含 `index.js` 可正常加载）；指向单文件报 WARN `configured plugin path must be a directory`，指向无 index 文件的目录报 WARN `configured plugin directory has no index entrypoint`，两种情况插件均被整体跳过、所有 agent 不注册 | 2026-08-31 实测：`~/.local/share/opencode/log/opencode.log` 服务日志 + `opencode2 api get "/api/agent?location[directory]=…"` 验证三种写法仅目录形式注册出 oceanus/sisyphus 全量 agent；README 安装示例已同步为 `dist` 目录写法 |
| `ctx.mcp.transform` + `ctx.mcp.reload`（`MCPDomain = Pick<McpApi, "list">` 形态） | CBM server 注册只调用 `transform`（`draft.get/set/remove`）与 `reload`，两者在 beta-18721→19271 类型面均未变化（18743/19242/19271 三版 `mcp.d.ts` 对比：18743→19242 变化不影响本用法，19242→19271 零差异） | `src/cbm/mcp.ts`（registerCbmMcp）；宿主 `@opencode/cli@19296` 实测：日志出现 `server=codebase-memory-mcp` 连接尝试即证明 transform 注册生效（连接失败为 CBM daemon 生命周期问题，与注册契约无关，2026-09-09） |
| permission 对象形式（资源级规则）经 `toPermissions` 转换 | `prometheus` 主 agent 权限已收敛（2026-09-10）：`task`/`subagent` 整体 `deny`（不委派任何 subagent，全部研究自查）+ `skill: 'deny'`、`question: 'allow'`；对象形式仅剩 `shell` 模式表（继承只读表）。**注册层真实宿主已验证（beta-19296，2026-09-10，隔离 serve 实例 + 工作区 dist）**：prometheus 以 `mode: primary` 注册、temperature 0.3、system prompt 注入正确；宿主接受资源级规则并按"基线在前、插件规则在后"合并；宿主内置 build/plan 被移除。**运行时评估已实锤（2026-09-10 真实会话）**：宿主 task 工具以裸 agent 名评估权限——宿主 `tool/task.ts` `ctx.ask({ permission: 'task', patterns: [params.subagent_type] })`，`evaluate` 走 `Wildcard.match(裸名, rule.pattern)`，前缀式 resource（`task.explorer`）永不匹配、findLast 命中 `{'*': 'deny'}`，旧白名单 fail-closed 全拒（真实会话报「@explorer 不可用（白名单中的目标在权限层实际不存在）」属实）；处置：移除对象形式白名单，收敛为整体 deny + prompt 自查纪律。**仍待验证**：`question`（插件自定义工具）在受限 primary 会话的阻塞行为 | `src/config/constants.ts`（`PROMETHEUS_PERMISSION`）、`src/index.ts`（`toPermissions` 资源级转换）、`src/agents/prometheus.ts`；隔离实例 API 验证记录见本行（验证用临时 serve 已清理，未触碰用户全局配置与共享服务） |

## 宿主 Windows shell 事实矩阵（2026-09-11 源码核实；2026-09-14 经 `@opencode/core@2.0.3` 复核）

以下事实来自宿主源码直接阅读（`packages/core/src/shell.ts`、`packages/opencode/src/tool/shell.ts`、`tool/shell/id.ts`、`tool/shell/prompt.ts`、`permission/arity.ts`、`permission/index.ts`、`packages/cli/src/services/daemon.ts`），是插件跨平台适配（Windows 兼容修复）的依据：

| 事实 | 宿主行为 | 插件适配 |
|---|---|---|
| shell 工具权限键 | beta 宿主恒为 `'bash'`（`tool/shell/id.ts` 注释预告 2.0 改名）；**2.0（beta-19507+）已落地改名 `'shell'`**（`@opencode/core@2.0.3` 源码：`name = "shell"`、`permission.assert({action: name})`；v1 配置迁移层 `normalizeAction2` 将 bash→shell、task→subagent、write/patch→edit） | 只读 shell 护栏 `shell` + `bash` 双键（两代宿主均有效键在表）；2026-09-11 修复 + 2026-09-14 注释主次更新 |
| Windows 实际 shell 选择 | `core/src/shell.ts:98-106,119`：默认按 `pwsh → powershell → Git Bash → COMSPEC(cmd)` 选择；可配置覆盖 | 提示词不再默认 Unix 语法；明确"实际 shell 以 shell 工具描述（beta 宿主为 bash 工具）中的 OS/Shell 标注为准"（`constants.ts` 文件操作规则、`oceanus-plan` 计数验证） |
| 工具描述按 shell 动态渲染 | `tool/shell/prompt.ts`：PowerShell/cmd 有专门 commandSection（含 PowerShell 5.1 无 `&&` 提示、cmd 用 `%VAR%`、here-string/临时文件提交 PR body）；`shell.txt:3` 注入 `OS/Shell/tmp` | 插件提示词与宿主描述冲突时以宿主为准；`git-commit` 指令改用 `-F` 临时文件规避 PowerShell/cmd 中文消息编码与引号问题 |
| 权限 pattern 生成 | `tool/shell.ts:392-410`：tree-sitter 解析命令，`BashArity.prefix` 取前缀 token（cmdlet/cmd/未知名取首 token），管道两侧 command 节点分别生成 pattern（不含 `\|`） | deny 表用动词式规则即可覆盖管道右侧（`Out-File *` 拦 `\| Out-File`）；git/npm/bun 子命令跨 shell 同名继续生效 |
| `Wildcard.match` 大小写语义 | `core/src/util/wildcard.ts:13`：win32 大小写不敏感（`si`），其余平台敏感（`s`） | PowerShell cmdlet 规则 PascalCase + 小写双写（覆盖非 win32 平台 pwsh 场景）；cmd 动词惯例小写单写 |
| 宿主自维护跨 shell 写动词集 | `tool/shell.ts:29-64`：`FILES`（含 PowerShell cmdlet）+ `CMD_FILES`（cmd 内置）用于 external_directory 询问 | 插件 deny 表动词清单对齐该集合的写入子集（只读 cmdlet 不拦） |
| 宿主 daemon 注册协议 | `packages/cli/src/services/daemon.ts:39-41`：`<state>/opencode/server.json`（`{id?,version?,url,pid}`，无 password）+ 同目录 `password` 文本文件 | `src/update/host-update.ts` 按 `server.json → service.json` 双候选探测，password 从 JSON 内联（旧）→ 独立文件（新）解析 |

评估链完整语义（修复依据）：`toPermissions`（`src/index.ts`）生成 v2 `{action, resource, effect}` → 宿主映射为 v1 `{permission: action, pattern: resource, action: effect}` → `evaluate(permission='bash', pattern, ruleset)` 走 `Wildcard.match('bash', rule.permission) && Wildcard.match(pattern, rule.pattern)`、findLast 后声明优先（`permission/index.ts:28-38`）。语义级回归测试见 `src/config/shell-permission.test.ts`（复刻宿主 wildcard/evaluate 语义，宿主升级时需同步复刻函数）。

## 2.0.3 适配记录（2026-09-14）

依赖与代码已全量迁移到 OpenCode 2.0 正式版（`@opencode/{plugin,schema}@2.0.3`）：

1. **依赖坐标迁移**：`@opencode-ai/{plugin,schema}@0.0.0-beta-18743` → `@opencode/{plugin,schema}@2.0.3`；`src/{index.ts, agents/index.ts, tui.tsx, runtime/types.ts}` 共 5 处 import 随迁（含 `@opencode-ai/client` → `@opencode/client`，transitive 依赖确认存在）；build `--external` 更新为 `@opencode/{plugin,schema}`；peer `@opentui/solid` 提升至 `>=0.5.10`（对齐 2.0.3 plugin peerDeps）。typecheck + 972 测试零错误——插件消费面与 2.0.3 类型完全兼容（`SessionContext.options` 合并等 breaking 面本插件未消费，explorer 全量盘点 + 编译双确认）。
2. **权限 action 键改名落地**（宿主源码 `@opencode/core@2.0.3` 核实 + 当前 2.0.3 会话工具目录实证）：shell 工具 `bash→shell`、subagent 工具 `task→subagent`、edit/write/patch 工具统一 action `edit`（v1 配置迁移层 `normalizeAction2` 同口径）。本插件权限表双写（bash+shell、task+subagent、edit+write+apply_patch）在两代宿主下语义均正确，无需改表——仅更新注释主次（2.0 起 `shell`/`subagent` 为有效键，`bash`/`task` 为 beta 兼容保留）。`evaluate` 语义（findLast + 双 wildcard + 默认 ask）与 `Wildcard.match`（win32 大小写不敏感）经 2.0.3 源码复核与 beta 逐字一致，`shell-permission.test.ts` 复刻仍准确。
3. **提示词与 hook 工具名对齐**：agents 提示词中"bash 工具"表述全部改为"shell 工具"（`constants.ts` ×2、`tool-matrix.ts`、`git-commit.ts`；2.0.3 会话工具目录实证工具名为 `shell`/`subagent`）。**三处按宿主工具名键控的 hook 表同步双名键控**（Oracle 审查发现，2026-09-14 修复）：`json-error-recovery` 排除清单 +`shell`、`tool-loop-guard` 豁免表 +`subagent`（写工具表 +`patch`）、`apply-patch` hook 改 `APPLY_PATCH_TOOLS` 集合（`apply_patch`+`patch` 双键；2.0.3 会话目录实证两者均未直接暴露，双键保守覆盖两代宿主）——与权限表既有双写策略同构。
4. **事件 wire 双形态确认**：`ctx.event.subscribe` 的 2.0.3 wire 为 `{id, created, type, location, data:{sessionID, parentID?}, durable}`（隔离 serve SSE 实测），beta 为 `properties.info`；`src/update/index.ts` 消费代码本就双形态兼容读取（`properties.info ?? data`），仅注释更新；测试两种形态均覆盖。
5. **配置发现**：项目配置 2.0.3 实测需 `opencode.jsonc`（`.json` 不被识别）；插件本地路径必须目录（单文件 beta-18721 与 2.0.3 双实测一致）；README 已按实测修正（含 TUI 配置段——`plugins` 指向 `dist` 目录即可双入口加载，`cli.json` 为官方 V2 文档口径的 CLI-only 配置文件）。**宿主惰性加载时序注记**：serve 进程对某 location 的插件加载是异步的——进程启动后立即发出的首个 API 请求可能返回"未加载快照"（agents 仅宿主内置、插件条目缺失）；稍候重查或二次查询即得完整状态（2026-09-14 反复实测确认，非插件缺陷；排查插件加载问题时勿以首查快照下结论）。

## 插件侧版本与运行时边界

- setup 阶段不从 `ctx.session` 读取当前会话 ID：该对象是 `SessionDomain` API 域，不是会话实例；真实父会话 ID 只在工具/事件上下文中使用。参见 `src/runtime/types.ts`。
- `session.wait({ sessionID })`（后台调研同步门禁依赖）：`SessionLike.wait?` 类型契约见 `src/runtime/types.ts`，出处为官方 v2 插件文档 `SessionContext.wait(input)`（等待会话空闲/结束）；prompt 层已带宿主不可用时的 fail-open 兜底（discuss/plan skill 阶段入口）。真实宿主端到端未实证，升级宿主时需复测。
- `session.active`、`interrupt` 等真实 Host 能力在普通 `bun test` 中没有真实宿主；相关 smoke 会 skip 或使用 mock，不等价于真实 Host 通过。参见 `README.md` 与 `src/smoke/` 下测试。
- 图片 `prompt` / `retry` hook 属于运行时能力：beta-18721+ 类型联合已正式覆盖 `prompt`/`retry`，注册仍保留运行时能力探测并 fail-open（类型声明不等于运行时保证）；`retry` 不可用不得影响 `prompt`。参见 `src/hooks/index.ts`（image hooks 注册段）与 `src/hooks/image-*.ts`。
- CBM 二进制版本与 npm 插件版本解耦；当前默认 CBM 版本为 `0.10.8`，下载必须经过内置 manifest 的 SHA-256 校验。参见 [`codebase-memory-mcp.md`](codebase-memory-mcp.md)。
- AST 工具依赖真实 ast-grep CLI；OpenCode Host 不会替插件安装该 CLI。参见 [`tooling-and-runtime.md`](tooling-and-runtime.md)。

## 验证分层

### 已验证

- package manifest、lockfile 与当前安装依赖的版本声明一致（以当前工作区实际文件为证据）。
- TypeScript 类型、mock context 注册契约、工具/Hook/skill 注册测试可在 `bun test` 中验证。
- 构建、声明文件与 dist skill 一致性可用 `bun run check` 和 `bun run check:dist` 验证。

### 未验证或需真实宿主复测

- 真实 Host 中 `session.active`、`interrupt`、skill draft 形态、CLI/TUI 加载字段的最终行为。
- 真实 Host 是否接受图片 `prompt` / `retry` hook 名称，以及 `/builtin/...` skill location 是否要求可直接访问的物理文件。
- 兼容链路（截至 2026-09-14）：beta-18743 类型面 → beta-19271 零 breaking → beta-19507/2.0.0（session hooks 重构，本插件未消费面）→ 2.0.3，宿主实测插件加载与注册链路正常（beta-19296 于 2026-09-09、2.0.3 于 2026-09-14，见「当前版本基线」与「2.0.3 适配记录」）。**待复测**：2.0.3 宿主上 TUI 侧栏（`tui.js`）渲染与图片 hook 的端到端运行时行为（serve 实测覆盖注册面与 `features.tui` 声明，未覆盖 TUI 进程内渲染）。

## 升级检查清单

1. 读取目标 OpenCode 版本的官方 API/类型声明，确认 `Plugin`, `Context`, `Agent.Info`, `SkillEditor`, `SessionDomain` 的变化（本库事实台账：[`../opencode2/`](../opencode2/README.md) 各分篇 + [`../opencode2/versions/changelog.md`](../opencode2/versions/changelog.md)）。
2. 升级到 2.0 正式版时**先迁包坐标**：`@opencode-ai/{plugin,schema}` → `@opencode/{plugin,schema}`（import 路径全量随迁；旧 scope 无 2.x 版本）。核对 plugin peerDeps 新增的 optional `@opencode/theme`/`@opentui/core`。
3. 若消费 session `context` hook：迁移 `generation`/`providerOptions` → `options`（beta-19507 起的 breaking，本插件当前未消费）。
4. 更新 `package.json` 与 `bun.lock`，确认 plugin 与 schema 版本配套，并记录确切版本，不写未经证实的宿主版本号。
5. 检查 `src/index.ts`、`src/tui.tsx`、`src/runtime/`、`src/agents/` 的兼容性探测与 fallback。
6. 运行 `bun run typecheck`、`bun test`、`bun run build`、`bun run check:dist`。
7. 在真实 OpenCode Host 安装构建产物，分别验证 CLI agent/skill/tool/hook、TUI sidebar、session 能力和 task reuse；将 skip、degraded、失败与通过分别记录。项目配置使用 `opencode.jsonc`（2.0.3 实测 `.json` 不被识别）。
8. 若 API 变化影响公共接线，先更新本文件和 [`AGENTS.md`](../AGENTS.md)，再提交实现变更；不要把 README 的旧表述当作升级依据。
