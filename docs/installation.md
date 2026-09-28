# 安装指南

`opencode-oceanus` 是 OpenCode v2 插件（npm 包名 `opencode-oceanus`，当前版本 1.0.6）。本文档面向两类读者：

- **人类用户**：按「安装步骤」逐节操作；
- **AI 编码助手**（OpenCode / Claude Code / Cursor 等）：按「LLM 自动安装协议」自动解析并执行安装。

> 事实基线：OpenCode v2（2.0 正式版，`@opencode/cli` ≥ 2.0.10），已核实至 `opencode v2.0.18` 宿主。兼容性细节见 [`opencode-v2-compatibility.md`](opencode-v2-compatibility.md)。

## 环境要求

| 依赖 | 要求 | 用途 | 缺失影响 |
|---|---|---|---|
| OpenCode CLI | ≥ 2.0.10（`@opencode/cli`） | 宿主 | 无法安装（v1 不兼容，`plugin` 单数字段已废弃） |
| npm / Node.js | npm ≥ 10（随 Node 20+ 附带） | 安装宿主、解析插件包 | 无法安装 |
| bun | ≥ 1.3（可选） | 仅路径 B 本地构建需要 | 仅影响源码安装 |
| ast-grep CLI | 可选 | `ast_grep_search` / `ast_grep_replace` 工具 | 两工具返回诊断信息，其余功能不受影响 |

## LLM 自动安装协议

> 本节是给 AI 编码助手的执行指令。人类用户可跳过，直接阅读「安装步骤」。

当用户要求"安装 opencode-oceanus"或等价意图时，按以下规则执行本文档：

1. **先通读全文再动手**：完整读取本文档后再开始执行，避免中途变更路径。
2. **按步骤顺序执行**：STEP 1 → STEP 2（决策）→ STEP 3A / 3B / 3C 三选一 → STEP 4 → STEP 5，不得跳步。
3. **每步先操作后验证**：每个 STEP 的「操作」完成后立即执行「验证」；验证不通过时进入该步骤的「失败处理」分支。
4. **重试上限**：同一失败点最多尝试 3 次（含首次），仍失败则停止自动重试，向用户上报：已完成步骤、失败步骤与原因（引用实际命令输出）、建议的下一步。
5. **最小写入边界**：只允许创建/修改各 STEP 中显式声明的文件（`opencode.jsonc` 等）；不修改用户其他配置，不执行任何 git 写操作。
6. **配置合并而非覆盖**：目标配置文件已存在时，先读取原内容，仅向 `plugins` 数组合并新条目；保留其他字段与注释；条目已存在则跳过写入。
7. **保持 JSONC 兼容**：原文件含注释时必须原样保留；由助手新建的配置建议写无注释 JSON，便于语法校验。
8. **完成后报告**：按「安装后验证清单」逐项核验，输出安装报告：已执行步骤、各项验证结果（含命令与输出摘要）、需要用户手动确认的交互式验证项。

## 安装步骤

### STEP 1：安装 OpenCode 宿主

**操作**（已安装且版本达标则跳过）：

```bash
npm install -g @opencode/cli
```

**验证**：

```bash
opencode --version
```

预期输出 ≥ `2.0.10`。

**失败处理**：

- `command not found`：确认 npm 可用（`npm --version`）后重装；仍失败检查 PATH。
- 版本 < 2.0.10：重新执行安装命令升级；OpenCode v1 宿主不能使用本插件。

### STEP 2：选择安装路径

按以下决策树选择**一条**路径，只执行其中一条：

```text
能否访问 npm registry（npm view opencode-oceanus version 成功）？
├─ 能 → 路径 A：npm 包安装（推荐；支持自动更新与 TUI sidebar）
└─ 不能
   ├─ 有本仓库源码或需要本地修改 → 路径 B：本地源码构建
   └─ 只能复制单文件 → 路径 C：插件目录复制（CLI-only，TUI sidebar 不加载）
```

**验证**：

```bash
npm view opencode-oceanus version
```

预期输出：`1.0.6`（或更高）。

### STEP 3A：npm 包安装（推荐）

**操作**：无需手动下载包。将包名写入 STEP 4 的 `plugins` 数组，宿主启动时自动解析安装；也可手工预装：

```bash
opencode plugin --force opencode-oceanus@latest
```

> 裸名（`"opencode-oceanus"`）配置走宿主原生 `plugin.update` 热重载自动更新；固定版本与旧宿主场景回退插件自管更新（更新后需重启 OpenCode）。

完成后直接进入 STEP 4。

### STEP 3B：本地源码构建

**操作**：

```bash
git clone https://github.com/trapsea/opencode-oceanus.git
cd opencode-oceanus
bun install
bun run build
```

**验证**：

```bash
ls dist/index.js dist/tui.js
```

预期：两个入口文件均存在（构建产物自包含，zod 已内联，仅依赖运行时提供的 `@opencode/plugin`）。

**失败处理**：`bun: command not found` → 先安装 bun（`curl -fsSL https://bun.sh/install | bash`）后重试。

STEP 4 的 `plugins` 数组使用 dist **目录**路径（相对或绝对均可；相对路径相对 `opencode.jsonc` 所在目录解析）：

```json
{
  "plugins": ["./opencode-oceanus/dist"]
}
```

> **路径必须是目录，不能是 `dist/index.js` 单文件**——指向文件会被宿主整体跳过（agents 列表为空；beta-18721 与 2.0.3 双版本实测）。

### STEP 3C：插件目录复制（CLI-only，不推荐）

**操作**：完成路径 B 的构建后，将 `dist/index.js` 复制为以下任一路径：

- 项目级：`.opencode/plugins/opencode-oceanus.js`
- 全局：`~/.config/opencode/plugins/opencode-oceanus.js`

`.opencode/plugins/`（v2 规范，复数）目录下的文件在启动时自动加载。

**限制**：单文件形式无包结构（无 `exports["./tui"]` 声明），宿主只能发现 CLI 入口，**TUI sidebar 不会加载**，且该形式未纳入本仓库的宿主验证台账。能选路径 A/B 时不要选 C。

### STEP 4：写入 OpenCode 配置

**操作**：将 `plugins` 条目写入以下任一配置文件（项目级便于单项目试用，全局对所有项目生效）：

- 项目级：`<项目根>/opencode.jsonc`
- 全局：`~/.config/opencode/opencode.jsonc`

路径 A（包名）：

```json
{
  "plugins": ["opencode-oceanus"]
}
```

路径 B（dist 目录）：

```json
{
  "plugins": ["/absolute/path/to/opencode-oceanus/dist"]
}
```

对象形式（携带插件 options）：

```json
{
  "plugins": [{ "package": "opencode-oceanus", "options": {} }]
}
```

注意：

- 字段名是 **`plugins`（复数）**；v1 的 `plugin`（单数）已废弃。
- 项目级配置文件使用 **`.jsonc` 扩展名**（2.0.3 实测 `.json` 未被识别）。
- 已存在的配置文件按「LLM 自动安装协议」第 6 条合并，不覆盖其他字段。

**验证**（无注释 JSON 时）：

```bash
node -e "JSON.parse(require('fs').readFileSync('opencode.jsonc','utf8')); console.log('json ok')"
```

预期输出：`json ok`。含注释的 JSONC 跳过本命令，改为逐段复查语法。

### STEP 5：验证安装

**操作**：启动 OpenCode：

```bash
opencode
```

**验证**（交互式；LLM 无法代验时逐项报告给用户确认）：

- [ ] agent 列表 / 切换器出现 Oceanus agents：`oceanus`（默认）、`sisyphus`、`prometheus` 与 `explorer` / `librarian` / `oracle` / `designer` / `fixer` / `observer`；
- [ ] TUI 侧边栏出现 Oceanus 面板（显示当前会话 agent 与模型信息）——路径 C 无此项；
- [ ] `/preset` 等 slash 命令可用。

**失败处理**：

- agents 列表为空：检查 STEP 4 配置——本地路径是否误写为单文件（必须是目录）；项目级配置扩展名是否为 `.jsonc`；JSONC 语法是否有效。
- 插件未加载：观察 `opencode` 启动报错输出；确认 `plugins` 为数组且拼写为复数。

## 安装后验证清单

| 项 | 命令 / 方式 | 预期 | 状态 |
|---|---|---|---|
| 宿主版本 | `opencode --version` | ≥ 2.0.10 | ☐ |
| npm 包可达 | `npm view opencode-oceanus version` | ≥ 1.0.6（路径 A/B 决策用） | ☐ |
| 配置文件 | 读取 `opencode.jsonc` | 含 `plugins` 条目，语法有效 | ☐ |
| agents 注册 | 启动 `opencode` 查看 agent 列表 | 出现 Oceanus agents | ☐ |
| TUI sidebar | 启动 `opencode` 查看侧边栏 | Oceanus 面板（路径 C 除外） | ☐ |

## 可选配置

### 模型 preset

默认所有 agent 跟随会话模型。推荐使用内置命令生成厂商 preset：

```text
/oceanus-config
```

多选内置厂商后由 `oceanus_config_generate` 工具原子写入用户级 `~/.config/opencode/opencode-oceanus.jsonc`；也可手工编辑该文件配置 `presets` / `agents` / `disabled_agents` 等（完整字段与合并优先级见 [README](../README.md#配置)）。

### ast-grep CLI（`ast_grep_search` / `ast_grep_replace`）

```bash
bun add -D @ast-grep/cli   # 或 cargo install ast-grep、brew install ast-grep
```

或设置 `AST_GREP_BIN` 环境变量指向已有二进制（Windows 缓存目录为 `%LOCALAPPDATA%\opencode-oceanus\ast-grep\bin\ast-grep.exe`）。未安装时这两个工具返回诊断信息，不影响其他功能。

### CBM（codebase-memory-mcp）

无需手动安装：二进制由内置 SHA-256 manifest 驱动的 `provision` 流程自动下载校验，不信任网络返回的哈希。详见 [`codebase-memory-mcp.md`](codebase-memory-mcp.md)。

### agent-browser 浏览器验证

默认 `enabled: true`、`autoInstall: false`，按需确认门安装。详见 [`agent-browser.md`](agent-browser.md)。

### 自动更新

默认开启：插件加载后 2 秒后台检查一次 npm 最新稳定版（每进程一次），跨进程按 `checkIntervalMs`（默认 3 小时）节流，不阻塞插件加载。可通过 `autoUpdate` 配置关闭，详见 [README](../README.md#自动升级)。

## 故障排查

| 症状 | 原因 | 处理 |
|---|---|---|
| agents 列表为空 | `plugins` 指向了单文件 | 改为指向**目录**（内含 `index.js`） |
| 项目配置不生效 | 使用了 `.json` 扩展名 | 项目级配置使用 `opencode.jsonc` |
| v1 风格配置不生效 | 使用了 `plugin`（单数）字段 | 改为 `plugins`（复数）数组 |
| TUI sidebar 不显示 | 使用了路径 C 单文件形式 | 改用路径 A / B |
| `ast_grep_*` 返回诊断信息 | 环境无可用 ast-grep CLI | 见「可选配置」安装或设置 `AST_GREP_BIN` |
| 升级后行为异常 | 残留旧版本缓存 | `opencode plugin --force opencode-oceanus@latest` 重装 |

## 卸载

1. 从 `opencode.jsonc` 的 `plugins` 数组移除 `opencode-oceanus` 条目（路径 C 另需删除复制的 `.opencode/plugins/opencode-oceanus.js` 文件）；
2. 重启 OpenCode。
