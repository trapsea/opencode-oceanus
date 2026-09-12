# agent-browser 浏览器验证（browser_verify）

[opencode-oceanus](../README.md) 的浏览器能力接入：把 [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)（Rust CLI + Chrome for Testing）整合为**双模式统一协议**——**通用浏览器操作**（任何 agent 在调试复现、动态内容检查、交互实验等非验收场景按需使用，无需执行配置）与**浏览器验证**（Sisyphus 工作流实现类前端任务的渲染截图、视觉 diff、设计 token 精确核对与交互断言自动化取证，补上「实现后取得渲染截图」这一环节，让 clipboard-image-observer 的 L5 视觉验收闭环可以无人值守运转）。

## 设计定位：三层架构

| 层 | 载体 | 职责 |
|---|---|---|
| 能力层 | 插件配置 `agentBrowser.*` + `src/browser/` 模块 + setup `browser` 阶段 | 决定能力是否存在：探测（PATH → 配置 binaryPath → npm global）、可选自动安装、fail-open 日志 |
| 任务层 | Intake 执行配置批问第四项 `browser_verify` | 决定**本任务**是否启用：仅前端 UI/交互实现任务（`frontend_scope ≠ none`）批问中出现，默认推荐关闭 |
| 协议层 | `agent-browser` skill | 决定怎么用：**双模式**——通用浏览器操作（导航/快照/交互/诊断/实验，任何 agent 无门控按需）＋验证协议（browser_verify 门控：场景→命令映射、截图落盘、observer 协作、token 容差、循环预算与降级）；会话生命周期两模式共用 |

三层关系：

- 能力关（`agentBrowser.enabled=false`）→ 批问不出现第四项，记录 `not_available: disabled-by-config`（通用操作模式亦不可用——CLI 缺失时按 fail-open 改用替代手段）。
- 能力开 + 非前端任务 → 记录 `not_asked: non-frontend`，验证语义与现状完全一致；**通用浏览器操作不受批问门控影响**，任何 agent 可按需使用。
- 能力开 + 前端任务 → 正常批问；答「关」（默认）流程与现状完全一致；答「开」按下表注入。
- 运行中 agent-browser 故障 → fail-open 降级为人工截图/手工 QA 口径，记录 `browser_verify: degraded (<原因>)`，不阻塞任务。

## 前端范围判定（frontend_scope）

Intake 在批问前识别（≤10 秒），结果写入 `intake_report.frontend_scope`：

- **信号**（任一命中即涉前端）：`tech_context` 含前端框架/构建（React/Vue/Svelte/Next/Vite 等）；需求关键词含 UI/页面/组件/样式/布局/动效/交互/还原/设计稿；存在设计稿图片附件。
- **取值**：`ui-pixel`（像素敏感还原/品牌视觉，对应 observer L4）| `ui-standard`（常规页面/组件，对应 L3）| `interaction`（交互逻辑为主）| `none`（非前端）。
- 拿不准一律判涉前端（保守让批问项出现），默认推荐仍为关闭，由用户决定。

## 工作流融入点（browser_verify=on 时）

| 阶段 | 注入动作 |
|---|---|
| **Intake** | 能力探测登记（仅探测不安装）+ 前端范围判定 + 第四项批问 |
| **Plan** | 前端任务的表面验证步骤写明 agent-browser 命令（dev server 后台启动 → `wait --url` → `screenshot`/断言 + Expected）；交互/渲染类 truths 写成可取证形式（`get styles` 断言值、`find role … click` 后状态） |
| **Execute** | designer 视觉短反馈（完成即截图自查/交 observer 复用会话核对，当轮修正，不等 Review）；real-surface 取证（渲染截图、`get styles`/`get box` 数值、交互断言输出、console/errors）；L5 渲染截图自动来源 |
| **Review** | 完成矩阵交互/渲染类 truths 用 agent-browser 断言输出作 evidence（天然满足 command/exit_code/executed_at/state_head 字段要求）；降级任务证据缺口按 UNCERTAIN 处理 |
| **Finish** | 不注入（只读汇总） |

## 安装

**推荐手动安装**（一次到位）：

```bash
npm install -g agent-browser
agent-browser install            # 下载 Chrome for Testing（首次）
# Linux 服务器/容器：
agent-browser install --with-deps
agent-browser doctor             # 自检
```

也可用 Homebrew（`brew install agent-browser`）或 Cargo。详见 [官方 README](https://github.com/vercel-labs/agent-browser)。

**自动安装**（显式 opt-in）：配置 `agentBrowser.autoInstall=true` 后，setup 探测缺失时自动执行上述安装（detached，不阻塞启动）。默认 `false`——npm 安装与 Chrome 下载体积大，需显式授权。运行时批问路径中用户选择「开」但未安装时，agent 会经 `question` 确认后引导安装，**不存在静默安装**。

## 配置

用户级 `~/.config/opencode/opencode-oceanus.jsonc` 或项目级 `.opencode/opencode-oceanus.jsonc`：

```jsonc
{
  "agentBrowser": {
    "enabled": true,        // 能力总开关（默认 true）；false 时批问不出现第四项
    "autoInstall": false,   // 探测缺失时自动安装（默认 false，需显式授权）
    "version": "1.9.0",     // npm 安装时锁定版本（缺省 latest）
    "binaryPath": "/usr/local/bin/agent-browser" // 自带二进制（探测第 2 级）
  }
}
```

未知字段会被 `.strict()` schema 拒绝。默认值见 `src/config/utils.ts` 的 `DEFAULT_AGENT_BROWSER_CONFIG`。截图落盘目录由 agent-browser skill 固定为 `<workspace>/.oceanus/media/browser/<task-id>/`，不作为可配置项暴露。

## `src/browser/` 模块

- `detect.ts`：`detectAgentBrowser()` 三级探测（PATH → 配置 binaryPath → npm global 经 `npm ls -g` + `npm prefix -g` 推导 bin 并实际执行 `--version` 验证）；可选 `doctor --json` 健康检查，失败不推翻 available（fail-open）。只读、spawn 可注入、测试不触碰真实进程。
- `install.ts`：`installAgentBrowser()` 确认门 fail-closed（无 `confirm` 或返回 false 一律 `user_declined`）；两段安装（`npm install -g agent-browser[@version]` → `agent-browser install [--with-deps]`）；结构化错误码 `user_declined | npm_install_failed | chrome_install_failed | doctor_failed`。
- setup 接线：`src/index.ts` 的 `browser` 阶段在 `agentBrowser.enabled` 时后台探测（fail-open 只记日志）；`autoInstall=true` 视为显式授权，安装 detached 执行。运行时 agent 按 skill 文案自行探测，不依赖 setup 结果。

## 与 observer / L5 验收的关系

- 视觉核对仍走 `@observer`（主 Agent 不读原图）：渲染截图以绝对路径委派 observer，L5 验收复用当初分析设计稿的 observer 会话做基准图 vs 渲染截图比对。
- 像素 diff（`agent-browser diff screenshot --baseline`）与 observer 视觉 diff 互补：像素 diff 抗语义漂移、视觉模型抗渲染环境噪声；结论冲突以 observer 为准并记录像素 diff 数值。
- token 级核对（`get styles` 计算值）主 Agent 直接消费 JSON：颜色 ΔE ≤ 3、字号/间距/圆角 ±1px 视为一致；与 L4 估读值冲突以实测为准。

## 已知边界

- 渲染验证需要可达的目标 URL：dev server 生命周期由 agent-browser skill 约定（首个前端任务后台启动、`wait --url` 就绪探测、Finish 前统一关闭）。
- headless Linux/CI 环境依赖 `agent-browser install --with-deps` 的系统库安装成功率，失败按 fail-open 降级，不阻塞任务。
- **启动开销**：能力默认 `enabled=true`，插件 setup 时后台探测（PATH 未命中时最多 3 个子进程，npm 命令冷启动可达数百毫秒）；detached 执行不阻塞启动，介意可用 `agentBrowser.enabled=false` 关闭能力层。
- **Windows**：npm global 的 `.cmd` shim 在无 shell 的 spawn 下能否执行未经真机验证；失败仅表现为探测落空并 fail-open 降级（不崩溃）。Windows 用户建议配置 `agentBrowser.binaryPath` 指向实际可执行文件以确保探测命中。
- 浏览器验证是 real-surface 证据的**补充**，不替代单元测试/typecheck；循环预算沿用既有 ≤3 轮约定。
- 截图落盘 `<workspace>/.oceanus/media/browser/<task-id>/`，对齐 image-materializer 的 `.oceanus/media/` 约定。
