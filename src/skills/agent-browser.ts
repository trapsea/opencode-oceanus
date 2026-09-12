import type { SkillDefinition } from './types';

/**
 * agent-browser 浏览器能力统一协议（操作 + 验证双模式单一来源）。
 *
 * 设计要点：
 * - 模式一（通用浏览器操作）：无门控，任何 agent 在调试复现、动态内容检查、
 *   交互实验等非验收场景按需使用；不需要 Intake 执行配置。
 * - 模式二（浏览器验证）：仅 Sisyphus 工作流实现类前端任务且 Intake 批问
 *   第四项 browser_verify=on 时生效；off/not_asked/不可用时验证语义不生效，
 *   但不影响模式一。
 * - 两模式共用同一能力层（探测/安装引导）与会话生命周期；
 * - 探测优先于下载：PATH → 配置 binaryPath → npm global，三级都无才引导安装，
 *   安装必须经用户确认（config agentBrowser.autoInstall=true 视为显式授权）。
 * - 全程 fail-open：命令失败/环境缺依赖时降级并记录，不阻塞任务，不伪称已验证。
 */
const AGENT_BROWSER_SKILL: SkillDefinition = {
  name: 'agent-browser',
  category: 'support',
  description:
    'agent-browser 浏览器能力统一协议：通用浏览器操作（导航等待/快照/交互/诊断/取证，任何 agent 按需使用，无需执行配置）＋浏览器验证（browser_verify 批问门控的前端渲染验收：渲染截图、视觉 diff、token 核对与交互断言）双模式；含能力探测、安装引导、会话生命周期与 fail-open 降级。',
  slash: true,
  content: `---
name: agent-browser
category: support
description: agent-browser 浏览器能力统一协议：通用浏览器操作（导航等待/快照/交互/诊断/取证，任何 agent 按需使用，无需执行配置）＋浏览器验证（browser_verify 批问门控的前端渲染验收：渲染截图、视觉 diff、token 核对与交互断言）双模式；含能力探测、安装引导、会话生命周期与 fail-open 降级。
---

# 技能：agent-browser（浏览器操作与验证统一协议）

agent-browser CLI（Rust + Chrome for Testing）的唯一使用手册。两种模式共用同一能力层与会话生命周期：

- **模式一 · 通用浏览器操作（无门控）**：任何 agent 在调试复现、动态内容检查、交互实验等非验收场景按需使用。
- **模式二 · 浏览器验证（browser_verify 门控）**：Sisyphus 工作流实现类前端任务的渲染验收协议，仅 Intake 批问第四项开启时生效。

## 模式路由（先判定再操作）

| 需求形态 | 模式 | 门控 |
|---|---|---|
| 打开/访问页面看看、检查渲染与 console 报错、复现浏览器里的 bug、填表/点击实验、动态内容检查、非验收取证 | 模式一 | 无需任何执行配置 |
| 前端交付的渲染截图/视觉 diff/token 核对/交互断言验收、L5 视觉验收、truths 取证 | 模式二 | browser_verify=on（仅 \`frontend_scope ≠ none\` 时批问出现） |

- 拿不准属于哪种：以「是否构成交付验收证据」裁决——是 → 模式二（未开启则如实告知验证能力受限，不得默认放行）；否 → 模式一。
- 模式一的操作输出可作为调试线索与事实证据记录（绑定命令与退出码），但**实验性操作不构成验收证据**；前端验收仍走模式二或人工口径。

## 能力可用性判定（两模式共用，触发后第一步，≤10 秒）
按顺序探测，命中即停：
1. \`command -v agent-browser\`（PATH）→ 可用，source=path
2. 插件配置 \`agentBrowser.binaryPath\` 显式指定且文件存在 → 可用，source=binary-path
3. \`npm ls -g agent-browser --depth=0\`（npm global）→ 可用，source=npm-global
4. 三级都无 → 用 \`question\` 询问用户是否安装（**不得静默安装**；Chrome for Testing 体积大、Linux 还需系统依赖）：
   - 同意 → \`npm install -g agent-browser && agent-browser install\`；Linux 服务器/容器追加 \`agent-browser install --with-deps\`；完成后 \`agent-browser doctor\` 自检并读取结论
   - 拒绝 → 记录 \`browser_verify: unavailable (未安装/用户拒绝安装)\`；模式二降级为人工截图/手工 QA 口径，模式一改用可用替代手段；后续阶段不再重复探测
5. 已安装但行为异常 → \`agent-browser doctor --json\` 读取诊断；仍异常按 fail-open 降级并记录原因

## 会话与 dev server 生命周期（两模式共用）
- 目标 URL 需可达：本地 dev server 用 shell 的 background 能力启动（命令以 intake 的 tech_context 为准，如 \`bun run dev\`/\`npm run dev\`）。
- 就绪探测：\`agent-browser wait --url http://localhost:<port>\`，或 \`wait <关键元素 selector>\`/\`wait --load domcontentloaded\`；**不要盲目 sleep**。
- 会话隔离：\`--session <purpose-or-task-id>\`；同一任务复用同一会话与 dev server；任务收尾统一关闭（\`agent-browser close\` + 停止后台 dev server）。
- 端口冲突/启动失败/浏览器崩溃：重试或换端口 ≤3 轮；仍失败按降级口径处理，不得无限换姿势重试。

## 模式一：通用浏览器操作（任何 agent 按需）

### 适用信号
用户提出：打开页面看看 / 在浏览器里试试 / 点一下 / 填一下 / 复现这个 bug / 看看 console 报什么 / 检查动态渲染——不涉及交付验收的浏览器交互。

### 操作命令映射
| 目的 | 命令 |
|---|---|
| 就绪/导航等待 | \`wait --url <url>\`、\`wait --load domcontentloaded\`、\`wait <selector>\` |
| 页面结构 | \`snapshot\`（取 @eN refs）→ \`find role …\` / \`find label …\` 定位 |
| 交互实验 | \`click <ref>\` / \`fill <ref> <text>\` / \`hover <ref>\`；状态复核 \`wait --fn <js>\` 或再次 \`snapshot\` |
| 计算值核对 | \`get styles <sel>\` / \`get box <sel>\`（JSON，调用方直接消费） |
| 诊断 | \`console\` / \`errors\`（控制台消息与未捕获异常） |
| 环境模拟 | \`set viewport <w> <h>\` / \`set device <name>\` / \`set media dark\` |
| 取证截图 | \`screenshot <path>\`（全页 \`--full\`；带元素编号标注 \`--annotate\`）；多命令用 \`batch\` 合并 |
| 可选证据源 | \`a11y\`（axe-core 审计）、\`vitals\`（Web Vitals：LCP/CLS/INP） |

- 优先 \`--json\` 输出供程序化判断；多命令用 \`batch\` 合并（一次进程调用完成等待→操作→断言），减少上下文占用与进程启动开销。
- 选择器优先 snapshot 的 @eN refs，其次语义定位（\`find role …\`/\`find label …\`），最后才是 CSS 选择器。
- 不确定子命令是否存在时先 \`agent-browser --help\` 核对，不臆造命令。

### 边界与纪律（模式一）
- 实验输出 ≠ 验收证据：可作为调试线索与事实记录，不写入验收矩阵；前端交付验收走模式二（或人工口径）。
- 截图落盘只由具备写权限的会话执行（主 agent / designer / fixer），路径 \`<workspace>/.oceanus/media/browser/<purpose>/\`；只读 agent（explorer/librarian/oracle）只运行无落盘命令（snapshot/find/console/errors/get styles/get box/wait），需要截图时交回主 agent。
- 登录态与凭据：不主动输入用户名、密码等凭据；实验需要登录态时以 \`question\` 交还用户，或由用户完成登录后继续。
- 严禁把截图或 base64 读入主上下文——截图文件以绝对路径交 @observer 分析。
- 不替代单元测试/typecheck：浏览器操作是 real-surface 证据的补充，不是代码证明的替代。

## 模式二：浏览器验证（browser_verify 批问门控）

### 触发条件
- Intake 执行配置批问第四项 \`browser_verify\` 为 **on**（仅前端 UI/交互实现任务会出现该批问项；\`frontend_scope ≠ none\`）；且
- 任务需要渲染表面验证：UI 还原验收（L5）、designer 视觉短反馈、交互断言或前端 real-surface 取证。
- \`browser_verify\` 为 off / not_asked（非前端任务）/ 能力不可用且用户拒绝安装 → 模式二不触发，验证语义与流程和关闭时完全一致，不得把浏览器验证写进验收口径；**模式一（通用操作）不受此门控影响**。

### 验证场景 → 命令映射
| 场景 | 命令 |
|---|---|
| 渲染截图 | \`agent-browser screenshot <path>\`（全页 \`--full\`；带元素编号标注 \`--annotate\`） |
| 视觉像素 diff | \`agent-browser diff screenshot --baseline <基准图>\`（阈值 \`-t 0.2\`） |
| token 精确核对 | \`agent-browser get styles <sel>\` / \`get box <sel>\`（计算样式与包围盒） |
| 交互断言 | \`snapshot\`（取 @eN refs）→ \`click\`/\`fill\`/\`hover\` → \`wait --fn\` 或再次 \`snapshot\` 复核状态 |

### 截图与证据落盘（模式二）
- 截图保存到 \`<workspace>/.oceanus/media/browser/<task-id>/\`（对齐 image-materializer 的 \`.oceanus/media/\` 目录约定）。
- 证据记录必须含：命令、退出码、executed_at、绑定当前 git state（对齐 review 完成矩阵的 evidence 字段要求）。
- 严禁把截图或 base64 读入主上下文——截图文件以绝对路径交给 @observer 分析。

### 与 observer / L5 验收协作
- 视觉核对必须走 @observer（主 Agent 不读原图）：把渲染截图绝对路径 + 分析目标委派 observer。
- L5 验收复用当初分析设计稿的 observer 会话（它已读过基准图）：基准图 vs agent-browser 渲染截图做取证比对。
- 像素 diff（\`diff screenshot\`）与 observer 视觉 diff 互补：像素 diff 抗语义漂移、视觉模型抗渲染环境噪声；两者结论冲突时以 observer 为准，并把像素 diff 数值记录在案。
- token 级核对（\`get styles\` 数值 JSON）由主 Agent 直接消费，无需 observer。

### token 容差表（get styles 计算值 vs 设计稿/L4 估读）
- 颜色：ΔE ≤ 3 视为一致（hex 近似值记录在案）。
- 字号/间距/圆角/边框：±1px 内一致，超出即偏差。
- get styles 计算值与 L4 估读值冲突：以 get styles（实测）为准，并回写修正 L4 的置信度记录。

### 循环预算与降级（模式二）
- designer 视觉修正循环 ≤3 轮（对齐 clipboard-image-observer 的 L5 闭环）；第 3 轮仍 FAIL → 停止自动重试，按 3 轮中断上报模板 \`question\` 上报（模板须含推荐项及理由）。
- agent-browser 命令失败/浏览器崩溃/dev server 起不来 → fail-open：降级为人工截图/手工 QA，记录 \`browser_verify: degraded (<原因>)\`；不阻塞任务、不伪称已做浏览器验证。
- 降级任务进入 Review 时，渲染类验收证据缺口按 UNCERTAIN 处理并请求用户决策，不得默认通过。

## 禁止事项
- 严禁在 \`browser_verify\`=off、not_asked 或能力不可用时执行**浏览器验证**或把浏览器验证写入该任务的验收口径（模式一的通用操作不受此限）。
- 严禁未经用户确认静默安装（npm install / Chrome for Testing 下载）。
- 严禁对 \`frontend_scope=none\` 的任务启用浏览器验证。
- 严禁把截图/base64 读入主上下文，或让 observer 产出实现代码（解析归 observer，实现归 designer/fixer）。
- 严禁用浏览器验证替代单元测试/typecheck——它是 real-surface 证据的补充，不是代码证明的替代。
`,
};

export { AGENT_BROWSER_SKILL };
