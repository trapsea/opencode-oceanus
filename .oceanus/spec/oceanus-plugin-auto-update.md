# Oceanus 插件自动升级设计

## 目标

参考 `/apple/workspace/ai/oh-my-opencode-slim`，为 Oceanus 增加安全的 npm 插件自动升级：启动后台检查、同 major 版本 staging 安装、校验、原子替换、配置回写、失败回滚和重启提示。

## 范围

- Oceanus npm 插件自身的版本检查与升级。
- 使用 OpenCode v2 `ctx.event.subscribe({ signal })` 监听根会话 `session.created`。
- 支持 JSON/JSONC 配置中的 Oceanus 版本入口。
- 对 `@latest`、`file://`、本地开发和 major 版本升级安全降级。
- CBM 二进制继续使用现有 `src/cbm/provision.ts`，不与 npm 升级流程混合。
- 增加配置、状态、锁、原子替换和发布完整性测试。

## 非目标

- 不强行覆盖 OpenCode 管理的 npm sandbox。
- 不在当前 OpenCode 进程内热替换已加载的 ESM 模块。
- 不自动跨 major 升级。
- 不制造额外的 session turn；用户可见提示使用注入 logger/`console.warn`，不依赖 v1 TUI toast。
- 不修改非 Oceanus 管理的插件、MCP 或用户索引。
- 不让网络返回的 CBM 哈希成为信任根。

## 运行流程

```text
session.created
  -> event.data.sessionID/parentID 根会话 gate / 单进程去重 / 间隔限流
  -> 读取当前版本和插件配置入口
  -> 查询 npm registry（超时、失败 fail-open）
  -> 预发布或 major 版本跳过并提示
  -> staging 安装并验证新包
  -> quarantine/rename 原子替换，失败保留旧包
  -> 仅回写 installer-managed 配置
  -> 记录状态并提示重启
```

## 配置

新增可选配置：

```jsonc
{
  "autoUpdate": {
    "enabled": true,
    "checkIntervalMs": 3600000
  }
}
```

默认启用检查；默认不跨 major。配置 schema 使用 strict，因此 schema、默认值和解析逻辑必须同步修改。

## 安全与兼容性

- 网络请求必须有超时，任何网络或文件异常都不能阻塞插件启动。
- 安装在临时 staging 目录，成功校验后再替换。
- 使用 owner metadata 锁并支持陈旧锁回收。
- 更新配置前创建备份并采用临时文件 rename。
- 只有带 Oceanus installer marker 的固定版本配置才允许自动回写。
- marker 结构固定为 v2 `plugins` 数组对象：`{"package":"opencode-oceanus","version":"1.2.3","__oceanusManagedByInstaller":true}`；字符串入口仅在同一配置文件存在顶层 marker 时允许回写。
- `@latest`、`file://` 和 OpenCode-managed sandbox 只提示用户刷新/重启。
- OpenCode-managed sandbox 通过路径包含 `/.cache/opencode/packages/` 或 `\\opencode\\packages\\` 判定，且不执行目录替换。
- 订阅在基础 setup 完成后建立；setup 返回 cleanup，cleanup 同时 abort signal 和调用 iterator.return()。
- lock 使用 `writeFileSync(..., { flag: 'wx' })`，owner token 与 pid/createdAt/stage 一起写入；只有 owner token 匹配的释放操作可以删除锁。
- 更新事务为 staging 校验 -> live 改名 quarantine -> staging 改名 live -> 写状态；失败恢复 live，启动时清理 quarantine。
- 状态包含 `phase: staging|quarantine|live|committed`；启动恢复时若 live 存在则删除 quarantine，若 live 不存在且 quarantine 存在则将 quarantine 恢复为 live。

## Metis 分析

### 需求缺口

- OpenCode 不提供插件自身可靠热重载，因此升级后必须重启。
- 当前发布流程没有明确的版本/tag 自动化约束，先只补发布一致性检查。

### 风险

- 当前运行的 ESM 模块无法安全自替换。
- 多个 OpenCode 进程可能并发升级。
- OpenCode beta 插件 API 或宿主版本可能不兼容新包。
- 当前工作区存在大量外部未提交改动，实施必须限制文件范围。

### 边界与非目标

- 不覆盖 OpenCode npm sandbox。
- 不自动跨 major。
- 不将 npm 包版本和 CBM 二进制版本强耦合。

### 反例与边界条件

- npm registry 超时、代理失败、返回无效版本。
- 当前版本无法解析、配置不存在或配置为本地路径。
- staging 安装失败、校验失败、替换失败或锁陈旧。
- 多个配置文件和多个 Oceanus entry 同时存在。
- 新版本为 prerelease 或 major 版本。

### 验收标准

- 根会话仅触发一次检查，子会话不触发。
- 自动升级关闭时不请求 registry、不修改配置。
- 同 major 固定版本可安全 staging 安装并提示重启。
- 任意失败都保留旧版本且不阻塞插件加载。
- JSON/JSONC 注释和非 Oceanus 配置保持不变。
- `@latest`、本地开发和 major 版本不会被错误覆盖。
- v2 event payload、订阅 cleanup、sandbox 禁止替换和更新事务恢复均有测试。
- `bun test`、`bun run typecheck` 和 `bun run build` 通过。

## 参考实现

- omo-slim：`src/hooks/auto-update-checker/index.ts`、`checker.ts`、`cache.ts`、`src/cli/config-io.ts`。
- Oceanus：`src/index.ts`、`src/hooks/index.ts`、`src/config/schema.ts`、`src/config/utils.ts`、`src/cbm/provision.ts`。
