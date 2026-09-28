# OpenCode v2 版本变动记录（changelog）

> 本文件是 opencode2 参考库的版本变动台账。每个条目记录两个相邻（或指定对）版本之间的 API/能力差异，供 `opencode-oceanus` 适配升级时评估影响面。
> 方法论：以 npm plugin/schema tarball 的 `.d.ts` 全量 diff 为权威证据源，宿主 CLI 实测与官方文档为辅助；差异结论按"对本插件的影响"分级标注（breaking / 正式化 / 新增 / 无关）。
> 包名注意：beta-19507 起插件包已迁往新 scope `@opencode/{plugin,schema}`（见 2.0.3 条目）；旧 `@opencode-ai/*` 停在 beta-19271。

## 追加模板

```markdown
## <旧版本> → <新版本>

- 日期：<记录日期 YYYY-MM-DD>
- 证据源类型：<tarball .d.ts diff / 宿主实测 / 官方文档 / GitHub commit 对比>
- 影响分级：<breaking | 正式化 | 新增 | 无关>（逐条标注）

### <差异条目>
<签名级差异 + 对插件的影响与适配动作>
```

## 索引

| 条目 | 状态 |
|---|---|
| beta-18230 → beta-18721 | ✅ 已核实（全量 .d.ts diff，2026-08-31） |
| beta-18721 → beta-18743 | ✅ 已核实（全量 dist diff，2026-09-01） |
| beta-18743 → beta-19242 | ✅ 已核实（全量 dist diff，2026-09-07） |
| beta-18743 → beta-19271 | ✅ 已核实（全量 dist diff 三方分解，2026-09-09；19242→19271 增量详列，18743→19242 部分见下条目） |
| beta-19271 → 2.0.3（GA） | ✅ 已核实（tarball 归一化 diff 三方分解 + 宿主 2.0.3 实测，2026-09-14） |
| 2.0.3 → 2.0.5 | ✅ 已核实（plugin/schema tarball 全量 diff + `@opencode/cli@2.0.5` 真实宿主失败日志，2026-09-17） |
| 2.0.5 → 2.0.6 | ✅ 已核实（plugin/schema tarball 全量 diff + GitHub compare 官方 commit 序列，2026-09-18） |
| 2.0.6 → 2.0.7 | ✅ 已核实（plugin/schema/client tarball 全量 diff + GitHub compare + `@opencode/cli@2.0.7` 隔离 serve 实测，2026-09-18） |
| 2.0.7 → 2.0.10 | ✅ 已核实（plugin/schema/client tarball 全量 diff + GitHub compare；尚未真实 Host 实测，2026-09-20） |
| 2.0.10 → 2.0.12 | ✅ 已核实（plugin/schema 三版 tarball 全量 diff + GitHub compare + `opencode v2.0.12` 宿主会话内实测，2026-09-22） |
| 2.0.12 → 2.0.14 | ✅ 已核实（plugin/schema/client 三版 tarball 全量 diff + GitHub compare（本地 clone tags）+ `@opencode/*@2.0.14` 编译实证 + `opencode v2.0.14` 隔离 serve 与会话内实测，2026-09-23） |
| 2.0.14 → 2.0.15 | ✅ 已核实（plugin/schema/client tarball 全量 diff + GitHub compare（本地 clone tags）+ `@opencode/*@2.0.15` 编译实证 + `opencode v2.0.15` 隔离 serve 与会话内实测，2026-09-24） |
| 2.0.15 → 2.0.18 | ✅ 已核实（plugin/schema/client/opentui 四版 tarball 全量 diff + GitHub compare（本地 clone tags，三段）+ `@opencode/*@2.0.18` 编译实证 + `opencode v2.0.18` 隔离 serve 与会话内实测，2026-09-28） |
| 更早历史版本 | 未回溯（build 数百个，按需增量补录） |

---

## 2.0.15 → 2.0.18

- 日期：2026-09-28（记录）；发布时间线：v2.0.15 tag 2026-09-23 07:15 UTC → v2.0.16 2026-09-24 06:34 UTC → v2.0.17 2026-09-25 21:09 UTC → v2.0.18 2026-09-25 23:57 UTC（npm plugin/schema/cli 同步发布；2.0.16→2.0.17 间隔约 1.5 天，2.0.17→2.0.18 仅约 2.8 小时，2.0.18 为 latest）。本机宿主 `opencode --version` → `opencode v2.0.18`。
- 证据源类型：`@opencode/{plugin,schema,client}@2.0.15`/`2.0.16`/`2.0.17`/`2.0.18` 四版 tarball dist 全量 diff（权威口径）+ GitHub `anomalyco/opencode` 本地 clone `git fetch origin tag v2.0.{16,17,18}` 三段 compare（边界 `6f3639d`（v2.0.15）→`3a103fe`（v2.0.16）→`04f4b06`（v2.0.17）→`cd9a14a`（v2.0.18）：63 commits/561 files/+54585−4330、73 commits/371 files/+10558−4106、4 commits/52 files/+278−114）+ 编译实证（全量 src 含 `tui.tsx` 置于 `@opencode/{plugin,schema,client}@2.0.18` + `@opentui/{core,solid}@0.5.12` 下 `tsc --noEmit` 零错误，typescript 7.0.2 与项目 `^7.0.0` 同基线）+ 隔离 serve 运行时实测（2026-09-28）。
- 可复现性：空目录 `npm pack @opencode/{plugin,schema,client}@<v>`（v ∈ `2.0.15`/`2.0.16`/`2.0.17`/`2.0.18`，另 `@opentui/{core,solid}@0.5.12`），解压后 `diff -rq` 比对 dist。npm dist.shasum：plugin 2.0.16 `871a8078d8dae084eee7656f69e1219ec0d2cada`、2.0.17 `31052757b84fa2187d8ee214c5b1fbc936b98e98`、2.0.18 `db7d45d4e66b3a28f9ec3a99028983a713bfc246`（2.0.15 `c3ccf30f…` 见上一条目）；schema 2.0.16 `00ceab976c0f3eb58e2b097cbd09109d03671b98`、2.0.17 `dcb90722e66ea6398005a6138692c009c10c427d`、2.0.18 `373c190ef96ba8fe49fdeb047e1f59dd63e5234d`；client 2.0.16 `3107e63ea382e95647bb384276105cc585ac3a4e`、2.0.17 `885ef31d198f76cbf5b8b29a5eb8a273161a1d89`、2.0.18 `621dd36be9a03ce507d5d38a48b697b46310083a`。
- 影响分级：**零 breaking、零必需适配**。plugin 区间内仅 2.0.17 一处新增（TUI `ui.model` 域，本插件未消费）；schema 区间内仅 2.0.17 一处新增（`Shell.Info.signal`，本插件未消费）；client 2.0.16 一处构造器增强 + 2.0.17 新增 server 一次性配对 API（本插件对 client 仅类型消费 `SessionStatus`，未命中）；2.0.18 无任何类型面变化。

### 1. plugin：2.0.15→2.0.16 与 2.0.17→2.0.18 dist 逐字节全等；2.0.16→2.0.17 新增 TUI `ui.model` 域【新增；本插件未消费】

- `@opencode/plugin` 2.0.15→2.0.16 与 2.0.17→2.0.18 两段 `diff -rq dist` 逐字节全等（仅 `package.json` 版本号与 `@opencode/*` 依赖/peer 跟随 bump）。这是继 2.0.12→2.0.14、2.0.14→2.0.15 之后的**第三、第四个 plugin 零变化区间**；2.0.16→2.0.17 为区间内唯一 plugin 变动。
- 归属 commit `c35c211460 feat(tui): expose model variant selection to plugins (#51101)`，改动 `packages/plugin/src/tui/context.ts` 的 `UI` 接口新增 `model` 域：

```diff
 export interface UI {
   readonly tabs: { … }
+  readonly model: {
+    /** The prompt's selected model; variant is undefined for the model default. Reactive when read in a Solid computation. */
+    current(): { readonly providerID: string; readonly modelID: string; readonly variant?: string } | undefined
+    readonly variant: {
+      /** Variant IDs of the selected model. Reactive when read in a Solid computation. */
+      list(): readonly string[]
+      /** Selects a variant of the selected model, or the model default when undefined. Returns false when no model is selected or the variant is unavailable. */
+      set(variant: string | undefined): boolean
+    }
+  }
   readonly slot: (claim: SlotClaim) => () => void
 }
```

- 官方文档同步新增 “Model” 一节（`docs/content/build/plugins/cli.mdx`）：`ui.model.current()` / `variant.list()` 在 Solid computation 内响应式；`variant.set(undefined)` 回模型默认；示例将 `variant.cycle` 命令绑定到 `tab` 以替换内置 variant 循环。
- 对本插件影响：`src/tui.tsx` 消费 TUI `Context` 的 `data`/`location`/`ui.slot`/`theme`/`renderer` 等，未触及新增的 `ui.model`，**零命中**；这是可选的 TUI 侧栏能力，未来如需展示/切换 variant 可接入。

### 2. schema：`Shell.Info` 新增 optional `signal`【新增；本插件未消费】

- 归属 commit `e22c1622e0 fix(core): report shell commands killed by a signal (#51145)`。`schema/src/shell.ts` 的 `Shell.Info` 在 `pid?`/`exit?` 之后新增 `signal?: String`（`session-event.d.ts`、`event-manifest.d.ts` 内联副本同步，共 5 处 schema 定义 + 全部事件内联副本），语义为 shell 命令被信号终止时记录信号名（官方亦同步 `core/src/tool/plugin/shell.ts` 的插件工具 shell 记录）。
- 区间内 schema **无新增/删除事件、无事件联合变化、无 required 字段新增**；`Shell.Info` 的 `signal` 是唯一 schema 结构变化。
- 对本插件影响：本插件对 `@opencode/schema` 唯一 import 是 `Tool` 类型（`src/runtime/types.ts`，`@opencode/schema/tool`），`tool.d.ts` 区间内零变化；不消费 `Shell.Info`，**零命中**。

### 3. client：`ClientError` detail、server 一次性配对 API、shell signal【新增/行为；本插件仅类型消费 `SessionStatus`】

- **2.0.16 `a117ebb408 fix(client): include the detail in client error messages (#50929)`**：`promise/generated/client-error` 的 `ClientError` 构造器第二参由 `ErrorOptions` 放宽为 `ErrorOptions & { readonly detail?: string | null }`，并把 `detail`（或 `cause.message`）拼入 `super()` 的 message（`${reason}: ${detail}`）。这是 2.0.15→2.0.16 段内**唯一 client `.d.ts` 变化**；区间内其余 client dist 差异全为运行时 `.js` 与 chunk 重组（`service-*` → `service-timing-*`）。
- **2.0.17 `eccf0b3b7b feat(server): pair with one-time connect links (#50970)`**：client 三轨（`effect/api/api.d.ts`、`effect/generated/client.d.ts`、`promise/generated/{client,types}.d.ts`）新增 `ServerApi.pair()`/`connect(input)`——`pair() → { code, expires_in }`、`connect({ code }) → { token }`；promise 轨导出 `PairingCode`/`PairingSession` 类型与 `ServerPairOutput`/`ServerConnectInput`/`ServerConnectOutput` 别名。配套 `app` 用一次性链接替换密码配对（`2caba90a63 feat(app): replace password pairing with one-time links (#50972)`）。区间内 `SessionStatus` 声明逐字节未变。
- **2.0.17**：shell `signal` 同步进 client 事件类型（`ShellCreated`/`ShellExited`/`ShellDeleted` 的 `data.signal?: string`），与 schema 条目同源。
- **2.0.18**：client `.d.ts` 零变化，仅运行时 `.js` 与 chunk 重组（`service-timing-*` → `contract-*`）。
- 对本插件影响：本插件对 `@opencode/client` 仅类型消费 `SessionStatus`（`src/tui.tsx`），声明未变，**零命中**；不消费 client 运行时。

### 4. 包元数据：2.0.17 起 plugin peer `@opentui/* >=0.5.10 → >=0.5.12`【本插件 peerDeps 需评估】

- `@opencode/plugin` 2.0.16→2.0.17 的 `package.json` 将 `peerDependencies` 的 `@opentui/core`/`@opentui/solid` 由 `>=0.5.10` 提升到 `>=0.5.12`（devDependencies 同步 `0.5.12`），`@opencode/theme` 与 `@opencode/{ai,client,protocol,schema,util}` 依赖跟随 bump；对应宿主 `917d904f18 tui: update OpenTUI v0.5.12 (#50567)`。
- 对本插件影响：`package.json` 当前声明 `@opentui/solid >=0.5.10`（optional peer，devDep `^0.5.10`），若将插件锁定版本升至 2.0.17+，为消除独立安装场景 peer 告警应同步把 `@opentui/*` 基线抬到 `>=0.5.12`。当前维持 2.0.10 锁定时无需改动；编译实证已在 0.5.12 下通过。

### 5. GitHub commit 口径宿主行为项（core/cli/tui/app/ai/desktop 层）【行为级】

- **2.0.15 → 2.0.16（63 commits）**：codemode 运行时大修（`318a8c1aba` Object.freeze/seal/create/getPrototypeOf + structuredClone、`dc48655743` `==` 改 IsLooselyEqual、`14a3311a61` Uint8Array 回调与 indexOf 强制转换、`33b686feb9` 资源以 codemode 工具列出/读取）——仅影响 `codemode: true` 工具，本插件全部工具 `codemode: false`；core 侧 MCP Code Mode 默认值（`ff6b8c21e7`）、GitLab workflow 发现 + OAuth 登录（`f0aff6cfe8`）、read 长度/行数上限（`683d470fe4`）、带引号/重音变体的读取恢复（`b47824fb63`）、V1 会话迁移时提示重命名旧工具（`2c369a21c9`）、忽略空 subagent options（`757e565c23`）；ai 侧新增图片/转写/语音/视频生成路由（`56db9053e8`/`dbaa57a21b`/`f526727178`/`cc8886c8bb`）；app/desktop 侧 Console 设备码登录（`b7d707cd64`）与设置精简（`bee5014f89`）——插件 API 面无关。
- **2.0.16 → 2.0.17（73 commits）**：core 注册 Console 托管 MCP server（`6cd938e1e9`）、shell 被信号终止的记录（`e22c1622e0`，见条目 2/3）、工具名上限放宽至 128 字符（`03be7f385b`）、截断输出补行数（`8118690839`）、从普通 AI SDK stream error 读取 provider 错误（`e796f2f9a5`）；prompt 队列回退（`beeb14e910`）；app provider 账号切换（`684721efb8`）与一次性配对链接（`2caba90a63`）；tui OpenTUI 0.5.12（`917d904f18`）、transcript 详细度（`c1f50659a7`/`bbbac2507b`）、向插件暴露 model variant（`c35c211460`，见条目 1）；ai 侧大量 thinking-budget / media facade 修复。均不触及插件注册域与 hooks 契约。
- **2.0.17 → 2.0.18（4 commits / 52 files）**：`cd9a14a6b6 release: v2.0.18`、`00738c5b2d sync release versions for v2.0.17`、`041885d838 fix(core): decode legacy media in compaction checkpoints (#51409)`、`29ce49db0f refactor(util): share a browser opener across cli, tui, and core (#51412)`——仅 core/util 内部与发布同步，plugin/schema/client 源码路径无 commit，故 dist 零类型变化。

### 6. 宿主实测注记（opencode v2.0.18，2026-09-28）

- **隔离 serve API 级实测**：临时 XDG 目录 + 独立端口（41238，未触碰用户运行中的共享服务，用户服务 pid 4548 全程未受影响）+ `OPENCODE_PASSWORD` 固定密码起 `opencode serve`；`OPENCODE_CONFIG` 的 `plugin` 指向本仓库 **`dist` 目录**（含 `index.js` 入口，与 README 安装写法一致）。`/api/plugin` 返回 `opencode-oceanus`，`source: {type: "local", path: ".../dist/index.js"}`，`features: {server: true, tui: true}`，`state.status: "active"`；插件总数 89；`/api/agent` 14 个（oceanus 系 9 个全部注册：oceanus/sisyphus/prometheus + explorer/librarian/oracle/designer/fixer/observer，另有 5 内置）；`/api/skill` 12 个（本插件 10 个 + 宿主 OpenCode/Report）。serve 日志显示 setup 阶段 fail-open 正常：agent-browser 探测 `available: true`（version 0.26.0）、`auto_update` 走到决策、CBM mcp 注册 `registered: false`（隔离环境 CBM 未安装，fail-open，口径同既往条目）。首查 `/api/plugin` 返回 `data: []` 的惰性加载现象复现（与既往条目一致），数秒后二查即得完整状态。加载方式附注：单文件路径仍被拒（WARN `configured plugin path must be a directory`），不含 `index` 入口的目录（如仓库根）亦不加载——与既有口径一致，非新差异；另可用 `.opencode/plugin/*.js` 自动发现 re-export 入口（本次亦验证可加载，但该路径只出 `features: {server: true}`，TUI 入口需包式 `dist` 目录加载才有）。实测后已关闭隔离服务，端口 41238 已释放。
- **会话内实测**：本机宿主 `opencode --version` → `opencode v2.0.18`；当前 oceanus 会话（按 `@opencode/*@2.0.10` 构建的插件）运行于该宿主，shell/read/grep/glob 等工具调用正常。
- TUI 侧栏（`tui.js`）进程内渲染端到端仍未复测（口径同既往条目）。

### 7. 本插件验证结论

- **类型面零破坏**：plugin 逐字节全等（2.0.15→2.0.16、2.0.17→2.0.18）+ 2.0.16→2.0.17 仅新增 TUI `ui.model`（本插件 TUI 未消费）；schema 仅 `Shell.Info.signal`（本插件不消费 `Shell.Info`，唯一 import `Tool` 未变）；client 仅 `ClientError` 增强 / server 配对 API / shell signal，`SessionStatus` 未变。编译实证——全量 src（含 `tui.tsx`）在 `@opencode/{plugin,schema,client}@2.0.18` + `@opentui/{core,solid}@0.5.12` 下 `tsc --noEmit` 零错误（typescript 7.0.2）。
- **运行时零回归**：隔离 serve 注册面全绿（plugin active、14 agent、12 skill）+ 会话内实测（2.0.10 依赖构建的插件运行于 2.0.18 宿主）。
- 结论：**无需升级依赖即可运行于 2.0.18 宿主**（当前精确锁定 2.0.10 继续有效）。升级锁定至 2.0.18 为可选维护动作（收益与既往条目同构：消除独立安装场景 peer 版本告警；plugin 包自 2.0.12 起零变化使升级风险趋近于零）；若升级，需同时把 `@opentui/*` peer/devDep 基线抬至 `>=0.5.12`，并可选择性接入 TUI `ui.model`（variant 展示/切换）——均非必需。

### 8. negative_findings

- **区间内无新增/删除事件**：与 2.0.15 条目（新增 `session.metadata.updated`）不同，2.0.15→2.0.18 的 `event-manifest`/`session-event` 仅因 `Shell.Info.signal` 内联副本同步而变动，无事件联合成员变化；`V2Event` 联合成员数不变。
- 无 plugin 注册域、hooks、`Plugin.define`、`Plugin.Info`、promise/effect 双层契约变化；`tui/plugin.d.ts`、`schema/tool.d.ts` 逐字节未变。
- client/server 配对 API（`pair`/`connect`）为纯新增，未改变既有 `server.info`；`ClientError` message 拼接为行为修复（message 文本变化），不影响类型消费方。
- **未覆盖项（诚实口径）**：`@opencode/{protocol,ai,util,core}` 四包本次未做 tarball 全量 diff（本插件 src 不直接 import 这些包，仅 `@opencode/plugin` 传递依赖）；如需对传递依赖做完整性证明，应另行 diff。
- GitHub Release 正文未复查（v2 线既往一贯仅含 bare tags）；commit 序列以本地 clone `git fetch origin tag v2.0.{16,17,18}` 后 `git log <a>..<b>` / `git diff --stat` 获得，为可靠等价证据源（GitHub REST API 匿名限流既往 403）。
- npm 版本历史在 2.0.15 → 2.0.18 之间无中间 stable 版本（仅 `0.0.0-dev-*`）。
- client chunk 命名三段变化（`service-*` → `service-timing-*` → `contract-*`）为构建产物形态变化，未在 `.d.ts` 类型面产生对应差异，不对插件构成契约变化。
- 宿主 2.0.18 的本地插件加载仍遵循既有口径：`dist` 目录（含 `index.js` 入口）可加载并声明 `server+tui`；单文件路径与不含 `index` 入口的目录均不加载（见条目 6）。此为跨版本既有行为，非 2.0.15 → 2.0.18 引入的差异。

---

## 2.0.14 → 2.0.15

- 日期：2026-09-24（记录）；发布时间线：v2.0.14 tag 2026-09-22 13:13 UTC、v2.0.15 tag 2026-09-23 07:15 UTC（npm plugin/schema/cli 同步发布，2.0.15 为 latest）。本机宿主已升级 `opencode v2.0.15`（2026-09-24 确认）。
- 证据源类型：`@opencode/{plugin,schema,client}@2.0.14` / `2.0.15` tarball 的 dist 全量 diff（权威口径）+ GitHub `anomalyco/opencode` compare v2.0.14...v2.0.15（本地 clone `git fetch origin tag v2.0.15` 后 `git log`/`git diff`，边界 `0846214`（v2.0.14 tag）→ `6f3639d`（v2.0.15 tag）：42 commits、250 文件、+6782/−2549）+ 编译实证（全量 src 含 `tui.tsx` 置于 `@opencode/{plugin,schema,client}@2.0.15` 下 `tsc --noEmit` 零错误，typescript 7.0.2 与项目 `^7.0.0` 同基线）+ 隔离 serve 运行时实测（2026-09-24）。
- 可复现性：空目录 `npm pack @opencode/{plugin,schema,client}@2.0.14` 与 `@2.0.15`，解压后 `diff -rq` 比对 dist。npm dist.shasum：2.0.15 plugin `c3ccf30f28713479f6dc404ebc8a4d32da02a92b`、schema `5494f6e4d97e36659f5f88e021ab2f41e60a439b`、client `4007c9867986cd92bde55ce76699428de447ad10`（2.0.14 的 shasum 见上一条目）。
- 影响分级：**plugin dist 逐字节全等（零差异）**；schema 变化为「新增 durable 事件 + 给 `Project.Time` 增加 required 字段」——对事件构造方/Project.Time 构造方是 breaking，对只读消费方与本插件均无关；client 类型面同源同步 + 运行时 chunks 重组，`SessionStatus` 未变。

### 1. plugin：零差异【无】

`@opencode/plugin` 2.0.14 → 2.0.15 dist `diff -rq` 逐字节全等；唯一文件差异 `package.json`（`version` 2.0.14→2.0.15，`dependencies` 的 `@opencode/{ai,client,protocol,schema,util}` 与 `peerDependencies`/`devDependencies` 的 `@opencode/theme` 由 2.0.14 跟随 bump 到 2.0.15）。`Plugin.define`、全部注册域、session hooks、TUI context、promise/effect 双层契约在 2.0.14 → 2.0.15 完全不变。这是继 2.0.12 → 2.0.14 之后**第二个连续零变化的 plugin 区间**。

### 2. schema：新增 durable 事件 `session.metadata.updated` + session metadata 语义更新【新增；本插件未消费】

- `session-event.d.ts` 新增 `MetadataUpdated`（`type: "session.metadata.updated"`，`durability: "durable"`），`event-manifest.d.ts` 双侧（定义 + 联合）同步登记；载荷 `data: { sessionID: SessionID; metadata: Record<String, Json> }`，带 `durable: { aggregateID, seq, version }` 与 optional `location`（结构同其它 durable session 事件）。
- `session-metadata.d.ts` 的 `SessionMetadata` JSDoc 由 "durable **from creation** and opaque to core" 改为 "durable and opaque to core"，继承语义由 "Children and forks inherit the parent's metadata" 改为 "inherit the parent's **current** metadata"——session metadata 从「创建时固化」升级为「运行时可更新并广播变更」。
- 归属 commit `5c53cfc342 feat(session): allow metadata updates (#50025)`。
- 影响评估：新事件为纯新增，未订阅零影响；`SessionMetadata` 类型（`Record<String, Json>`）本身未变，仅语义/文档更新。本插件对 `@opencode/schema` 唯一 import 是 `Tool` 类型（`src/runtime/types.ts`，`@opencode/schema/tool`），`tool.d.ts` 本区间零变化。

### 3. schema：`Project.Time` 新增 required `active: Int`【breaking（对构造方）；本插件未消费】

- `project.d.ts` 的 `Time` struct（及 `Project.Info` 全部内联副本）在 `created`/`updated` 之外新增 required `readonly active: Schema.Int`；`event-manifest.d.ts` 内联副本同步。
- 归属 commit `53179daefa feat(core): order projects by recent activity (#50790)`——project 增至三段计时（created/updated/active），用于「按近期活动排序项目」。
- 影响评估：构造该 struct 的代码（宿主内部）必须提供 `active`；仅读取的消费方不受影响。本插件不消费 Project 面，零命中。

### 4. client：类型面同源同步 + 运行时 chunks 重组 + 行为修复【无关；本插件仅类型消费 `SessionStatus`】

- `promise/generated/types.d.ts` 与 `effect/{client,generated/client,api/api}.d.ts` 的变化全部同源：新增 `SessionMetadataUpdated` 事件类型、`V2Event`/`SessionEventDurable` 联合新增 `SessionMetadataUpdated`、project `time.active: number`、session metadata 相关字段。`SessionStatus`（本插件 `src/tui.tsx` 唯一消费的 client 类型）声明逐字节未变。
- 运行时层（`.js`）：`dist/chunks/` 中 `pty-handoff-*.js`（2.0.14 共 24 个）与 `service-*.js`（2.0.15 共 24 个）为 chunk **重命名/重组**（同名 hash 后缀可对位，如 `1tbj6z39`、`4tveyqeh` 两版共有）；`rpc-runtime`/`service-contender`/`service-timing`/`solid/*` 等内部实现更新——均为宿主内部实现，插件不做运行时 import。
- 行为修复：`d56ce74373 fix(client): throw declared API errors as Error instances (#50788)`（已声明 API 错误抛 Error 实例）、`10aa949f43 fix(client): preserve base URL path prefix in promise client (#50428)`（promise client 保留 base URL 路径前缀）——改善 client 消费方行为，本插件不消费 client 运行时。

### 5. GitHub commit 口径宿主行为项（core/cli/tui/app/ai 层）【行为级】

- **codemode 运行时**：`68b28bdb98 fix(codemode): coerce match/search patterns, allow any for...in target, bind the last duplicate parameter (#50802)`、`17abc5906b feat(codemode): add tagged templates and String.raw (#50791)`——仅影响 `codemode: true` 工具的 JS 运行时；本插件全部工具显式 `codemode: false`，不受影响（宿主 `execute` 运行时能力增强，利好 Code Mode 调用纪律）。
- **ai 包**：`60c78ed8ab feat(ai): add media foundation with Media assets and Image rewrite (#49181)`、`f2bdee6726 feat(ai): add gateway evaluation providers (#50665)`、`067a528b1d refactor(ai): rename evaluation action to run (#50529)`、`ddeb19790a fix(ai): replay Kimi reasoning details without the streaming index (#50383)`、`8656838a5b fix(ai): ignore bare null SSE frames (#50793)`——provider/media 面，插件不直接消费。
- **core**：`f0381e5da3 fix(core): normalize AI SDK fragment boundaries (#50685)`、`43f1dad8e1 fix(core): log error messages for MCP OAuth and credential failures (#50767)`、`3a2203eaac fix(core): install git plugins from branch subdirectories (#50754)`（git 插件支持从分支子目录安装）、`ad1a4a6539 fix(core): simplify shell output notices (#50676)`、`53179daefa`（见条目 3）、`5c53cfc342`（见条目 2）。
- **cli**：`8ce629be22 fix(cli): keep Windows upgrades and uninstalls from fighting the running binary (#50819)`、`740072694d fix: show API error messages in remaining CLI and TUI paths (#50783)`、`788f0affcb feat(cli): pair with direct server links (#49971)`——升级可靠性 + 错误可见性 + server 直连配对。
- **tui**：`2e4abeb25d`/`740072694d`（toast 展示 API 错误信息）、`cf4b4c2312 fix(tui): export complete session transcript (#50733)`、`fe0d1682ca fix(tui): show latest step in turn token summary (#50765)`、`3584eca0eb fix(tui): show canonical projects in open dialog (#50674)`、`cdccde7408 refactor(tui): derive bright terminal palette (#50433)`、`54fbf6d14d`、`18eeb3201d`——不触及插件 TUI sidebar API（plugin 包 dist 全等，`SlotClaim`/slot input 契约不变）。
- **theme**：`8683406690 feat(theme): support dynamic hue names (#50728)`——主题动态色相；plugin 包 peerDep `@opencode/theme` 跟随 bump，无 API 面变化。
- **app**：`3bf8a5a8cf fix(app): keep Console sign-in visible when a Zen API key is stored (#50763)`、`51d2b66760`、`ad756ef09b`/`94df7a812d`/`7af65eff37`（测试去 flaky）——desktop/app 面，无关。
- 其余为 `chore`/`docs`/`test`/nix hash 与 www Console 文档同步，不触及插件 API 面。

### 6. 宿主实测注记（opencode v2.0.15，2026-09-24）

- **隔离 serve API 级实测**：临时 XDG 目录 + `OPENCODE_CONFIG` 指向本仓库 `dist` + 独立端口（41234，未触碰用户运行中的共享服务）+ `OPENCODE_PASSWORD` 固定密码起 `opencode serve`。`/api/plugin` 返回 `opencode-oceanus`，`source: {type: "local", path: ".../dist/index.js"}`，`features: {server: true, tui: true}`，`state.status: "active"`；插件总数 87（86 builtin + 本插件）。`/api/agent` 14 个（oceanus 系 9 个全部注册：oceanus/sisyphus/prometheus + explorer/librarian/oracle/designer/fixer/observer，另有 5 内置）；`/api/skill` 12 个（本插件 10 个 + 宿主 OpenCode/Report）。serve 日志显示 setup 阶段 fail-open 正常：agent-browser 探测 `available: true`（source path，version 0.26.0）、`auto_update` 决策 `skipped/no_entry`、CBM mcp 注册 `registered: false`（隔离环境 CBM 未安装，fail-open，口径同既往条目）。首查 `/api/plugin` 返回 `data: []` 的惰性加载现象复现（与 2.0.3/2.0.14 条目一致），数秒后二查即得完整状态。实测后已关闭隔离服务，端口释放、用户服务未受影响。
- **会话内实测**：本机宿主 `opencode --version` → `opencode v2.0.15`；当前 oceanus 会话（按 `@opencode/*@2.0.10` 构建的插件）运行于该宿主，shell/read/grep/glob 等工具调用正常。
- TUI 侧栏（`tui.js`）进程内渲染端到端仍未复测（serve 实测覆盖注册面与 `features.tui` 声明，与既往口径一致）。

### 7. 本插件验证结论

- **类型面零破坏**：plugin dist 全等 + schema 两处变化（新事件 `session.metadata.updated`、`Project.Time.active`）均不命中本插件消费面（`@opencode/schema/tool` 的 `Tool` 未变）+ client `SessionStatus` 未变；编译实证——全量 src（含 `tui.tsx`）在 `@opencode/{plugin,schema,client}@2.0.15` 下 `tsc --noEmit` 零错误。
- **运行时零回归**：隔离 serve 注册面全绿（plugin active、14 agent、12 skill）+ 会话内实测（2.0.10 依赖构建的插件运行于 2.0.15 宿主）。
- 结论：**无需升级依赖即可运行于 2.0.15 宿主**（当前精确锁定 2.0.10 继续有效）；升级锁定至 2.0.15 为可选维护动作（收益与既往条目同构：消除独立安装场景 peer 版本告警；plugin 包自 2.0.12 起零变化使升级风险趋近于零）。

### 8. negative_findings

- GitHub Release 正文未复查（v2 线既往一贯仅含标题）；本次 commit 序列以本地 clone `git fetch origin tag v2.0.15` 后 `git log v2.0.14..v2.0.15` / `git diff --stat` 获得（42 commits / 250 files / +6782 −2549），为可靠等价证据源（GitHub REST API 匿名限流既往 403）。
- 无 plugin/schema 包导出结构、注册域、hooks 契约的任何变化；`session.metadata.updated` 是区间内唯一新增事件，`Project.Time.active` 是唯一 required 字段新增，且均非本插件消费面。
- npm 版本历史在 2.0.14 → 2.0.15 之间无中间 stable 版本（仅 `0.0.0-dev-*`）。
- client 的 `pty-handoff-*` → `service-*` chunk 重组为构建产物形态变化，未在 `.d.ts` 类型面产生对应差异，不对插件构成契约变化。

---

## 2.0.12 → 2.0.14

- 日期：2026-09-23（记录）；发布时间线：v2.0.13 tag 2026-09-22 10:07 UTC、v2.0.14 tag 2026-09-22 13:13 UTC（npm plugin/schema/cli 同步发布，2.0.14 为 latest）。本机宿主已升级 `opencode v2.0.14`（2026-09-23 确认）。
- 证据源类型：`@opencode/{plugin,schema,client}@2.0.12` / `2.0.13` / `2.0.14` tarball 的 dist 全量 diff（权威口径）+ GitHub `anomalyco/opencode` compare v2.0.12...v2.0.14（47 commits、364 文件、边界 `2670273`→`0846214`；API 匿名限流，commit 序列经本地 clone fetch tags 获得，与 compare 页计数一致）+ 编译实证（全量 src 置于 `@opencode/{plugin,schema,client}@2.0.14` 下 `tsc --noEmit` 零错误，typescript 7.0.2 与项目 `^7.0.0` 同基线）+ 隔离 serve 运行时实测（2026-09-23）。
- 可复现性：空目录 `npm pack @opencode/plugin@2.0.12 @opencode/plugin@2.0.13 @opencode/plugin@2.0.14`（schema/client 同理），解压后 `diff -rq` 两两比对 dist。npm dist.shasum：2.0.13 plugin `01cfa9ded2ab2628f8583de644cd6fd6526e4e3b`、schema `4abbccbd44a8720c8d2e3cfd00c02a0f7ffd735a`；2.0.14 plugin `6891a4425abbb58e6568becbd9310b649e72a6c6`、schema `1987d10fed11810848a0dde173a963c94b1c05dd`、client `509008d9627ac4f030b529b6c7aed68c24c467eb`（2.0.12 的 shasum 见上一条目）。
- 影响分级：**plugin 三版 dist 全等（零差异）**；schema/client 唯一类型变化 `Connection.CredentialInfo.method` 为新增 required 字段——对**构造**该对象的消费方是 breaking，对本插件无关（消费面不触及 Connection/Integration/Credential）。

### 1. plugin：零差异【无】

`@opencode/plugin` 2.0.12 → 2.0.13 → 2.0.14 dist `diff -rq` 逐字节全等（区间内 `packages/plugin` 目录仅 release/sync 版本号 commit）。这是 beta → GA 以来首个 plugin 包零变化的双版本区间：`Plugin.define`、全部注册域、session hooks、TUI context、promise/effect 双层契约在 2.0.12 → 2.0.14 完全不变。

### 2. schema：`Connection.CredentialInfo` 新增 required `method`【breaking（对消费方）；2.0.13；本插件未消费】

- `connection.d.ts` 的 `CredentialInfo`（及 `ConnectionInfo` 联合内联副本）新增 `readonly method: Schema.Literals<readonly ["key", "oauth"]>`（JSDoc："How the credential was obtained: a stored key or an OAuth grant."）；`integration.d.ts` 第 1571 行附近的内联 credential struct 同步；`connection.js` 运行时 schema 一致。归属 commit `fbacf6a126` `feat(app): sign in to OpenCode Go and Console through the browser (#50267)`（浏览器 OAuth 登录功能，配套 `19e1357a06` fix(core) 取消 MCP OAuth 登录的强制 consent prompt）。
- 影响评估：构造 `CredentialInfo` 的代码必须提供 `method`；仅读取的消费方不受影响。本插件对 `@opencode/schema` 的唯一 import 是 `Tool` 类型（`src/runtime/types.ts`），零命中。
- 2.0.13 → 2.0.14 schema dist 全等。

### 3. client：类型面同源单点变化 + 运行时 chunks 重组【无关；本插件仅类型消费 `SessionStatus`】

- `promise/generated/types.d.ts` 唯一变化 = 同源 `ConnectionCredentialInfo.method: "key" | "oauth"`；`SessionStatus`（本插件 `src/tui.tsx` 唯一消费的 client 类型）声明未变；`solid/data.d.ts` 全等。
- 运行时层（`.js`）：新增 `pty-handoff-*` chunks、`service-contender` 结构调整、`solid/*` 与 rpc/service 更新——均为宿主内部实现，插件不做运行时 import。

### 4. GitHub commit 口径宿主行为项（core/cli/tui/app 层）【行为级】

- **#49729 `feat(core): enforce Console-managed policies`（2.0.13）**：新增 `managed-policy.ts` 与 `config/plugin/policy.ts` 扩展，官方新增 `policies.mdx`（216 行）与 `permissions.mdx` 增补——组织级 Console 托管策略作为叠加层参与权限/请求评估。对本插件：不改变本地 evaluate 语义（`Wildcard.match` + findLast），无代码影响；若用户环境启用 Console policies，权限面只会更收紧（fail-closed 方向）。文档引用权限语义时注意存在该叠加层。
- `94b9133910 fix(core): share child prompt cache affinity（#50495）`：subagent（child session）prompt cache 亲和共享——对 oceanus 的 subagent 派发是性能利好。
- `60673aaef3 fix(core): run session HTTP hooks on the AI SDK route（#50487）`：session HTTP hooks 修复；本插件不经 HTTP hooks（全部经 `ctx.*` 域），无关。
- codemode 运行时大修（11 commits：#50191 程序值类型化、#50389 `Promise.withResolvers`、#50410 Iterator helpers、#50419 `Promise.try`、#50435 签名渲染、#50438 `tools.` 前缀命名空间搜索、#50450 live Map/Set、#50455 unknown-tool 就近命名、#50479/#50489/#50492 参数语义）：仅影响 `codemode: true` 工具的 JS 运行时；本插件全部工具显式 `codemode: false` 不受影响；宿主 `execute` 运行时（主 agent 可用）能力增强 + #50384/#50417 工具目录描述更明确（catalog tools/search 仅 execute 内可用、search 同步），利好 Code Mode 调用纪律。
- CLI `2f2c861af0 fix(cli): show actionable upgrade errors（#50346）`：升级错误提示改善。
- TUI 项（#50456 automatic tabs mode、#50475 sidebar onboarding 恢复、#50447 MCP sidebar state 持久化、#50442 renderer listener budget 15、#50412 dark theme base、#50524 清理 active session tab、#50612 worktree 不入项目列表（2.0.14））：不触及插件 TUI sidebar API（`SlotClaim`/slot input 契约不变）。
- 其余为 desktop/app/console/docs 项（#49291 设备配对、#49750 `/btw` 面板、#50267 登录、#50506 评估 API、#50582/#50599/#50327 等），不触及插件 API 面。
- 2.0.14 区间本身仅 4 个实质 commit（models.dev 快照刷新、#50612、#50599、#50582 docs）——plugin/schema 包自 2.0.13 起零变化，2.0.14 是宿主侧小补丁版。

### 5. 宿主实测注记（opencode v2.0.14，2026-09-23）

- **隔离 serve API 级实测（本条目新增证据形态，补上 2.0.12 条目遗留的缺口）**：临时 XDG 目录 + `OPENCODE_PASSWORD` 固定密码起 `opencode serve`（独立端口，未触碰用户共享服务），`/api/plugin` 返回 `opencode-oceanus: active`（`source: local dist/index.js`，`features: {server: true, tui: true}`）；`/api/agent` 15 个，oceanus 系 9 个全部注册（prometheus `mode: primary`）；`/api/skill` 13 个（11 个 Oceanus skills + 宿主 OpenCode/Report）；serve 日志显示 setup 阶段 fail-open 路径正常（agent-browser 探测 available、auto_update 决策、CBM daemon 预热；隔离 XDG 下 CBM daemon accept 探测自愈失败属临时目录生命周期问题，与注册契约无关，口径同 2.0.9 条目）。首查 `/api/plugin` 返回 `data: []` 的惰性加载现象复现（与 2.0.3 条目记录一致），二次查询即得完整状态。
- **serve API 认证事实（新发现，供后续实测复用）**：`opencode serve` HTTP API 认证为 HTTP Basic，用户名硬编码 `opencode`（`packages/server/src/auth.ts` `Config.configLayer` 固定 `username: "opencode"`）、密码取 `OPENCODE_PASSWORD` 环境变量（legacy `OPENCODE_SERVER_PASSWORD`；未设则前台模式随机生成并打印 `server password <pw>` 到 stdout）；亦支持 query `?auth_token=<base64(user:pass)>`（浏览器 WebSocket 场景）。401 响应带 `www-authenticate: Basic realm="Secure Area"`。
- **会话内实测**：本机宿主 `opencode --version` → `opencode v2.0.14`；当前 oceanus 会话（按 `@opencode/*@2.0.10` 构建的插件）运行于该宿主，shell/read/grep/glob/webfetch 工具调用正常。
- TUI 侧栏（`tui.js`）进程内渲染端到端仍未复测（serve 实测覆盖注册面与 `features.tui` 声明，与既往口径一致）。

### 6. 本插件验证结论

- **类型面零破坏**：plugin dist 全等 + schema/client 变化均不命中本插件消费面；编译实证——全量 src（含 `tui.tsx`）在 `@opencode/{plugin,schema,client}@2.0.14` 下 `tsc --noEmit` 零错误。
- **运行时零回归**：隔离 serve 注册面全绿 + 会话内实测（2.0.10 依赖构建的插件运行于 2.0.14 宿主）。
- 结论：**无需升级依赖即可运行于 2.0.14 宿主**（当前精确锁定 2.0.10 继续有效）；升级锁定至 2.0.14 为可选维护动作（收益与 2.0.7 条目同构：消除独立安装场景 peer 版本告警、取得 `ToolContext.signal` 类型基线；plugin 包自 2.0.12 起零变化使升级风险趋近于零）。

### 7. negative_findings

- GitHub Release 正文未复查（v2 线既往一贯仅含标题，见上一条目 negative_findings）；GitHub REST API 匿名访问限流（403），本次 commit 序列以本地 clone `git fetch origin tag v2.0.x` 后 `git log v2.0.12..v2.0.14` 获得，与 compare 页 totals（47 commits / 364 files）一致，为可靠等价证据源。
- 无 plugin/schema 包导出结构、注册域、hooks 契约的任何变化；`Connection.CredentialInfo.method` 是区间内唯一 required 字段新增，且仅影响该 schema 的构造方。
- npm 版本历史在 2.0.12 → 2.0.14 之间无中间 stable 版本（仅 `0.0.0-dev-*`）。

---

## 2.0.10 → 2.0.12

- 日期：2026-09-22（记录）；发布时间线：v2.0.11 tag 2026-09-20、v2.0.12 tag 2026-09-21 UTC，npm plugin/schema/cli 同步发布（2.0.12 为 latest）。两版之间无 2.0.11-x 等中间 stable 版本（npm 版本历史仅 `0.0.0-dev-*`）。
- 证据源类型：`@opencode/{plugin,schema}@2.0.10` / `2.0.11` / `2.0.12` 三方 tarball 的 dist 全量 diff（权威口径）+ GitHub `anomalyco/opencode` commits/PR diff（v2.0.11 边界 `cb6d95b`→`9eb6902`、v2.0.12 边界 `991b727`→`2670273`，librarian 经 tag commits 页双向交叉）+ 宿主 `opencode v2.0.12` 会话内实测（2026-09-22）。GitHub Release 正文仅含 release 标题（v2 线一贯无 release notes，见 negative_findings）。
- 可复现性：空目录 `npm pack @opencode/plugin@2.0.10 @opencode/plugin@2.0.11 @opencode/plugin@2.0.12`（schema 同理），解压后 `diff -rq` 两两比对 dist。npm dist.shasum：2.0.11 plugin `b4daff73be2dc3099a94929164ae4d29cbfe36fb`、schema `bd668831d3171da3c4fe1bc38b8cf584ffffc24b`；2.0.12 plugin `fa4b6393f7f1115b5144ad01533d33ab0c9e5175`、schema `eb0a5cbaa1d99ba83d8069a2150efc28f3352891`（2.0.10 的 shasum 见上一条目）。
- 影响分级：plugin 变更均为新增 optional 字段、接收方新增字段与行为修复，**零 breaking**（对本插件消费面无适配项）。

### 1. plugin：`ToastOptions.sessionID`【新增 optional；2.0.11；本插件未消费】

`tui/context.d.ts` 的 `ToastOptions` 新增 `readonly sessionID?: string`（JSDoc："When this session's family is not open, the title defaults to the session title and the toast offers to open it."）——toast 可关联会话；该会话 family 未打开时标题回退为会话标题并提供打开入口。本插件 `src/tui.tsx` 不消费 Toast API，无影响。

**方法论注记**：GitHub commits path 过滤（`commits/v2.0.11/packages/plugin`）会漏掉此类变更——预调研的 path 过滤历史曾显示 2.0.10→2.0.11 plugin 包"仅版本号 bump"，tarball diff 推翻了该结论。本台账"以 tarball 类型声明为权威证据源"的甄别原则再次生效：**升级评估必须做 tarball diff，不能只看 commit 标题或 path 过滤历史**。

### 2. plugin：`ToolContext.signal: AbortSignal` + Promise 工具取消转发【新增（能力）+ 行为修复；2.0.12；本插件可选受益】

- `promise/tool.d.ts` 的 `ToolContext` 新增 `readonly signal: AbortSignal`（required 字段，但插件工具的 `execute(input, context)` 是该对象的**接收方**，结构类型下零编译影响）。effect 层无对应变化（Effect fiber 原生具备 interruption，signal 桥接是 promise adapter 的职责）。
- `promise/adapter.js` 实现层（官方 PR #50190 `fix(plugin): forward Promise tool cancellation`，+74 −6）：`executePromiseTool` 从 `Effect.promise(() => …)` 改为 `Effect.promise((signal) => …)`，中断 signal 真正传入 Promise 工具执行器；`progress(update)` 调用同样携带 `{ signal }` 可被取消（官方新增测试断言"中断 fiber 后 `signal.aborted === true`"）。官方文档新增说明："Promise tool executors receive `tool.signal`. Pass it to cancellable work such as `fetch` so stopping the Session also stops the underlying operation."（官方文档措辞已随 #50195 改为 `context.signal`）。
- 对本插件影响：现有工具（ast_grep 系列、cbm 系列）不监听 signal 时行为与 2.0.10 一致（不响应取消，非强制适配项）；长任务工具可**选择性接入** `context.signal` 实现协作取消（fetch/子进程终止），属新能力。若工具有高频 `progress` 调用的长循环，升级后中断时的错误抛出路径可能与 2.0.10 略有不同，升级验证时建议跑一次工具中断场景。

### 3. plugin：adapter 内部重命名（官方 #50195 `refactor(plugin): name tool execution context`）【无形状变化】

`promise/adapter.js` 内部变量 `context`（Effect scope）→ `runtime`；工具执行器第二参数文档命名 `tool` → `context`（`tool.signal` → `context.signal`、`tool.progress` → `context.progress`）。tarball 实证仅实现层重命名与 JSDoc 措辞，`.d.ts` 类型形状零变化（除条目 2 的 signal 字段），位置传参不受影响，非 breaking。

### 4. schema：零差异

`@opencode/schema` 2.0.10 → 2.0.12 dist `diff -rq` 全等（两版相对 2.0.10 均仅 package.json 版本号变化）。

### 5. GitHub commit 口径宿主行为项（core/cli/tui/app 层，不在 plugin/schema 包内）【行为级】

- **#50015 `fix(core): honor session permissions in skill and MCP discovery`（2.0.11，permissions 语义）**：skill 可见性与 MCP server instructions 发现改用 `Permission.merge(agent.info.permissions, session.permissions ?? [])`（此前仅用 agent permissions），源码注释 "Session permissions narrow discovery the same way they narrow the tool snapshot."——会话级权限现在与工具快照同口径收窄**发现面**。对本插件的只读 subagent 与 prometheus deny 表是收紧方向的语义利好，无需改动；引用宿主权限语义的文档若存在"session permissions 仅影响工具快照"类旧表述需按此更新。
- codemode 运行时内置扩展：`Headers`（#49280）、`toLocaleString`/`Error.isError`/`Map.getOrInsert`（#50098）、`keys/values/entries` 返回 live iterators（#50061）、失败定位到提交源码（#50197）、搜索单词整匹配优先（#50275）——仅影响 `codemode: true` 工具的 JS 运行时；本插件全部工具显式注入 `codemode: false`，不受影响。
- 传输与稳定性：#50031 websocket 流反复丢失后会话降级 http、#50026 移除 bounded websocket inbound queues、#49402 Responses error frames 解码不再失败、#50182 anthropic budget variants、#50240 cli fatal startup 原因输出到 stderr——改善插件依赖的 server client/事件流可靠性。
- 其余为 app/desktop/tui UI 项（#50284、#49882、#50265、#50273、#50181 及 TUI 样式等），不触及插件 API 面。

### 6. 宿主实测注记（opencode v2.0.12，2026-09-22，真实工作会话）

本机宿主 `opencode --version` → `opencode v2.0.12`。当前 oceanus 会话即运行时证据：本插件（按 `@opencode/{plugin,schema}@2.0.10` 构建）在 2.0.12 宿主上 active——oceanus agent 会话正常、subagent 派发（librarian 外部调研）正常返回、shell/read/grep 等工具调用正常。证据形态为会话内实测（非隔离 serve API 复测，未覆盖 `/api/plugin` 状态断言）；TUI 侧栏渲染与图片 hook 端到端仍属未复测项。

### 7. 本插件验证结论

- **类型面零破坏**：plugin 两处变更（`ToastOptions.sessionID` optional、`ToolContext.signal` 接收方字段）与 schema 零变更均不命中本插件消费面；`Plugin.define`、全部注册域（agent/skill/tool/mcp/command 等）、session hooks、TUI context 其余契约在 2.0.10 → 2.0.12 逐字节一致。
- **运行时零回归**：见上节会话内实测（2.0.10 依赖构建的插件运行于 2.0.12 宿主）。
- 结论：**无需升级依赖即可运行于 2.0.12 宿主**（当前精确锁定 2.0.10 继续有效）。是否将锁定提到 2.0.12 属可选维护动作（消除独立 npm 安装场景下与宿主内嵌 `@opencode/theme` 版本告警的对齐收益与 2.0.7 条目同构）；若升级，`ToolContext.signal` 为长任务工具（ast_grep_replace、CBM 索引/查询）提供协作取消接入点，可一并评估。

### 8. negative_findings

- v2.0.11 / v2.0.12 GitHub Release 正文为空（仅 release 标题）；`packages/{opencode,plugin}/CHANGELOG.md` 均 404；官方文档站无 v2 changelog 页（`opencode.ai/docs/build/plugins` 404，v2 文档在 `opencode.ai/v2/docs`，且 `/docs` 仍为 v1 内容——引用时勿混轨）。commit 级唯一官方载体仍是 GitHub tags compare。
- npm 无 2.0.10 → 2.0.12 之间的 stable patch 版本（版本历史仅 `0.0.0-dev-*` 开发版；dev 线已出现 `@opencode/ai`、`@opencode/protocol`、`effect 4.0.0-rc` 等新依赖结构，预示 plugin 包未来可能有较大重构，本条目结论仅锚定 2.0.12 stable，不外推 dev 线）。
- 无 breaking changes：区间内 plugin/schema 包 diff 均为新增/修复/纯重命名，未发现任何签名、类型形状或包导出结构的破坏性变化。

---

## 2.0.7 → 2.0.10

- 日期：2026-09-20（记录）；发布时间线：v2.0.8、v2.0.9、v2.0.10 tags 均发布于 2026-09-18 至 2026-09-19 UTC。
- 证据源类型：`@opencode/{plugin,schema,client}@2.0.7` 与 `2.0.10` tarball 的 dist 全量 diff（重点逐文件 `.d.ts` diff）+ GitHub `anomalyco/opencode` compare v2.0.7...v2.0.10（81 commits、359 个文件变更）。GitHub Release 正文仅含 release 标题，未提供版本级迁移说明。
- 可复现性：在空目录执行 `npm pack @opencode/{plugin,schema,client}@2.0.7 @opencode/{plugin,schema,client}@2.0.10`，分别解压后运行 `diff -rq old/<pkg>/dist new/<pkg>/dist` 与关键 `diff -u`。npm registry `dist.shasum`：2.0.7 plugin `b806d35554095d96db387fe5b001ec42b923c51e`、schema `807ef0b7fa1c7de0b65e49afe5e4f9e45f116506`、client `58b73ef1daa4e91a7e3dee6fb611ea7b9889ef85`；2.0.10 plugin `71fb47d0c9164d64605ff949e82d6fae42a99fc6`、schema `5a131d72e3e573c2b5de029de0767a7f672ecdf7`、client `bdec6427b00727fcad77f2dd2698b5091220f390`。
- 影响分级：provider/model 配置为 breaking；工具 API 为新增；Oceanus 当前消费面无代码适配项。

### 1. plugin：`ToolEditor.list()`【新增；本插件未消费】

`promise/tool.d.ts` 与 `effect/tool.d.ts` 为 `ToolEditor` 新增 `list()`：返回每次 transform 后按有效名称索引的只读工具信息（含 `id`）。既有 `transform`/`reload`/draft API 未变；Oceanus 的 `src/tools/` 只注册工具、不读取宿主已注册工具，故无需调整。

### 2. schema：provider/model/agent 请求设置收敛【breaking；本插件未消费】

- `Provider.Compaction` 从 `{ mode: "local" } | { mode: "provider"; threshold? }` 改为 `{ type: "summary" } | { type: "native" }`。
- provider、model 与 agent 的 `timeout`、`chunkTimeout`、`compaction`、`transport` 迁入 `settings`；provider/model 顶层 `compaction` 与 `transport` 被移除。`settings` 仍保留扩展 record，因此自定义 provider 设置可继续存在。
- config provider/model 的 `settings` 同步具名化：provider 允许上述四项，model/variant 允许 `compaction`。

Oceanus 没有生成或读取 provider/model 配置。`src/index.ts` 只向 agent `request.settings` 写入 `temperature` 与用户定义 options；新 schema 的 settings 保留扩展 record，编译可验证该用法。因此无需迁移 Oceanus 配置或运行时逻辑；使用旧 provider/model 顶层字段的**用户 OpenCode 配置**必须迁至 `settings`。

### 3. client：类型与运行时辅助变化【无关；本插件未消费】

- promise client 的 provider/model 配置类型随 schema 同步；`experimental.policies[].action` 保持并包含 `"permission"`。
- `EnsureTiming` 移除 `attempts`，shell status 联合成员仅重排，新增 bundle chunks 与若干内部 RPC/服务实现调整。
- `SessionStatus` 未发生声明变化；Oceanus TUI 的 `SessionStatus` 类型消费不受影响。

### 4. 本插件验证结论

- 依赖升级：`package.json` 与 `bun.lock` 将 `@opencode/{plugin,schema}` 精确锁定到 `2.0.10`，同时消除与 2.0.10 Host 内置 theme 的独立安装 peer 版本告警。
- 代码适配：未发现 `Plugin`、Context、Agent/Skill/MCP 注册域、session hooks、TUI context 或 `Tool` 执行契约的破坏性类型变化；不为未使用的 `ToolEditor.list()` 或 provider settings 重构引入代码。
- 验证边界：本次只能以 tarball 类型 diff 和本仓库的类型/单元/构建验证为证据；必须在真实 `@opencode/cli@2.0.10` Host 复测插件 active 加载、agent/skill/tool/hook 注册及 TUI sidebar，才能声明运行时兼容。

### 5. negative_findings

- v2.0.8、v2.0.9、v2.0.10 GitHub Release 页面没有 API 变更或迁移说明；npm package metadata 也未提供变更说明。
- plugin package manifest 的公开导出入口（`.`, `./effect`, `./host`, `./tui`, `./*`）未删除或重命名。

---

## 2.0.5 → 2.0.6

- 日期：2026-09-18（记录）；发布时间线：v2.0.6 tag 2026-09-17 11:17 UTC，npm cli/plugin/schema 同步发布
- 证据源类型：`@opencode/{plugin,schema}@2.0.5` 与 `2.0.6` tarball dist 全量 diff（`diff -rq` 定位 + 逐文件 `diff -u`）+ GitHub `anomalyco/opencode` compare v2.0.5...v2.0.6（36 commits，官方 commit 序列）+ npm registry metadata；无官方 release notes（negative_findings 见条目末）
- 影响分级：全部为新增面，无 breaking（对本插件消费面）

### 1. plugin：`SessionHooks` 新增 `experimental.ws.send` / `experimental.ws.receive`【新增；本插件未消费】

`promise|effect/session.d.ts` 双层同步（官方 commit 9073c52 `feat(plugin): add experimental WebSocket send and receive hooks`，core 侧 `transport.bind` 回调从单函数改为 `{ handshake, send, receive }` 对象——仅影响直接消费 websocket transport bind 接口的代码）：

- `SessionWebSocketSend`：出站帧 hook——provider driver 构建帧之后、写入 socket 之前触发；替换 `frame: string` 后改写帧原样发送；driver 仍从 provider 回复跟踪状态，改写协议语义的责任在插件。
- `SessionWebSocketReceive`：入站帧 hook——socket 读到帧之后、driver 观察之前触发；替换 `frame` 后原样交给 driver。
- 两者载荷：`{ sessionID, agent, model, kind: SessionRequestKind, frame }`（`kind: "primary"|"compaction"|"title"|"generate"` 判别与 http hooks 一致）；JSDoc 均标注 Experimental。
- 官方 V2 文档语义补充：WebSocket 路由每会话一条连接复用，`http.request`/`http.response` 看不到 WS 流量；`experimental.ws.handshake`（2.0.5 引入）负责连接选择前的 url/headers 改写；HTTP hooks 对 WS 路由的 fallback 请求仍然生效。
- 对插件影响：纯新增 hook，未注册零影响。

### 2. schema：新事件 `location.shutdown`【新增；本插件未消费】

新文件 `location-event.d.ts`（`LocationEvent.Shutdown` + `Definitions`），`event-manifest.d.ts` 同步登记（官方 location 热重载机制引入：`feat(tui): reload all locations` 7390832、`fix(client): preserve state during location reload` b81be46；2.0.7 补全 CLI 面 `reload` 命令）：

- `type: "location.shutdown"`，durability `ephemeral`，`data: {}`；注释："The location's cached services were shut down; clients must revalidate its reads."（location 的缓存服务已关闭，客户端必须重新验证其读取）。
- 多 location 宿主/TUI 消费方收到该事件后应使对应 location 的缓存读失效。

### 3. schema：`FileSystem.Write` 新增【新增；本插件未消费】

`filesystem.d.ts` 新增 `Write: { path: AbsolutePath }`——为 HTTP API 文件写入端点预留（官方 commit 1685e70 `feat(server): add fs.write endpoint`；`@opencode/client@2.0.7` 落地为 `file.write()` 方法，见下一条目）。plugin context 域无对应新增。

### 4. 官方 commit 口径行为项（tarball 类型面无对应物）【行为级】

- `feat(cli): support inline config content`（49399）：配置加载新增内联内容方式。
- `fix(core): skip session warming for subagents`（49387）：**subagent 不再触发 session warming**——影响 subagent 冷启动行为；本插件 9 agent 委派路径建议升级宿主后观察冷启动表现。
- `fix(core): serialize MCP endpoint startup`（f28d1b4）：MCP endpoint 启动串行化。
- `fix: honor provider transport overrides and preserve errors`（49350）：provider transport 覆盖语义修复（衔接 2.0.5 `websocket` → `transport` 迁移）。
- provider 错误处理细化：重试窗口约 84s、间隔上限 10s（49441）；gateway 限额归类 quota、4xx 不再重试（49195）；恢复的 shell 通知不再唤醒空闲会话（49378 两笔）。
- `feat(server): expose server info endpoint`（ab3566a）：server info 端点（client 面在 2.0.7 落地为 `server.status` → `server.info`，见下一条目）。
- `feat(codemode): carry cause and own data across the error boundary`（49390）：codemode 工具执行错误信息保真度提升——本插件 `codemode: false` 注入策略不受影响。
- TUI/桌面 UI 项 10+ 笔（模型选择、MCP sign-in 提示、subagent model 展示、themes 等）。

---

## 2.0.6 → 2.0.7

- 日期：2026-09-18（记录）；发布时间线：v2.0.7 tag 2026-09-17 19:29 UTC
- 证据源类型：plugin/schema/client tarball dist 全量 diff + GitHub compare v2.0.6...v2.0.7（20 commits）+ 宿主 `@opencode/cli@2.0.7` 隔离 serve 实测（2026-09-18，本仓库 dist 加载验证）
- 影响分级：见逐条标注

### 0. plugin 包两版 dist 完全一致【零类型面变化】

`diff -rq` 证明 `@opencode/plugin@2.0.6` 与 `2.0.7` 仅 package.json 版本号与 peerDeps `@opencode/theme` 跟随差异；全部类型面变化落在 schema（与 client）。

### 1. schema：`experimental.policies[].action` 扩展为 `"provider.use" | "permission"`【类型放宽 + 行为新增】

`config/experimental.d.ts` 与 `config/policy.d.ts`（`Policy.Info.action`）的 policies action 从 `Literal<"provider.use">` 扩为 `Literals<["provider.use", "permission"]>`（官方 commit fa126d6 `feat(core): enforce permission policies`——本区间最重要行为变更，经 commit patch 核实）：

- policy 强制点新增：action 为 `"permission"`、resource 按 `action:resource` wildcard 匹配且 effect=deny 的 policy 会将 permission 事件强制置 deny（message `"Blocked by configuration policy"`）。
- provider 移除过滤现要求 `policy.action === "provider.use"`。
- 未使用 experimental policies 的部署零影响（标准 `permission` 权限表评估不变）。本插件 prometheus 的 agent 级 `permissions` 声明不受影响；若用户配置 experimental policies 可获得新的强制 deny 点。

### 2. schema：字段级 `hidden?: boolean` 广泛新增【新增（全部 optional）】

`form.d.ts`（+45 处）、`integration.d.ts`（+60 处）、`event-manifest.d.ts`（对应登记 +20 处），合计约 125 处的字段定义（title/description/required/when 同级）新增 optional `hidden: boolean`——表单/策略/集成字段可对用户隐藏（配合 `when` 条件实现条件可见性）。注：`config/policy.d.ts` 在 2.0.7 无 hidden 变化，其实际差异为下述条目 1 的 `Policy.Info.action` 同步扩展。

### 3. schema：`session.step.started` 新增 required `started: Int`【新增（required 字段；事件构造方 breaking）】

`session-event.d.ts`/`event-manifest.d.ts` 登记（全部 diff hunk 均落在该事件的编码/解码双侧定义）：

- `started: Int`——"Request dispatch time, before waiting for provider output."（请求分发时间，等待 provider 输出之前）；运行时 schema（`session-event.js`）声明为 `NonNegativeInt`，类型声明（`.d.ts`）为 `Schema.Int`，以 `.d.ts` 为契约口径。
- client 侧 `solid/data.js` 同步：step `time.created` 改用 `event.data.started`——TUI/客户端对 step 耗时统计口径从事件时间戳改为请求分发时间（排除排队时间）。
- required 字段意味着**事件构造方**必须提供（宿主内部）；插件一般只消费事件，不受影响；回放旧事件存档的消费方需注意新字段缺失会校验失败。
- 辨析注记：`session.shell.started`/`session.shell.ended` 的 `data.time.started: Finite` 是 **2.0.5 起既有字段**（位于 `time` struct 内，语义为 shell 自身计时），2.0.7 未变——全量 grep `started` 时易误判，差异定位须以两版 diff 为准。

### 4. 官方 commit 口径其余行为项【行为级】

- `feat(location): reload configuration`（b52f241）+ `feat(cli): add reload command`（0018f08）：location 级配置热重载补全 CLI 面（`opencode reload`），与 2.0.6 `location.shutdown` 事件配套。open question：配置热重载是否触发插件 setup 重跑、对已注册 agents/tools/hooks 的影响——官方无说明。
- `fix(cli): keep updates client-owned`（49577）：更新机制改为客户端全权负责——与本插件 `src/update/` 自动更新能力的交互需升级宿主后验证。
- `fix(acp): propagate request cancellation and close sessions cleanly`（49563）：ACP 取消传播与会话清理。
- `feat(cli): support custom Console logins`（49542）；TUI 4 笔（TPS 计入 provider latency、vertical tabs 提前切换等）；docs 4 笔。

### 5. `@opencode/client` 2.0.5 → 2.0.7（附带核查；本插件 `src/tui.tsx` 消费）【breaking（client SDK 面）+ 新增】

- **`server.status()` → `server.info()`**：重命名；返回 `ServerInfo { version, pid, urls, paths: { tmp } }`（新增 `paths.tmp`）。直接调用旧方法名的 client 消费方需迁移。
- 新增 `location.reload()`、`file.write(input)`（`FileSystemWrite { path: string }`，对应 schema `FileSystem.Write`）。
- `V2Event` 联合新增 `LocationShutdown`（对应 `location.shutdown` 事件）。
- `SessionStatus` 类型 2.0.5 → 2.0.7 逐字节一致——本插件 `src/tui.tsx` 的 `import type { SessionStatus }` 消费安全。
- `effect/{api,client,generated}` 与 `promise/{client,generated}` 同步变化。

### 6. 宿主实测（@opencode/cli@2.0.7，2026-09-18，隔离 serve + 临时 XDG + `OPENCODE_CONFIG` 指向本仓库 `dist`）

本插件（按 `@opencode/{plugin,schema}@2.0.5` 构建，未升级依赖）在 2.0.7 宿主上：

- 加载 **active**：`/api/plugin` 返回 `opencode-oceanus`，`source: {type: "local", path: ".../dist/index.js"}`，`features: {server: true, tui: true}`，`state.status: "active"`；插件总数 85（84 builtin + 本插件）。
- 14 个 agent 全量注册（oceanus/sisyphus/prometheus + explorer/librarian/oracle/designer/fixer/observer + 5 内置 general/explore/compaction/title/summary）。
- 12 个 skill 全量注册（本插件 10 个，路径均为 `path: /builtin/opencode-oceanus/.../SKILL.md`——2.0.5 的 `path` 字段形态保持）+ 宿主 opencode/report。
- 插件 console 日志正常输出（`[oceanus] agent-browser 探测`、`[oceanus:update] auto_update`）。
- `/api/mcp` 显示 `codebase-memory-mcp: disabled`（隔离环境配置门控默认关闭；transform 注册未导致插件失败）。
- 实测方法注记（2.0.7 复测要点）：
  - `plugins` 配置必须为**数组**形态；对象形态会被 schema 静默丢弃且无告警（`/api/config` 返回的 info 不含解析后字段即可识别该状况）。
  - `file://` 必须指向含 `index.js`/`tui.js` 的 dist 目录——宿主 `Host.resolve` 按 `<dir>/server|index` 与 `<dir>/tui` 子路径解析入口，**不读 package.json main**。
  - serve 随机 server password 的 HTTP 认证为 **Basic**，用户名固定 `opencode`（`curl -u "opencode:$PW"`；空用户名/Bearer/其它用户名均 401）。
  - 插件注册为异步：冷启动后立即查 `/api/plugin` 可能得到空集（连 builtin 都为空），需等待就绪（实测数秒）。
- 观察（未定论，待后续核实）：纯内置状态（无用户插件）下 `/api/agent` 出现 `build`/`plan` 两个 agent（2.0.3 时代实测不存在，见 `10-builtin-inventory.md`）；本插件加载（设置默认 agent）后两者不再出现——语义待确认（可能与 default agent 设置或注册时序相关）。

### 7. 本插件验证结论

- **类型面零破坏**：2.0.5 → 2.0.7 的 plugin 变化（新增 2 个实验性 ws hook）与 schema 变化（新事件/新 schema 导出/optional `hidden` 字段/required 事件字段/类型放宽）均不命中本插件消费面——Context 注册域、`session.hook("prompt"/"retry")`、`@opencode/schema/tool` 的 `Tool` 类型（`tool.d.ts` 两版零变化）、TUI context（`tui/context.d.ts` 两版零变化）、`@opencode/client` 的 `SessionStatus`（两版一致）。
- **运行时零回归（实测）**：见上节——2.0.5 API 构建的插件在 2.0.7 宿主 active 加载、agent/skill 全量注册。
- 结论：**无需升级依赖即可运行于 2.0.7 宿主**。是否将 `@opencode/{plugin,schema}` 锁定从 2.0.5 提到 2.0.7 属可选维护动作：当前无类型面收益（2.0.7 未提供本插件需要的新能力；experimental ws hooks 与 permission policies 均未纳入使用计划）。
- peerDeps 注记：`@opencode/plugin@2.0.5` 的 peerDependencies 精确锁定 `@opencode/theme@2.0.5`，在 2.0.7 宿主环境（theme 2.0.7）下独立 npm 安装会报 peer 不匹配警告——宿主内嵌运行不受影响（本插件由宿主直接加载 dist），仅独立安装场景有告警噪音；升级锁定版本可消除。

### 8. negative_findings

- v2.0.6 / v2.0.7 **无 GitHub Release notes**（列表页无条目；tag 页 body 仅为 commit message）；官方 changelog 页（opencode.ai/changelog）仍只有 v1.18.x；V2 文档站无版本级 changelog 且下载链接仍锚定 2.0.6（文档滞后）；npm metadata 无变更说明。行为级变更唯一官方载体是 GitHub tags compare。
- 官方 V2 文档 plugins 页的 `SkillEditor.add` 示例仍用旧字段名 `location`（与 2.0.5+ schema 的必填 `path` 冲突——文档示例未随 schema 更新）；按本库甄别原则以 tarball 类型声明为准。本插件已用 `path`，不受影响。

---

## 2.0.3 → 2.0.5

- 日期：2026-09-17
- 证据源类型：`@opencode/{plugin,schema}@2.0.3` 与 `2.0.5` tarball 的 `dist` 全量 diff；官方 V2 plugins 文档；真实 `@opencode/cli@2.0.5` 服务日志与 `/api/plugin`。
- 影响分级：下列均为 API/schema 破坏性变化，未消费的域不影响本插件。

### 1. `Skill.Info.location` → 必填 `path`【breaking；本插件受影响】

`schema/skill.d.ts` 的 `Skill.Info`、`Skill.Update` 及事件载荷将绝对路径字段由 `location: AbsolutePath` 重命名为 `path: AbsolutePath`。`SkillEditor` 方法集合不变。

- 真实失败证据：2.0.5 宿主加载旧版 `opencode-oceanus@1.0.2` 时，服务日志记录 `disabled plugin after transform failure ... state=skill ... SchemaError(Missing key at ["path"])`；`/api/plugin` 状态为 `failed`。插件加载成功但在 skill transform 时被整体禁用。
- 适配：技能注册对象改用 `path: "/builtin/opencode-oceanus/<skill>/SKILL.md"`；依赖同步精确锁定到 `@opencode/{plugin,schema}@2.0.5`，以便类型检查阻止旧字段回归。

### 2. `catalog` 拆分为 `provider` 与 `model`【breaking；本插件未消费】

`Context.catalog` 及 `promise|effect/catalog.*` 移除。其 provider 与 model 读写/transform/reload 功能分别迁至 `Context.provider` 与 `Context.model`；新增对应 `promise|effect/{provider,model}.*`。

### 3. session、VCS 与权限 API 重命名/移除【breaking；本插件未消费】

- `SessionDomain.rename(input)` 改为 `update(input)`。
- `VcsDomain.branches(input)` 改为 `vcs.branch.list(input)`。
- `PermissionDomain.rules` 移除；会话权限仍可通过宿主配置/API 管理，但插件 context 不再暴露该方法。
- 表单类型从 `FormReplyInput`/`FormCancelInput` 改名为 `SessionFormReplyInput`/`SessionFormCancelInput`。

### 4. provider/model 会话传输配置【breaking；本插件未消费】

`websocket?: boolean` 移除，provider 与 model 配置改为 `transport?: "http" | "websocket"`。旧配置应映射为 `true → "websocket"`、`false → "http"`。新增实验性 `experimental.ws.handshake` session hook；同时保留 HTTP hook。

### 5. 其余 schema 变化【需按消费面评估】

- `catalog.updated` 改为 `provider.updated`，并新增 `model.updated`；消费旧事件名的订阅者需迁移。
- `session.permissions.updated` 改为 `session.permissions`。
- 配置 `Preferences`/`PreferencesPatch` 移除，收敛为 `Patch: { shell: string | null }`；`websearch` 不再是该偏好 schema 的字段。
- instruction entry 不再包含 `agents`、`claude` 两类目录变体，仅保留 `document`、`directory`。
- MCP 新增 `protocol: "legacy" | "auto" | "2026-07-28"`。

### 6. 本插件验证结论

- 本插件只命中 Skill 路径字段变化；未使用 `catalog`、`Session.rename`、`Vcs.branches`、`PermissionDomain.rules`、`websocket` 配置或上述事件名。
- 已在隔离的真实 2.0.5 Host（`OPENCODE_CONFIG` 指向本仓库 `dist`）复测：`/api/plugin` 返回 `opencode-oceanus`、`features: {server: true, tui: true}`、`state.status: "active"`；`/api/skill` 返回全部 10 个 Oceanus skills，且路径均为 `path: /builtin/opencode-oceanus/.../SKILL.md`。

---

## beta-19271 → 2.0.3（GA 正式版）

- 日期：2026-09-14（记录）；发布时间线：v2.0.0 tag 2026-09-11，npm 2.0.0=09-12 00:15、2.0.1=09-12 05:00、2.0.2=09-12 07:55、2.0.3=09-12 23:46（UTC）
- 证据源类型：tarball 归一化全量 dist diff 三方分解（`@opencode-ai/{plugin,schema}@0.0.0-beta-19271` 旧包 import 路径归一化为 `@opencode/*` 后，与 `@opencode/{plugin,schema}@0.0.0-beta-19507` 及 `@opencode/{plugin,schema}@2.0.{0,1,2,3}` 逐对 `diff -rq`/`diff -u`）+ 宿主 `@opencode/cli@2.0.3` 隔离 serve 实测（2026-09-14）+ npm registry 元数据 + GitHub v2.0.x tags compare（官方未发布 v2.0.x release notes，见 negative_findings）
- 影响分级：见逐条标注

### 0. 版本与包族结构变化【breaking（依赖坐标）】

- **GA 切版不是 API 断点**：`beta-19507 → 2.0.0` 的 plugin 与 schema dist **零差异**（`diff -rq` 全等）；npm 时间线显示 `0.0.0-beta-19500`（09-12 00:11）→ `2.0.0`（09-12 00:15）仅隔 4 分钟——2.0.0 是 beta 开发线（195xx）的 GA 版本号化。beta dist-tag 止于 `0.0.0-beta-19507`，此后开发线仅以 `0.0.0-dev-195xx` 继续。
- **包族整体迁移新 scope**：`@opencode-ai/*` → `@opencode/*`。`@opencode/{cli,plugin,schema,core,client,sdk,ai,protocol,server,theme,util}` latest 均为 2.0.3。旧 `@opencode-ai/plugin` 无 2.x 版本、**未标 deprecated**（latest 仍 1.18.30，v1 线并行维护，双轨分发）。`beta-19507` 已在新 scope 下发布。
- **新增宿主核心包** `@opencode/core@2.0.3`（"Core runtime services for OpenCode"，1234 文件，含 drizzle db/47 migrations）；新增 `@opencode/util`。
- **CLI 双名**：`@opencode/cli@2.0.3` bin 同时注册 `opencode` 与 `opencode2`（同一二进制）。2.0.0 曾以 `opencode2` 为名，2.0.1 起 `opencode` 主名回归并保留 `opencode2` 别名（GitHub v2.0.0...v2.0.1 compare："keep opencode2 as a working alias"）。实测 `opencode2 --version` → `opencode v2.0.3`。
- **仓库/文档迁移**：GitHub → `github.com/anomalyco/opencode`；V2 文档站独立于 V1——`opencode.ai/v2/docs`（`v2.opencode.ai` 重定向别名）；V1 文档仍在 `/docs`。安装渠道收缩为 npm `@opencode/cli`、`https://opencode.ai/v2/install` 脚本、Docker `ghcr.io/anomalyco/opencode`（brew/AUR/Windows PM/standalone 二进制不支持，官方 V2 安装页口径）。
- 对插件影响：升级依赖需同时改包名与版本（`@opencode-ai/plugin@0.0.0-beta-18743` → `@opencode/plugin@2.0.3`），import 路径全量随迁；本插件源码 import 自身锁定包名，迁移是纯坐标替换。

### 1. Session hooks 重构：`options` 合并 + compaction/generate/title 三个新 hook【breaking（类型面）+ 新增】

`promise|effect/session.d.ts`（差异落在 beta-19271 → beta-19507 段）：

```diff
+/** Request overrides. Typed keys are generation settings; any other key is a provider option. */
+export type SessionRequestOptions = Types.DeepMutable<GenerationOptionsFields> & Record<string, unknown>
+export interface SessionRequest {
+    readonly sessionID: Session.ID
-    readonly agent: Agent.ID            // SessionContext 独有，SessionRequest 无
     readonly model: Model.Ref
     system: Array<SystemPart>
     messages: Array<Message>
+    options: SessionRequestOptions
+}
+export interface SessionContext extends SessionRequest {
+    readonly agent: Agent.ID
     tools: Record<string, { description: string; input: JsonSchema.JsonSchema }>
-    /** Request overrides; unset fields retain route and model defaults. */
-    generation: Types.DeepMutable<GenerationOptionsFields>
-    providerOptions: Record<string, unknown>
+}
+export interface SessionCompactionResult { summary: string; providerState?: ...; metadata?; tokens?: TokenUsage.Info }
+export interface SessionCompaction extends SessionContext { result?: SessionCompactionResult }
+export interface SessionGenerate extends SessionContext {}
+export interface SessionTitle extends SessionRequest { result?: string }
 export interface SessionHooks {
     readonly prompt: SessionPrompt
     readonly context: SessionContext
+    readonly compaction: SessionCompaction
+    readonly generate: SessionGenerate
+    readonly title: SessionTitle
     readonly "model.request": SessionModelRequest
```

- `SessionContext.generation`/`providerOptions` 两字段移除，合并为 `options: SessionRequestOptions`（类型化键=生成设置，其余任意键=provider option）——依赖旧字段名的 `context` hook 消费方需迁移。
- 新 hook `compaction`：`SessionCompaction extends SessionContext`，设 `result?: SessionCompactionResult` 可直接给出压缩结果并**短路跳过模型请求**。
- 新 hook `generate`：`SessionGenerate extends SessionContext`（agent-loop 生成请求拦截点）。
- 新 hook `title`：`SessionTitle extends SessionRequest`，设 `result?: string` 可短路标题生成的模型请求。
- `SessionModelRequest/HttpRequest/HttpResponse` 的 `kind: "primary"|"compaction"|"title"|"generate"` 判别保留（beta-19242 引入）。
- 对插件影响：本插件未消费 `context` hook 的 `generation`/`providerOptions` 字段，无迁移；新 hook 为可选增强。

### 2. 会话级权限 `session.permissions` + 新事件 `session.permissions.updated`【新增（能力面重要）】

schema `session.d.ts`/`session-event.d.ts`/`session-transfer.d.ts`/`event-manifest.d.ts`（落在 beta-19271 → beta-19507 段）：

- `Session.Info` 新增 optional `permissions: Array<{ action: string; resource: string; effect: "allow" | "deny" | "ask" }>`，注释明确 **"Evaluated after the agent's rules; the last matching rule wins"**——会话创建时携带权限规则集，评估顺序在 agent 规则之后。
- `session.created`/`session.updated` 事件携带 `permissions`；新增事件 `session.permissions.updated`（`PermissionsUpdated`，durable 事件）；transfer 载荷与 event-manifest 同步登记。
- 官方 V2 文档口径：子会话继承创建时的规则（会话级 rules 替换式）。
- 对插件影响：本插件 prometheus 受限权限经 agent `permissions` 声明，会话级规则是宿主新增的并行机制，暂不消费。

### 3. `PermissionDomain` 新增 `rules` 读取【新增】

`promise|effect/permission.d.ts`：`Pick<PermissionApi, "list" | "get" | "reply">` → `Pick<PermissionApi, "list" | "get" | "reply" | "rules">`——插件可读取当前权限规则集（与条目 2 的会话级规则配套）。`PermissionHooks.evaluate` 结构不变。

### 4. provider/model `websocket` 会话传输策略【新增】

schema `config/provider.d.ts`（provider 条目与顶层）、`provider.d.ts`、`model.d.ts` 新增 optional `websocket: boolean`（"Session WebSocket policy for routes that support it; omitted means disabled"；model 侧注释"omitted inherits the provider policy, then defaults to disabled"）。落在 beta-19271 → beta-19507 段。

### 5. TUI `session.tabs` API 语义调整【语义变化 + 新增】

`tui/context.d.ts`：

- `open(sessionID)`: 语义从"Opens (or focuses) a tab"改为 **"Opens a tab without focusing it"**。
- `focus(sessionID)`: 语义从"Focuses an already-open tab"改为 **"Opens a tab when needed, then focuses it"**（自动补开）。
- 新增 `move(sessionID, index): boolean`（移动已开 tab 到指定序号）。

对插件影响：本插件 sidebar 未使用 tabs API，无迁移。

### 6. schema 小版本增量（2.0.2 / 2.0.3）【新增】

- **2.0.0 → 2.0.1**：plugin/schema dist 零差异。
- **2.0.1 → 2.0.2**：schema 新增 `config/shell.d.ts`（`ConfigShell.Option = { path: string; name: string; acceptable: boolean }`）与 `config.d.ts` 的 `Preferences`/`PreferencesPatch`（`shell?: string`、`websearch?: false | ConfigWebSearch.Info`，Patch 形态允许 null 清除）——用户偏好（shell 选择、websearch 配置）进配置面，与宿主 Windows shell 探测链（pwsh→powershell→Git Bash→COMSPEC）配套。
- **2.0.2 → 2.0.3**：schema `session-message.d.ts`/`session-transfer.d.ts` 的 `CompactionCompleted`/`CompactionFailed` 新增 optional `cost: Money.USD` 与 `tokens: { input, output, reasoning, cache: { read, write } }`——压缩成本/用量可观测。
- plugin 包 2.0.0 → 2.0.3 dist 全等（三个小版本零类型面变化）。

### 7. 无变化锚点（升级安全面）

归一化后 `diff -rq` 证明与 beta-19271 逐字节一致（除上述文件）：`Plugin.define`（`{ id, setup }`）、promise/effect 全部注册域（agent/catalog/command/integration/mcp/plugin/reference/skill/tool/vcs/websearch——含 `AgentEditor` 无 `add()` 的 upsert 语义、`MCPDomain{transform, reload}`、`Tool.Options.codemode` 联合结构）、`app.d.ts`、`options.d.ts`、`host.d.ts`/`source*.d.ts`、`registration.d.ts`、storage/shell/websearch 域、根级 `worktree.d.ts`（仅 JSDoc 注释补充）、TUI 三件套（`tui/{plugin,index,solid}.d.ts`）。schema 侧 `tool.d.ts`、`agent.d.ts`、`skill.d.ts`、`mcp.d.ts`、`config/{plugin,command,worktree}.d.ts` 等其余文件均无变化。

### 8. 宿主实测注记（@opencode/cli@2.0.3，2026-09-14，隔离 serve + 临时 XDG + 指向本仓库 dist 目录）

- 插件加载 **active**，`Plugin.Info.features = { server: true, tui: true }` 双入口识别。
- 14 个 agent 全量注册（oceanus/sisyphus/prometheus primary + explorer/librarian/oracle/designer/fixer/observer subagent；prometheus temperature 0.3 与完整 system prompt 注入正确）。
- 12 个 skill 全量注册（本插件 10 个 + 宿主 opencode/report）。
- `ctx.mcp.transform` 注册 CBM server → `/api/mcp` 显示 `codebase-memory-mcp: connected`（连接成功，强于 beta 时代的"连接尝试"证据）。
- **宿主内置能力全面插件化**：干净 location 下 `/api/plugin` 返回约 90 个 `opencode.*` builtin 插件（`opencode.tool.{read,write,edit,shell,glob,grep,list,patch,question,skill,subagent,webfetch,websearch}`、`opencode.provider.*`（40+ provider 接入）、`opencode.config.*`（agent/command/skill/provider/compaction/shell/worktree/websearch 等配置域）、`opencode.websearch.{exa,firefall,parallel,tavily,tinyfish}`、`opencode.vcs.{git,hg}`、`opencode.prompt.*`、`opencode.models.dev`、`opencode.mcp.codemode.exclusion` 等）。
- 内置 agent 清单变为 `general`/`explore`/`compaction`/`title`/`summary`（**无 build/plan**；`opencode.plan` 为 builtin 插件而非 agent）。
- **项目配置文件发现**：项目目录下 `opencode.json`（无 c）实测**未被识别**（`/api/config` 文档清单不含该文件、agents 空）；改名 `opencode.jsonc` 后全量生效。beta 时代实测记录未注明扩展名，无法断言此为 2.0 行为变化，但 2.0.3 下项目配置应使用 `.jsonc`。全局配置路径 `~/.config/opencode/opencode.jsonc`（home 推导，不受 `XDG_CONFIG_HOME` 重定向影响，隔离实测发现）。
- serve 形态：`opencode serve [--port] [--hostname] [--cors] [--service] [--stdio]`；`--standalone` 仍为顶层 flag（"Run with a private server instead of the background service"）；serve 启动打印随机 **server password**（HTTP 客户端经宿主 `api` 子命令自动携带）。
- 官方 V2 文档补充口径（librarian 交叉）：`plugins` 配置支持包名@版本/`{package, options}`/`file://`/`-` 前缀禁用；CLI-only/TUI-only 插件经 **`cli.json`** 配置（连远程 server 仍生效）；`opencode plugin add/list/check/update/remove` 管理命令族；V1→V2 迁移指南上线 `/v2/docs/build/plugins/migrate-v1`（V1 stable → V2 口径，与本库 beta 线事实互补）。

### 适配结论

- **beta-18743 API 面在 2.0.3 宿主上实测零回归**（插件加载、全量 agent/skill 注册、MCP transform/reload 均正常）——本插件可继续锁定 beta-18743 运行于 2.0.x 宿主。
- 升级依赖到 `@opencode/plugin@2.0.3` 的实际迁移成本：①包坐标与 import 全量改名；②若消费 `context` hook，需迁移 `generation`/`providerOptions` → `options`；③其余差异全部为 optional 新增。codemode 注入策略、`Plugin.define`、全部注册域契约不变。

### negative_findings

- **v2.0.0~v2.0.3 无 GitHub Release**（仅 bare tags，无 notes/资产）；官方 changelog 页（opencode.ai/changelog）只有 v1.18.x 条目；无集中式 "What's new in v2" 公告页。commit 级变更唯一官方载体是 GitHub tags compare。
- 官方未发布 beta 线（187xx→195xx）逐版 changelog；未发布 beta→GA 迁移说明（migrate-v1 只覆盖 V1 stable→V2）。
- 旧包 `@opencode-ai/*` v1 线维护终点未公布。

---

## beta-18743 → beta-19271

- 日期：2026-09-09（npm `beta` dist-tag 当前指向 `@opencode-ai/{plugin,schema}@0.0.0-beta-19271`；宿主实测 `@opencode/cli@0.0.0-beta-19296`，`@opencode-ai/plugin` 无 19296 版本，npm E404 实证——CLI 宿主已迁往新包名 `@opencode/cli`）
- 证据源类型：tarball 全量 dist diff 三方分解（18743/19242/19271 三版 plugin + schema tarball，`diff -rq` 定位 + 逐文件 `diff -u`；18743→19242 差异与下方既有条目完全重合，本条目只详列 **19242→19271 净增量**）
- 变更文件面（19242→19271）：plugin 仅 `tui/context.d.ts`；schema `config/provider.d.ts`、`model.d.ts`、`provider.d.ts`、`session-event.d.ts`、`session-message.d.ts`、`session-transfer.d.ts`、`event-manifest.d.ts`，新增 `session-provider-context.d.ts`。promise/effect 全部注册域（agent/catalog/command/integration/mcp/plugin/reference/session/skill/tool/vcs/websearch）与根级文件零变化。

### 1. `compaction` 配置新增（provider 条目 / provider 顶层 / model 条目）【新增】

`{ mode: "local" } | { mode: "provider"; threshold?: number }` 联合类型，optional，加到 `config/provider` 的 provider 条目与顶层两处、`model` 条目；`provider.d.ts` 导出 `Compaction` 类型。用于声明上下文压缩走本地还是 provider 侧（provider 模式可配触发阈值）。

### 2. `providerContext` 会话溯源字段 + 新文件 `session-provider-context.d.ts`【新增】

`session-event`、`session-message`、`session-transfer` 新增 optional `providerContext: { version: 1; provenance: { providerID, provider, modelID, route, protocol, endpoint(摘要，非原始 URL) }; messages: Json }`——记录产生该消息的 provider 上下文（canonical AI Message[] 载荷，安装/回放时校验）；`event-manifest` 同步登记。新文件定义 `Provenance` 与 `Info` schema。注释明确"never credentials or a connection ID"。

### 3. TUI `DialogSelectOption.footer?: string`【新增】

`tui/context.d.ts` 选择项（`DialogSelectOption<Value>`，title/value/description/category/disabled 同级）新增 optional `footer`。

### 4. 无变化锚点（升级安全面）

`promise|effect` 全部注册域 `.d.ts`（含 `mcp.d.ts`——`MCPDomain{transform, reload}` 契约与 19242 一致）、`Plugin.define`、`app.d.ts`、`options.d.ts`、`host.d.ts`/`source*.d.ts`、`registration.d.ts`、permission/storage/shell/websearch 等 infra 域、schema 其余文件均与 19242 逐字节一致。

### 5. 宿主实测注记（@opencode/cli@0.0.0-beta-19296，2026-09-09）

宿主加载本插件（npm `opencode-oceanus@0.49.0/0.50.0`，基于 beta-18743 API 构建）：插件加载、agents/skills/tools 注册、`ctx.mcp.transform/reload` 均正常工作（宿主服务日志 `loading plugin` + agent 注册实测）。beta-18743 API 面在 19296 宿主上无兼容性回归。

### 适配结论

19242→19271 净增量全部为 optional 字段与新增类型，**零 breaking**；本插件未消费 compaction/providerContext/DialogSelectOption.footer，无需升级依赖（锁定 beta-18743 继续有效，宿主 19296 实测通过）。

---

## beta-18743 → beta-19242

- 日期：2026-09-07（npm `beta` dist-tag 当前指向 `0.0.0-beta-19242`）
- 证据源类型：tarball 全量 dist diff（plugin + schema 两包，`.d.ts` 与 `.js` 均比对，`diff -rq` 定位差异文件后逐个 `diff -u`）
- 变更文件面：plugin 包 promise/effect 几乎全部域（agent/catalog/command/integration/mcp/plugin/reference/session/skill/tool/vcs/websearch）、`tui/context.d.ts`；新增根级 `host.d.ts`/`source{,.bun,.node}.d.ts` 与 `promise|effect/worktree.d.ts`，根级 `vcs.d.ts` 移除；schema 包 `config{,/command,/provider,/worktree}`、`event-manifest`、`model`、`plugin`、`project`、`session-event`、`session-message`、`session-transfer`、`token-usage`、`tool`、`worktree`。`registration.d.ts`、permission/storage/shell 等 infra 域无变化。

### 1. `Plugin.vcs?: VcsDiscovery` 字段被移除【breaking】

`Plugin` 接口回归 `{ id, setup }`；`vcs.d.ts` 根级模块（`VcsDiscovery`）删除。自定义 VCS 后端注册统一收口到 `ctx.vcs.transform`（`VcsEditor.add(VcsDefinition)`），worktree 管理拆分到新 `ctx.worktree` 域。对插件影响：本插件未使用 `Plugin.vcs`，无迁移；但参考文档中 18721 引入的 `vcs?` 描述已过时。

### 2. `Context.plugin` 类型收窄：`PluginApi` → `Pick<PluginApi, "list">`【breaking（类型面）】

插件上下文只能列插件，不能再经 `ctx.plugin` 触发安装/更新等管理操作。本插件未使用，无迁移。

### 3. 全部注册域 `*Draft` 重命名为 `*Editor`【breaking（重命名）】

`AgentDraft/SkillDraft/CommandDraft/CatalogDraft/IntegrationDraft/MCPDraft/ReferenceDraft/ToolDraft/VcsDraft/WebSearchDraft` → 对应 `*Editor`（promise/effect 双层同步）。`transform: Transform<XxxEditor>`。附带增强：

- `SkillEditor.get(id)` 新增（原 SkillDraft 无 get）。
- `ReferenceEditor.get(name)` 新增。
- `ToolEditor.namespace(namespace: Tool.Namespace)` 新增：可注册工具命名空间（`Tool.Namespace = { name, description }`，schema `tool.d.ts` 新增该接口）。
- `VcsEditor` 增加显式 `default.get()/set()` 默认后端选择。

对插件影响：`src/index.ts` 中 `ctx.agent.transform`/`ctx.tool.transform` 的回调参数类型名变化但结构兼容（`add/update/remove/list` 签名不变）；升级依赖后仅需类型层改名，逻辑零迁移。

### 4. 新增 `ctx.worktree: WorktreeDomain`【新增】

`promise|effect/worktree.d.ts` 新文件：`WorktreeEditor.add(WorktreeDefinition)` 注册 worktree 后端（`create/remove/list`，context 均含 `AbortSignal`），后注册者成为默认。`Context` 新增 `readonly worktree`。schema `worktree.d.ts`：`strategy`、`directory` 变 optional，`ListInput`（按 projectID）改为 `ListEntry`（`{ directory, type: "root" | "worktree" }`）——worktree 列表从项目维度改为目录维度。

### 5. 插件源加载机制重构（宿主内部，新导出面）【新增/无关】

plugin 包新增根级 `host.d.ts`（`resolve(target)/load(entrypoint)` 解析宿主入口）、`source.d.ts`（`createPluginSources`/`localSource`）及 `package.json` `imports` 字段 `#plugin-source`（bun/node 条件分发）；新增 `exports["./host"]`。属宿主加载器内部能力外移，插件作者一般不消费。

### 6. TUI：`session.panel` 插槽 + `ui.panel` API【新增】

- Slot tree 新增 `"session.panel": PanelInput`：`{ name, sessionID, width, presentation: "panel"|"fullscreen", focused, focus(), close(), toggleFullscreen() }`。
- `TuiContext.ui.panel` 新增：`open(name, {presentation?}): boolean`、`close()`（只关自己插件的）、`current()`（Solid computation 内响应式）。
- `PromptFooterInput` 新增 `showDetails: boolean`。
- peerDeps 提升：`@opentui/core`/`@opentui/solid` `>=0.5.9` → `>=0.5.10`。

对本插件 TUI sidebar 无直接影响，但为侧栏面板提供官方 panel 化路径（可评估把会话/模型面板迁往 `session.panel`）。

### 7. Session 模型 hook 增加 `kind` 判别【新增】

`SessionModelRequest/SessionHttpRequest/SessionHttpResponse` 新增 `readonly kind: SessionRequestKind`，`"primary" | "compaction" | "title" | "generate"`——辅助请求（压缩/标题生成）与主 agent loop 可区分，共享 hook 身份。对现按请求统一注入 headers/重写的插件需注意辅助请求也会命中 hook。

### 8. schema：配置与事件面变化【新增/局部 breaking】

- config 根：`autoupdate`（`boolean | "notify"`）移除，改为 `update: "disable" | "notify" | "auto"`；新增 `worktree: { directory }`。
- `config/command`：命令新增 `subagent?: boolean`。
- `config/provider`、`model`、`project` 新增 `canonical`（canonical provider ID / canonical 绝对路径），用于跨 worktree/规范名映射。
- 事件：`plugin.added` 事件类型删除（保留 `plugin.updated`）；abort `reason` 联合扩为 `"user"|"shutdown"|"superseded"|"inactivity"`（新增 inactivity）。
- `session-message`/`session-transfer`/`event-manifest` 的部分事件新增可选 `model: { id, providerID, variant? }` 字段。
- `Plugin.Info`（schema plugin.d.ts）：`package` → `target`，新增可选 `version/outdated/updating/ref`（插件更新状态可观测）。
- `token-usage` 新增 `total(tokens: Info): number` 辅助函数。
- codemode 机制无变化：schema `tool.d.ts` 的 `Tool.Options.codemode` 联合结构与 18743 一致（本插件 `codemode: false` 注入策略继续有效）。

### 适配结论

本插件（`opencode-oceanus`，锁定 beta-18743）升级到 beta-19242 的实际迁移成本集中在**类型重命名层**（`*Draft` → `*Editor`、`Plugin.vcs` 删除、`ctx.plugin` 收窄），运行时逻辑零变化；codemode/transform 注册契约均向后兼容。建议升级时同步 bump `@opentui/*` peer 至 0.5.10 并全量跑 `bun run check`。

---

## beta-18721 → beta-18743

- 日期：2026-09-01
- 证据源类型：tarball 全量 dist diff（plugin + schema 两包，`.d.ts` 与 `.js` 均比对）
- 影响分级：无关（对插件 API 面零影响）

### 零差异

`diff -rq` 全量比对结果为空：两个包的 `dist/` 目录（promise/effect/tui 三层 + schema 全量）在 beta-18721 与 beta-18743 之间**完全一致**。build 号增量（18721 → 18743）仅涉及宿主 CLI/其它渠道产物，插件 API 面无任何变化。

适配结论：以 beta-18721 为基线的适配分析/文档对 beta-18743 直接适用，无迁移成本。

---

## beta-18230 → beta-18721

- 日期：2026-08-31
- 证据源类型：tarball .d.ts 全量 diff（plugin + schema 两包，promise/effect/tui 三层）+ 宿主 beta-18721 实测
- 变更文件面：`promise|effect/{plugin,session,tool,registration,mcp,vcs}.d.ts`、`tui/context.d.ts`（等价重构）、schema `{plugin,session-event,session-inbox,session-message,prompt,config/provider,index}.d.ts`；新增 `{rpc.d.ts, session-metadata.d.ts}`（root/effect/promise 三处）

### 1. `Plugin` 接口移除 `tui?: boolean`，替换为 `vcs?: VcsDiscovery`【breaking】

promise 层（`promise/plugin.d.ts:50-54`）与 effect 层同步：

```diff
 export interface Plugin {
   readonly id: string
-  readonly tui?: boolean
+  readonly vcs?: VcsDiscovery
   readonly setup: (context: Context) => Promise<Cleanup | void> | Cleanup | void
 }
```

影响：CLI 插件声明 `tui: true` 处升级后成为多余属性（typecheck 报错）；需移除该声明并另行确认宿主对"双入口插件"的加载方式。TUI 入口 `@opencode-ai/plugin/tui` 的 `Definition` 无变化。

### 2. `SessionHooks` 正式新增 `prompt` 与 `retry`【正式化】

`promise|effect/session.d.ts:53-77`：hook 名联合新增两员：

```ts
interface SessionPrompt {
  readonly sessionID: Session.ID
  readonly messageID: SessionMessage.ID
  prompt: Types.DeepMutable<PromptInput.Prompt>
  metadata?: Record<string, unknown>
  delivery: SessionInbox.Delivery
}
type SessionRetryDecision = { retry: false } | { retry: true; delay: number }
interface SessionRetry {
  readonly sessionID: Session.ID; readonly agent: Agent.ID; readonly model: Model.Ref
  readonly error: SessionError.Error; readonly attempt: number
  decision: SessionRetryDecision
}
interface SessionHooks {
  readonly prompt: SessionPrompt            // 新增
  readonly context: SessionContext
  readonly "model.request": SessionModelRequest
  readonly "http.request": SessionHttpRequest
  readonly "http.response": SessionHttpResponse
  readonly retry: SessionRetry              // 新增
}
```

影响：此前只能运行时探测 + `event: never` 强转注册的 `session.hook("prompt")` / `session.hook("retry")` 可转为类型安全注册；`retry.decision` 可控重试与延迟。

### 3. `SessionContext` 新增 `generation` / `providerOptions`【新增】

```ts
interface SessionContext {
  ...
  /** Request overrides; unset fields retain route and model defaults. */
  generation: Types.DeepMutable<GenerationOptionsFields>
  providerOptions: Record<string, unknown>
}
```

### 4. `SessionDomain` 新增 `"move"`；`active` 仍未暴露【新增 + 边界不变】

```diff
-type SessionDomain = Pick<SessionApi, ... | "rename" | "wait" | "context"> & {
+type SessionDomain = Pick<SessionApi, ... | "rename" | "move" | "wait" | "context"> & {
```

`active` 在 HTTP API（`/api/session/active`）存在但插件域两版均未暴露——探测降级逻辑仍需保留。

### 5. `ToolDraft` 补齐 `list/get/update/remove`；`ToolDomain.reload` 新增【新增】

```diff
 interface ToolDraft {
+  list(): readonly (Info & { readonly id: string })[]
+  get(id: string): (Info & { readonly id: string }) | undefined
   add(tool: Info<Input, Output>): void
+  update(id: string, update: (tool: Types.Mutable<Info>) => void): void
+  remove(id: string): void
 }
 interface ToolDomain {
   readonly transform: Transform<ToolDraft>
+  readonly reload: () => Promise<void>
   readonly hook: Hooks<ToolHooks>
 }
```

`Tool.Options.codemode` 联合结构无变化（宿主 registry 行为两版一致，实测）。

### 6. `ToolHooks["execute.before"]` 移除 `inputSchema`【breaking-低】

```diff
 readonly "execute.before": {
-  readonly tool: string
-  readonly inputSchema: JsonSchema.JsonSchema
+  tool: string
   readonly sessionID: ...
```

依赖 `inputSchema` 的代码需改从 `ToolDraft.get(id).input` 获取。

### 7. `ModelHooks` 第三参约束收紧【breaking-低】

```diff
-export type ModelHooks<Spec> = <Name extends keyof Spec>(name, cb, options?: ModelHookOptions) => ...
+export type ModelHooks<Spec> = <Name extends keyof Spec>(name, cb,
+  options?: Spec[Name] extends { readonly model: unknown } ? ModelHookOptions : never) => ...
```

仅含 `model` 字段的 hook（`model.request`/`sdk`/`language`）接受 `providerID` 限定；`prompt`/`retry` 等不接受第三参。

### 8. `Context` 新增 `location` / `experimental.terminal` / `rpc`【新增 + 正式化】

```diff
 export interface Context {
   readonly app: App
+  readonly location: Location.Info            // 正式化（18230 未声明）
   readonly options: PluginOptions
   ...
+  readonly experimental: { readonly terminal: Pick<...persistentPty..., "read"> }
+  readonly rpc: RpcDomain
 }
```

`location` 正式声明后，`ctx.location.directory` 探测降级链可简化。

### 9. `MCPDomain` 收窄【breaking-低】

```diff
-export interface MCPDomain extends Omit<McpApi, "resource"> {
+export interface MCPDomain extends Pick<McpApi, "list"> {
```

只使用 `transform`/`reload`/`list` 的代码不受影响（本插件 CBM 即此形态）。

### 10. `VcsDomain` 增强【新增】

`VcsDiffInput.base?`、`VcsDefinition.base?`、`VcsDraft`（`add(VcsDefinition)` + `default.{get,set}`）新增；`Plugin.vcs: VcsDiscovery` 插件自定义 VCS 后端通道成型。

### 11. `RpcDomain` 全新【新增】

`ctx.rpc.register(definition, handlers)` → `RpcRegistration{dispose, events.emit}`；配套 schema `rpc.d.ts`、路由 `/api/rpc/*`、`Plugin.Info.features.rpc`。server↔TUI 插件结构化通信新通道。

### 12. schema `Plugin.Info` 重构【breaking-中（仅消费方）】

```diff
-export declare const Info: Schema.Union<readonly [Schema.Struct<{ id; source; status: "active"; tui: boolean }>,
-  Schema.Struct<{ id; source; status: "failed"; error: string; tui: boolean }>]>
+export declare const Info: Schema.Struct<{
+  id?: Plugin.ID
+  source: Source
+  features: { server?: true; tui?: true; rpc?: true }
+  state: { status: "active" } | { status: "failed"; error: string }
+}>
```

顶层 `tui` 布尔 → `features` 三能力位；active/failed 联合内联为 `state`。

### 13. 事件与消息面杂项【新增】

- 事件新增 `session.message.content.updated`。
- 多个 session 事件新增 optional `metadata`（宿主注入，含父会话继承注解——subagent 血缘）。
- prompt/session-message/session-inbox 的 skills 附件新增 optional `text` 字段。
- `SessionContext` 的 `generation`/`providerOptions` 见条目 3。
- 新文件 `session-metadata.d.ts`。

### 14. 无变化锚点（升级安全面）

`Plugin.define` 签名（除 tui 字段）、`Agent.Info`（model 单 ModelRef）、`SkillDraft`（list/add/update/remove）、`Tool.Options.codemode`、`app.d.ts`、`options.d.ts`、TUI 三件套（`tui/{plugin,index,solid}.d.ts`；`tui/context.d.ts` 仅等价类型重构）。

### 15. 本插件（opencode-oceanus）适配要点汇总

1. 移除 `src/index.ts` 的 `tui: true` 声明并确认宿主双入口加载方式（breaking）。
2. `src/hooks/image-materializer.ts`、`src/hooks/image-error-hint.ts` 的 `event: never` 强转转正（正式化收益）。
3. `src/runtime/host-adapter.ts` 的 `ctx.location.directory` 探测链简化为一等字段。
4. `ctx.mcp` 仅用 transform/reload，收窄无影响。
5. `session.hook` 均未传第三参，ModelHooks 收紧无影响。
6. 未使用 `inputSchema`、`Plugin.Info`、`McpApi` 被收窄方法，无影响。
