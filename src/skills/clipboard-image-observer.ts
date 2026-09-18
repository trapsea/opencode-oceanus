import type { SkillDefinition } from './types';

/**
 * 图片处理统一流程手册：落盘 → 分级（L1-L5）→ 分级委派 observer → 整合。
 * clipboard_image 工具负责落盘，observer 按主 Agent 声明的级别模板输出；
 * 分级不是前端专属，而是主 Agent 按任务理解订购不同深度的分析。
 */
const CLIPBOARD_IMAGE_OBSERVER_SKILL: SkillDefinition = {
  name: 'clipboard-image-observer',
  category: 'media',
  description:
    '统一图片流程：将粘贴/截图图片落盘，按任务理解划分分析深度（L1-L5），使用匹配的输出模板委派 @observer，并整合结构化结果。前端还原任务还需遵循 designer/fixer 分工，以 L5 视觉验收作为完成门禁。',
  slash: true,
  content: `---
name: clipboard-image-observer
category: media
description: 统一图片流程：将粘贴/截图图片落盘，按任务理解划分分析深度（L1-L5），使用匹配的输出模板委派 @observer，并整合结构化结果。前端还原任务还需遵循 designer/fixer 分工，以 L5 视觉验收作为完成门禁。
---

# 技能：clipboard-image-observer（图片落盘 + Observer 分级分析统一流程）

## 触发条件
- 用户粘贴/提到截图、图片，且出现“当前不支持图片输入”类错误；或
- 用户消息包含已物化的图片路径（[oceanus] 已物化图片附件: ...）；或
- 任何需要理解图片/截图/图表/PDF 视觉内容的任务（含前端 UI 还原、报错截图解读、图表解读等）。

## 核心原则
- 主 Agent（Oceanus/Sisyphus）**全程不读原始图片**；细节只存在于「图文件 + observer 输出」，主 Agent 只持有契约。
- 分级（L1-L5）不是前端专属：它是主 Agent 在**任务识别阶段**按对任务的理解订购不同深度分析的方式。前端还原只是 L3-L5 的典型消费方。

## 固定流程（严格按序执行）

### 1. 获取文件路径
   a. 消息中已有 [oceanus] 物化路径 → 直接使用
   b. 否则调用 clipboard_image 工具 → 读取返回的绝对路径
   c. 都不可用 → 请用户保存图片并告知路径；不要虚构图片内容

### 2. 校验
   路径必须是绝对路径且文件存在（clipboard 等伪路径一律拒绝）。

### 3. 分级（任务识别时完成，≤10 秒决策）
决策树：
- 图需要"还原/比对"吗？
  - 否 → 只看一眼/判断相关性 → **L1**；需要盘点内容做规划 → **L2**
  - 是 → 像素敏感（设计稿/品牌视觉/验收基准）→ **L4**
       → 普通页面 → **L3**（默认档）
  - 双图对比（验收：基准图 vs 渲染截图）→ **L5**

判据补充：用户原话含"还原/照着做/设计稿/像素/品牌"→ 至少 L3；只问"图里有什么/帮我看看" → L1/L2；拿不准一律 L3；可对关键区域追加 L4，禁止无差别全局 L4。

### 4. 分级派发 observer
- description 标注 lane：\`lane:fe-observe-L{n}\`（或 \`lane:observe-L{n}\`，非前端场景）
- prompt **首行**声明："本任务为 L{n} 级分析，严格按 L{n} 模板输出，不输出更高级内容。"，并包含图片**绝对路径**与分析目标
- 各级输出模板：
  - **L1 概览识别**：图类型 | 主题 | 主要区域（一句话/区域）| 是否含可操作元素
  - **L2 结构识别**：①组件清单（名称/类型/估计层级）②可见功能点（可点击/输入/滚动）③标题级文案 ④异常/缺失（模糊、截断、占位图）
  - **L3 标准还原（默认档）**：①布局树（容器层级+排列+对齐）②设计token（主色/背景/文字色 hex 近似、字号/间距档位、圆角/阴影）③组件清单+可见状态（hover/disabled 等）④逐字文案清单 ⑤不确定项清单
  - **L4 精确还原**：L3 全项 + ⑥逐项估读（每个间距/字号数值估计+置信度 高/中/低）⑦栅格推断（列数/边距/内容最大宽度）⑧颜色逐个取值并注明来源 ⑨字重/字族线索。纪律：不确定必须标低置信度，**禁止编造确定值**
  - **L5 取证比对**：输入基准图路径+对比图路径+契约项清单；输出逐契约项 PASS/FAIL+证据（两图位置描述）+偏差描述；总结 FAIL 数与严重级（布局错位 > 颜色偏差 > 文案差异 > 细节）

### 5. 整合
- 回收 observer 的结构化结论；不重复读取原始图片
- 「不确定项清单」是向用户 question 澄清的**唯一来源**；禁止 observer 以猜测替代用户决策

### 6. 会话复用
- L5 验收必复用当初分析的 observer 会话（它已读过基准图），不重开

## 前端消费场景（L3-L5 的典型下游，非本 skill 的全部）
- designer（\`lane:fe-ui\`）：**亲自读原图 + spec** 实现视觉层（组件/样式/交互态/响应式），交付时必须声明接口契约（props/事件回调/数据形状）；browser_verify 开启时配合 agent-browser skill 的视觉短反馈（完成即截图自查，不等验收）；designer 是独立 subagent 会话、不继承主会话已加载的 skill 内容，委派 prompt 必须显式指示其执行浏览器操作前先加载 agent-browser skill，并携带 browser_verify 配置上下文
- fixer（\`lane:fe-logic\`）：按契约实现非视觉部分（API/状态/校验/类型），**禁改样式、布局、类名**
- 组件与数据严格分文件 → 可同 Wave 并行；同一文件 → 串行（designer 先交带 mock 数据的组件）
- 验收：实现后取得渲染截图（browser_verify 开启时先加载 agent-browser skill，再经 agent-browser 自动截图，命令与落盘协议以其为唯一来源；关闭或不可用时由用户人工提供截图）→ observer（复用会话）执行 L5 diff → FAIL 退回 designer（≤3 轮，第 3 轮仍 FAIL → 停止自动重试，按 3 轮中断上报模板用 \`question\` 上报：模板须含推荐项及理由）；全 PASS 才进 Completion Audit。L3 验收核对"组件齐全+文案逐字"（token 允许合理近似，browser_verify 开启时可用 \`get styles\` 实测值按容差表核对）；L4 全项核对（token 偏差也计 FAIL，实测值以 \`get styles\` 为准）；L1/L2 无需视觉验收
- Sisyphus 在 Intake 任务识别时即完成分级，分级结果写入 intake_report

## 禁止事项
- 严禁在未获得 observer 结论前描述/猜测图片内容
- 严禁把原始图片读入主会话上下文（即使主模型支持视觉，也优先 observer 隔离大文件）
- 严禁向 observer 传相对路径或 "clipboard" 伪路径
- 严禁跳过分级直接派 observer（"千图一律"全量分析）
- 严禁让 observer 产出 HTML/代码替代实现（解析归 observer，实现归 designer/fixer）
- 严禁无 L5 PASS 证据即宣称 UI 还原任务完成
`,
};

export { CLIPBOARD_IMAGE_OBSERVER_SKILL };
