# 设计：统一 CBM 缓存根并消除 daemon 目录冲突

## 状态

已获用户批准方案 A：保留 `CBM_CACHE_DIR`，统一所有 Oceanus 入口使用同一个 `resolvedCacheRoot`。

## 目标

- 在 setup 时只解析一次 CBM 缓存根。
- 安装、二进制查找、MCP、CLI、indexer、commands、UI 和 daemon 子进程全部使用该缓存根。
- 显式 `codebaseMemory.cacheDir` 优先于外部 `CBM_CACHE_DIR`，外部变量优先于平台默认目录。
- 不再让 CLI fallback 或底层路径函数在同一 setup 链路中隐式回到另一个默认目录。

## 方案

定义不可变的 `resolvedCacheRoot`：

```text
codebaseMemory.cacheDir > process.env.CBM_CACHE_DIR > getCacheRoot()
```

setup 后所有调用只消费该值；子进程始终显式获得 `CBM_CACHE_DIR=resolvedCacheRoot`，不得继承未解析的父进程值。

CLI 的 `resolveCachedBinary`、`resolveCbmBinaryPath` 和 current manifest 查找必须接收缓存根；MCP、UI、commands、indexer、provision 继续复用共享 wiring 依赖，调用方参数不得覆盖共享缓存根。

## 生命周期约束

- 安装时检查目标缓存根下的 `current.json`、版本/平台、二进制存在性和 `--version` 健康状态；有效安装直接复用。
- manifest 缺失、损坏、二进制缺失或健康检查失败时，不得误报已安装。
- 安装并发继续使用同一缓存根下的 Promise 和 `install.lock`。
- 安装 Promise 的去重键至少包含 `cacheRoot + version`；相同根不同版本不得错误复用。
- MCP 对已有二进制不能只凭 `existsSync` 启用；需通过可注入健康检查确认，失败时保持 disabled/fail-open，不得在 `autoDownload=false` 下隐式下载。
- 外部 daemon 使用另一缓存根时不自动接管、不自动迁移、不自动杀进程；记录清晰诊断并由用户重启/统一配置。
- 不删除 `CBM_CACHE_DIR`，不删除 `cacheDir` 配置，不改动未知 MCP 配置的 ownership 规则。

## 非目标

- 不实现跨目录索引迁移。
- 不自动管理外部 daemon 生命周期。
- 不删除已有缓存或索引。
- 不改变 CBM 查询、索引和 fail-open 业务语义。

## Metis 分析

### 需求缺口

- 必须固定缓存根优先级和 setup 快照语义。
- 必须覆盖显式配置、环境变量、XDG fallback、custom root 与已有安装。

### 风险

- 只修环境变量而不修二进制查找仍会出现“安装在 custom root、执行查默认 root”。
- 动态重复调用 `getCacheRoot()` 会在环境变化后产生第二个根。
- spread 顺序可能让调用方传入的 `cacheRoot` 覆盖共享根。

### 边界与非目标

- 不接管使用其他缓存根的外部 daemon。
- 未标记为 Oceanus 管理的 MCP 配置不覆盖、不删除。

### 反例与边界条件

- `cacheDir=/c`、`CBM_CACHE_DIR=/b`、`XDG_CACHE_HOME=/a` 时所有入口必须使用 `/c`。
- 无显式配置但有外部变量时使用外部变量；三者均无时使用平台默认。
- setup 后环境变量变化不改变当前实例缓存根。
- custom root 有有效 current manifest 时 CLI 必须命中，不得回退默认根。
- manifest 或二进制无效时进入安装/降级，不得误报成功。

### 验收标准

1. 安装、CLI、MCP、UI、indexer、commands 记录到的 root 全部等于同一个 `resolvedCacheRoot`。
2. 显式 `cacheDir` 覆盖外部 `CBM_CACHE_DIR`，子进程环境最终值等于 resolved root。
3. CLI 能在 custom root 读取 current manifest 和二进制。
4. setup 后修改环境变量不会改变当前实例路径。
5. 有效安装不重复下载；无效安装不误报。
6. 不同缓存根的外部 daemon 不被自动接管。
7. `buildCbmTools`、MCP、CLI、UI、commands 使用同一 root；MCP 使用 wiring 注入的共享安装函数。
8. 相同 root 不同版本的安装 Promise 不复用；MCP 已有二进制健康检查失败不启用。

## 运行时限制

当前环境的 CBM daemon 因 active/requested cache directory 不一致无法启动；实现与测试必须使用 fake 依赖验证路径一致性，并记录真实 daemon 验证降级证据。
