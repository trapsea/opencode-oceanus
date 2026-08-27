# Oceanus 插件自动升级实施计划

## 固定约束

- TDD：每个模块先补失败测试，再实现，再运行针对性测试。
- 工作区：共享当前工作区；保留既有未提交改动。
- 所有 worker 只修改任务声明的 `Files`，不执行 git add/commit/reset/branch/worktree 操作。
- 不修改既有非自动升级相关文件，除非任务明确列出。

## 任务图

### AU-1：配置模型与默认值

- Wave：1
- Depends on：无
- Files：`src/config/schema.ts`、`src/config/utils.ts`、`src/config.test.ts`
- 目标：增加 `autoUpdate.enabled/checkIntervalMs` schema、类型和默认解析；跨 major 永不自动升级，不提供 `allowMajor`。
- 验证：配置默认值、覆盖值、strict schema 和非法值测试通过。

### AU-2：版本发现与配置入口解析

- Wave：1
- Depends on：无
- Files：`src/update/checker.ts`、`src/update/config-entry.ts`、`src/update/index.ts`、`src/update/checker.test.ts`、`src/update/config-entry.test.ts`
- 目标：读取运行包版本，识别 pinned/latest/file 配置入口，查询 npm registry，执行同 major/prerelease 判断，并完成 Oceanus installer-managed entry 的临时文件+备份+rename 原子回写。
- 验证：JSON/JSONC、BOM、注释/尾逗号、多个配置优先级、本地路径、网络超时、版本比较、错误 marker、非目标 entry 保留、配置写入失败不改原文件测试通过。

### AU-3：staging 安装、锁与原子发布

- Wave：1
- Depends on：无
- Files：`src/update/cache.ts`、`src/update/state.ts`、`src/update/cache.test.ts`、`src/update/state.test.ts`
- 目标：在 staging 目录安装 npm 包，校验 package.json/入口，使用 owner metadata 锁、陈旧锁回收、quarantine/rename 原子替换和失败恢复。
- 验证：安装成功、安装失败保留旧版本、替换失败回滚、并发/陈旧锁测试通过。

### AU-4a：启动事件适配模块

- Wave：2
- Depends on：AU-1、AU-2、AU-3
- Files：`src/update/index.ts`、`src/update/index.test.ts`、`src/runtime/types.ts`
- 目标：实现事件 async iterator、`event.data.sessionID/parentID` 根会话 gate、进程内 `hasChecked` 与持久化间隔限流、AbortController/iterator.return cleanup、稳定 logger 契约；不触碰既有入口文件。
- 验证：重复事件、间隔内/间隔后事件、真实 v2 payload、关闭配置不请求 registry、后台非阻塞、订阅异常/cleanup 均通过。

### AU-4b：主入口串行集成

- Wave：2
- Depends on：AU-4a
- Files：`src/index.ts`、`src/smoke/host-smoke.test.ts`
- Owner：主线程；任何 worker 禁止修改。
- 目标：基础 setup 完成后调用 update 注册器；`runSetup` 返回 cleanup，`Plugin.define.setup` 返回该 cleanup；生产 logger 固定为 `console.warn`，格式为 `[oceanus:update] {event} {message}`，错误作为第二参数 metadata；保持既有脏 hunks。
- 验证：集成前后仅检查上述文件自动升级相关 diff；setup cleanup 可调用；成功/失败/skip 日志包含稳定 event 名；既有 smoke 测试不回归。

### AU-5a：发布一致性脚本

- Wave：3
- Depends on：AU-4b
- Files：`package.json`、`scripts/verify-dist-auto-update.ts`、`scripts/verify-dist-auto-update.test.ts`
- 目标：确保发布包包含 update runtime 所需文件；校验 package version、dist 入口和声明一致。`dist/` 作为构建生成验证范围，不由 worker 手工修改。
- 验证：`bun run build`、发布文件清单检查通过；文档验证由 AU-5b 执行。

### AU-5b：文档主线程集成与最终验收

- Wave：3
- Depends on：AU-5a
- Files：`README.md`
- Owner：主线程；任何 worker 禁止修改。
- 目标：记录自动升级开关、固定版本 marker、`@latest`/sandbox/major 行为、失败回滚和手动升级命令。
- 验证：仅检查 README 自动升级相关 diff；在 README 修改后验证文档命令和行为与 spec 一致；主线程串行运行 `bun test`、`bun run typecheck`、`bun run build`，构建生成的 `dist/` 仅作为验证产物。

## 实现约定

- registry 使用内置 `fetch` + `AbortController`，不新增依赖。
- 版本比较使用本地纯函数，支持正式版本和 prerelease，不引入 `semver`。
- 安装器使用受控 `bun install --ignore-scripts`，不继承 provider token。
- 锁位于 Oceanus 专用缓存目录，使用 `wx`、随机 owner token、pid/createdAt/stage；`STALE_LOCK_MIN_AGE_MS=60_000`，仅 PID 不存活且超过该年龄时回收，释放前校验 token；测试重启恢复、owner 不匹配、损坏锁和 rename 间恢复。
- 配置修改只处理明确结构：对象入口 `{package:"opencode-oceanus",version:"x.y.z",__oceanusManagedByInstaller:true}`，或带文件级 marker 的字符串入口 `opencode-oceanus@x.y.z`；项目 `.opencode/opencode.json(c)` 优先于用户配置，JSONC 注释/BOM/尾逗号/非 Oceanus entry 保留。
- `PluginSetupContext` 增加可选 `event.subscribe`；不依赖不存在的 v2 TUI/synthetic API。
- `runSetup` 返回 cleanup，且 `Plugin.define.setup` 返回 `await runSetup(...)` 的 cleanup；订阅使用 AbortController，并在 cleanup 中 abort 和调用 iterator.return。
- OpenCode sandbox 由路径规则识别，禁止目录替换，只输出手动刷新提示。
- 配置 marker 固定为对象入口字段 `package/version/__oceanusManagedByInstaller` 或同文件顶层 `__oceanusManagedByInstaller: true` + 字符串 `opencode-oceanus@x.y.z`；配置搜索顺序为项目 `.opencode/opencode.json(c)` 后用户 `$XDG_CONFIG_HOME/opencode/opencode.json(c)`，每次只更新第一个最高优先级命中。
- 进程内状态 `hasChecked` 在异步检查启动前抢占式设置；持久化文件位于 `getCacheRoot()/update-state.json`，结构为 `{lastCheckedAt:number,lastResult?:string}`，时间源可注入。并发根事件只有第一个执行，网络失败仍写入检查时间，其他进程依靠 install lock 防重复替换。
- 稳定日志事件映射为：`check_started`、`check_skipped`（disabled/throttled/local/file/sandbox/major）、`check_failed`（registry/parse）、`update_available`、`update_installed`、`update_failed`（lock/install/verify/replace/config）、`restart_required`；每条包含 `{event, currentVersion?, latestVersion?, reason?, error?}`。
- AU-3 状态转移固定为：创建 staging 写 `staging` -> 校验后改 live 为 quarantine 写 `quarantine` -> staging 改 live 写 `live` -> 状态提交写 `committed`；异常退出启动恢复按“live 优先，否则 quarantine 恢复”为规则，最终清理 staging/quarantine，锁始终 finally 释放。
- 配置 marker 固定为对象入口字段 `package/version/__oceanusManagedByInstaller` 或同文件顶层 marker + 字符串 `opencode-oceanus@x.y.z`；错误 marker、其他插件 entry 和非目标字段必须不变。
- sandbox Unix 与 Windows 路径都必须断言 rename/replace 未调用，且日志包含 `check_skipped` 和手动刷新提示。
- `src/index.ts`、`src/smoke/host-smoke.test.ts`、`README.md` 有既有未提交改动，由主线程串行集成，worker 不得修改；集成前后只检查相关 diff hunks。
- AU-2/AU-3 测试显式覆盖 `@latest`、`file://`、sandbox 路径、major、JSON/JSONC/object/string marker。
- AU-3 在任何安装前先调用 `recoverUpdateState()`：按 live 优先、否则 quarantine 恢复；清理 staging/quarantine；损坏 lock/state 或恢复失败只记录 `update_failed` 并 fail-open，不删除可用 live 包。状态转移和 finally 释放锁均有重启恢复测试。
- AU-5 后由主线程串行执行全量 `bun test`、`bun run typecheck`、`bun run build`。

## Momus 门禁

- 状态：已修订，待重新执行
- revision：3
- verdict：REJECT（revision 1）；返工中，待复审
- checked_at：2026-08-27

## Review 返工记录

- revision：3
- 原因：Review/@oracle 发现 npm tarball 获取、实际 sandbox 路径、对象 marker 和无配置入口假升级问题。
- 修复边界：AU-2 同时修改 `src/update/index.ts`，增加 `AutoUpdateDeps.loadedPackagePath`；优先使用注入路径，未提供时使用 `fileURLToPath(import.meta.url)`，不使用配置文件路径，并测试 file URL、Unix/Windows 注入优先级和 fallback。AU-3 固定请求 npm registry `https://registry.npmjs.org/opencode-oceanus/-/opencode-oceanus-${version}.tgz`，归档写入 `<cacheRoot>/downloads/<version>.tgz.partial`，使用 Node `gunzipSync` + 内置 tar reader 解压到 `<cacheRoot>/staging-<token>/`，剥离单层 `package/` 前缀，使 `staging/package.json` 可见；拒绝绝对路径、盘符/UNC、NUL、`..`、反斜杠穿越、符号/硬链接和混合顶层成员；非 2xx/超时/写入/解包失败均清理 partial/staging、写 `update_failed/download` 并保留 live，测试断言不调用 `bun pack`。AU-4a 补失败状态与异步 cleanup。
- 入口契约：项目 `.opencode/opencode.json(c)` 优先，向父目录查找再到 `$XDG_CONFIG_HOME/opencode/opencode.json(c)`；支持 `plugins` 字符串 `opencode-oceanus@x.y.z`（需同文件顶层 marker）和对象 `{package:"opencode-oceanus",version:"x.y.z",__oceanusManagedByInstaller:true}`。无入口测试必须断言先发现入口、然后记录 `check_skipped/no_entry`，registry、installer、状态写入均为 0。
- sandbox 契约：使用宿主注入的 `loadedPackagePath`（默认从 `import.meta.url` 推导），Unix 匹配 `/.cache/opencode/packages/`，Windows 匹配 `\\opencode\\packages\\`；命中时不调用 rename/installer，只记录 `check_skipped/sandbox`。
- marker 测试：对象自身 true 可更新；顶层 true 只授权字符串；缺失/false/错误 marker、第二个非 Oceanus entry 均不得更新。
- 失败契约：事件通过根会话 gate 后先写 `lastCheckedAt`；无入口为唯一例外，记录 `check_skipped/no_entry` 且不写状态、不请求 registry、不安装。registry 非 2xx/超时/无效 JSON 记录 `check_failed`；tarball 下载错误记录 `update_failed/download`；安装/校验/替换/配置失败记录 `update_failed` 并保留 live；成功记录 `update_installed` 后 `restart_required`。cleanup 类型为 `() => Promise<void>`，必须 abort、await iterator.return、吞掉 rejection，且覆盖 iterator 创建前/next 挂起/延迟事件竞态。
- 修复后必须重新执行 Momus/Review 门禁。
