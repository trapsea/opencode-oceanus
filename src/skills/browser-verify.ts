import type { SkillDefinition } from './types';

/**
 * agent-browser 前端渲染验证协议（browser_verify 执行配置第四项的运行时手册）。
 *
 * 设计要点：
 * - 仅在 Intake 批问第四项 browser_verify=on（只对前端 UI/交互实现任务出现）
 *   且能力可用时生效；off/not_asked/不可用时本 skill 不触发，流程与现状一致。
 * - 探测优先于下载：PATH → 配置 binaryPath → npm global，三级都无才引导安装，
 *   安装必须经用户确认（config agentBrowser.autoInstall=true 视为显式授权）。
 * - 全程 fail-open：命令失败/环境缺依赖时降级为人工截图/手工 QA 口径并记录，
 *   不阻塞任务，不伪称已做浏览器验证。
 */
const BROWSER_VERIFY_SKILL: SkillDefinition = {
  name: 'browser-verify',
  category: 'support',
  description:
    '浏览器验证协议：browser_verify 执行配置开启时，用 agent-browser CLI 对前端 UI 还原与交互实现做渲染截图、视觉 diff、token 核对与交互断言；含能力探测、安装引导、dev server 生命周期与 fail-open 降级口径。',
  slash: true,
  content: `---
name: browser-verify
category: support
description: 浏览器验证协议：browser_verify 执行配置开启时，用 agent-browser CLI 对前端 UI 还原与交互实现做渲染截图、视觉 diff、token 核对与交互断言；含能力探测、安装引导、dev server 生命周期与 fail-open 降级口径。
---

# 技能：browser-verify（agent-browser 前端渲染验证协议）

## 触发条件
- Intake 执行配置批问第四项 \`browser_verify\` 为 **on**（仅前端 UI/交互实现任务会出现该批问项；\`frontend_scope ≠ none\`）；且
- 任务需要渲染表面验证：UI 还原验收（L5）、designer 视觉短反馈、交互断言或前端 real-surface 取证。
- \`browser_verify\` 为 off / not_asked（非前端任务）/ 能力不可用且用户拒绝安装 → 本 skill 不触发，任何阶段不得执行 agent-browser 命令或把浏览器验证写进验收口径，流程与无本技能时完全一致。

## 能力可用性判定（触发后第一步，≤10 秒）
按顺序探测，命中即停：
1. \`command -v agent-browser\`（PATH）→ 可用，source=path
2. 插件配置 \`agentBrowser.binaryPath\` 显式指定且文件存在 → 可用，source=binary-path
3. \`npm ls -g agent-browser --depth=0\`（npm global）→ 可用，source=npm-global
4. 三级都无 → 用 \`question\` 询问用户是否安装（**不得静默安装**；Chrome for Testing 体积大、Linux 还需系统依赖）：
   - 同意 → \`npm install -g agent-browser && agent-browser install\`；Linux 服务器/容器追加 \`agent-browser install --with-deps\`；完成后 \`agent-browser doctor\` 自检并读取结论
   - 拒绝 → 记录 \`browser_verify: unavailable (未安装/用户拒绝安装)\`，本任务降级为人工截图/手工 QA 口径，后续阶段不再重复探测
5. 已安装但行为异常 → \`agent-browser doctor --json\` 读取诊断；仍异常按 fail-open 降级并记录原因

## 场景 → 命令映射

| 场景 | 命令 |
|---|---|
| 渲染截图 | \`agent-browser screenshot <path>\`（全页 \`--full\`；带元素编号标注 \`--annotate\`） |
| 视觉像素 diff | \`agent-browser diff screenshot --baseline <基准图>\`（阈值 \`-t 0.2\`） |
| token 精确核对 | \`agent-browser get styles <sel>\` / \`get box <sel>\`（计算样式与包围盒） |
| 交互断言 | \`snapshot\`（取 @eN refs）→ \`click\`/\`fill\`/\`hover\` → \`wait --fn\` 或再次 \`snapshot\` 复核状态 |
| 前端调试 | \`agent-browser console\` / \`errors\`（控制台消息与未捕获异常） |
| 响应式/暗色 | \`set viewport <w> <h>\` / \`set device <name>\` / \`set media dark\` |
| 可选证据源 | \`a11y\`（axe-core 审计）、\`vitals\`（Web Vitals：LCP/CLS/INP） |

- 优先 \`--json\` 输出供程序化断言；多命令用 \`batch\` 合并（一次进程调用完成 open→wait→screenshot→断言），减少上下文占用与进程启动开销。
- 选择器优先 snapshot 的 @eN refs，其次语义定位（\`find role …\`/\`find label …\`），最后才是 CSS 选择器。

## dev server 生命周期
- 首个需要渲染验证的任务：用 shell 的 background 能力启动 dev server（命令以 intake 的 tech_context 为准，如 \`bun run dev\`/\`npm run dev\`）。
- 就绪探测：\`agent-browser wait --url http://localhost:<port>\`，或 \`wait <关键元素 selector>\`/\`wait --load domcontentloaded\`；**不要盲目 sleep**。
- 会话内复用同一 dev server 与浏览器实例（\`--session <task-id>\` 隔离多任务）；Finish 前统一关闭（\`agent-browser close\` + 停止后台 dev server）。
- 端口冲突/启动失败：重试或换端口 ≤3 轮；仍失败按降级口径处理，不得无限换姿势重试。

## 截图与证据落盘
- 截图保存到 \`<workspace>/.oceanus/media/browser/<task-id>/\`（对齐 image-materializer 的 \`.oceanus/media/\` 目录约定）。
- 证据记录必须含：命令、退出码、executed_at、绑定当前 git state（对齐 review 完成矩阵的 evidence 字段要求）。
- **严禁把截图或 base64 读入主上下文**——截图文件以绝对路径交给 @observer 分析。

## 与 observer / L5 验收协作
- 视觉核对必须走 @observer（主 Agent 不读原图）：把渲染截图绝对路径 + 分析目标委派 observer。
- L5 验收复用当初分析设计稿的 observer 会话（它已读过基准图）：基准图 vs agent-browser 渲染截图做取证比对。
- 像素 diff（\`diff screenshot\`）与 observer 视觉 diff 互补：像素 diff 抗语义漂移、视觉模型抗渲染环境噪声；两者结论冲突时以 observer 为准，并把像素 diff 数值记录在案。
- token 级核对（\`get styles\` 数值 JSON）由主 Agent 直接消费，无需 observer。

## token 容差表（get styles 计算值 vs 设计稿/L4 估读）
- 颜色：ΔE ≤ 3 视为一致（hex 近似值记录在案）。
- 字号/间距/圆角/边框：±1px 内一致，超出即偏差。
- get styles 计算值与 L4 估读值冲突：以 get styles（实测）为准，并回写修正 L4 的置信度记录。

## 循环预算与降级
- designer 视觉修正循环 ≤3 轮（对齐 clipboard-image-observer 的 L5 闭环）；第 3 轮仍 FAIL → 停止自动重试，按 3 轮中断上报模板 \`question\` 上报（模板须含推荐项及理由）。
- agent-browser 命令失败/浏览器崩溃/dev server 起不来 → fail-open：降级为人工截图/手工 QA，记录 \`browser_verify: degraded (<原因>)\`；不阻塞任务、不伪称已做浏览器验证。
- 降级任务进入 Review 时，渲染类验收证据缺口按 UNCERTAIN 处理并请求用户决策，不得默认通过。

## 禁止事项
- 严禁 \`browser_verify\`=off、not_asked 或能力不可用时执行任何 agent-browser 命令，或把浏览器验证写入该任务的验收口径。
- 严禁未经用户确认静默安装（npm install / Chrome for Testing 下载）。
- 严禁对 \`frontend_scope=none\` 的任务启用浏览器验证。
- 严禁把截图/base64 读入主上下文，或让 observer 产出实现代码（解析归 observer，实现归 designer/fixer）。
- 严禁用浏览器验证替代单元测试/typecheck——它是 real-surface 证据的补充，不是代码证明的替代。
`,
};

export { BROWSER_VERIFY_SKILL };
