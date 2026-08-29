# 剪贴板图片 → Observer 视觉分析：完整解决方案

> 背景：orchestrator（主 agent）模型可能不支持视觉输入，用户粘贴图片时宿主直接报
> `Cannot read "clipboard" (this model does not support image input)`，图片在
> 宿主→主模型环节即丢失；而 observer / designer 子 agent 配置的是视觉模型，
> 但其输入通道只接受文件路径。本方案打通"剪贴板图片落盘 → 路径移交 → observer
> 结构化分析"全链路，并把固定流程沉淀为 skill。

## 1. 问题拆解（三个断点）

| 断点 | 位置 | 现状 |
|---|---|---|
| A. 宿主→主模型 | 粘贴图片以 `"clipboard"` 为输入源直喂主模型，非视觉模型报错，图片丢失 | 无拦截 |
| B. 图片未落盘 | observer 是视觉模型但只读文件路径；剪贴板图片不是文件 | 无物化机制 |
| C. 路由缺失 | 即使落盘，也无确定性机制保证主 agent 转交 observer | 仅 system prompt 软规则 |

## 2. 总体架构

```
用户粘贴图片
   │
   ▼
[阶段二] session.hook("prompt") 图片物化 hook（自动，抢在喂模型之前）
   │  data:/clipboard 图片附件 → .oceanus/media/<sessionID>/<hash>.png
   │  非视觉主模型：从 files 移除图片 part，文本追加路径指引
   ▼
主 agent 收到文本提示（含文件路径 或 "剪贴板有图未落盘"提示）
   │
   ├─ [阶段一] clipboard_image 工具：agent 主动调用，读剪贴板落盘并返回路径
   │
   ▼
[skill] clipboard-image-observer：固定流程（取路径→校验→委派→回收结论）
   │
   ▼
subagent(observer, {path, 分析目标}) → 结构化文本结论回主会话
```

> 设计原则：**不注册用户 command**。command 是用户手动触发的入口，而本流程的
> 主体是 agent——剪贴板读取沉淀为 agent 可调用的工具（clipboard_image），
> 流程编排沉淀为 skill，全程 agent 自主闭环，用户零额外操作。

## 3. 组件设计

### 3.1 剪贴板读取平台策略表（零第三方下载）

按"环境变量就绪 + 工具存在"逐级探测，**不按 platform 猜测**：

| 顺序 | 条件 | 命令 | 备注 |
|---|---|---|---|
| 1 | `WAYLAND_DISPLAY` 存在且 `wl-paste` 可用 | `wl-paste -t image/png` / `-t image/bmp` | WSLg 场景走这里（Windows 剪贴板经 WSLg 双向同步，已实测） |
| 2 | `DISPLAY` 存在且 `xclip` 可用 | `xclip -selection clipboard -t image/png -o` | X11 |
| 3 | `powershell.exe` 在 PATH（WSL interop，`WSL_DISTRO_NAME` 存在更优先判定） | 见 3.1.1 | WSLg 关闭时的兜底 |
| 4 | `process.platform === 'win32'` | 同 3.1.1 | cmd/任意终端均可：PowerShell 是独立 exe，与父 shell 无关 |
| 5 | `process.platform === 'darwin'` | `osascript`（JXA + ObjC 桥读剪贴板 PNG） | 不用 brew 的 pngpaste |
| 都不满足 | — | 回写"当前环境无法读取剪贴板，请保存图片到 <媒体目录> 并告知路径" | fail-open，绝不自动安装任何系统包 |

#### 3.1.1 Windows PowerShell 分支

```powershell
powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms;
  $img=[Windows.Forms.Clipboard]::GetImage();
  if($img){$img.Save('<abs-path>', [System.Drawing.Imaging.ImageFormat]::Png)}"
```

- `-Command` 内联不受执行策略限制，无需 `-ExecutionPolicy Bypass`
- `-NoProfile` 必加（避免 profile 拖慢/污染输出）
- 只写文件不回读 stdout，规避 PowerShell 5.1 GBK 编码问题；若需回读文本先设
  `[Console]::OutputEncoding=[Text.Encoding]::UTF8;`
- 退出码 0 且文件存在 = 成功；`$img` 为 null = 剪贴板无图 → 走"无图片"回写分支
- headless Windows（无交互桌面会话）取不到剪贴板 → 归入 fail-open 兜底

### 3.2 落盘规范

- 目录：`<workspace>/.oceanus/media/<sessionID>/`
- 文件名：内容 hash（幂等，prompt hook 要求 retry-safe，重复触发不重复写盘）
- 格式归一化为 PNG：
  - PowerShell 分支：`Save(..., ImageFormat.Png)` 直接输出 PNG
  - Linux `wl-paste` 只给 BMP 时：插件内纯 JS 解码 BMP→PNG（npm 纯 JS 依赖，
    随插件安装，不算下载第三方工具）；解码失败则保存 BMP 原件并注明
    "observer 的 read 通常也能读 BMP"
- 路径一律绝对路径（`node:path` 拼接，Windows 形如 `C:\...`），交给 observer 前不手拼 `/`

### 3.3 阶段一：`clipboard_image` 工具 + 提示词补丁 + skill

**`clipboard_image` 工具**（新文件 `src/tools/clipboard-image.ts`，走
`ctx.tool.transform` 注册，codemode）：

- 输入：`{}`（无参数；可选 `format: "png" | "raw"`，默认 png）
- 行为：
  1. 执行 3.1 平台策略表 → 读剪贴板 → 落盘到媒体目录 → 返回
     `{ content: "已保存剪贴板图片: <绝对路径>" }`
  2. 剪贴板无图：返回 `"剪贴板中没有图片"`
  3. 平台无可用工具：返回明确指引（"当前环境无法读取剪贴板，请让用户保存图片到
     <媒体目录> 并告知路径"）
  4. 任何分支都不抛异常（fail-open，与现有工具语义一致）
- 平台策略表实现为独立纯函数模块 `src/tools/clipboard/platforms.ts`（探测+读取+
  转换分离，便于 mock 单测）

**提示词补丁**（`src/agents/oceanus.ts`）：

> 若用户消息包含图片而你收到 "does not support image input" 类错误，或用户提到
> 截图/粘贴图：不要描述或猜测图片内容，调用 clipboard_image 工具获取文件路径
> （或请用户保存文件并告知路径），然后按 clipboard-image-observer skill 的流程
> 将完整绝对路径 + 分析目标委派给 @observer；绝不虚构图片内容。

`src/agents/observer.ts` 补一句：只接受绝对路径，拒绝 `clipboard` 之类的伪路径。

### 3.4 阶段二：`session.hook("prompt")` 自动物化

```ts
await ctx.session.hook("prompt", (event) => {
  for (const f of event.prompt.files ?? []) {
    // 图片附件（data: URI 或 mime image/*）→ 物化到媒体目录
    // 幂等文件名（内容 hash），retry-safe
  }
  // orchestratorVision === false 时：移除图片 part（避免宿主报错），
  // 仅在 event.prompt.text 末尾追加：
  //   [oceanus] 已物化图片附件: <路径>。当前模型不支持视觉，
  //   请将路径与分析目标委派给 @observer。
  // vision 为 true/auto 时：保留图片（file:// 替换 data:），同样追加路径提示
})
```

关键点：
- prompt hook 在附件解析阶段运行且可改写 `files`，是唯一能抢在宿主把图片喂给
  非视觉模型之前拦截的位置
- `files` 换成 `file://` 后，最坏情况宿主丢弃该 part，文本路径提示仍在，主 agent
  仍有路可走
- hook 必须保持 owned draft 可变性约束：改写 text 时同步处理 mention 偏移
  （本方案只做末尾追加，不影响已有偏移）

**视觉能力配置**（`src/config/schema.ts` + utils）：
`orchestratorVision: "auto" | true | false`，默认 `"auto"`（保留图片 + 追加提示）。
不做运行时探测（provider 报错格式不可靠），由用户声明。

### 3.5 阶段二：`observer_analyze` 工具（可选增强）

`ctx.tool.transform` 注册 codemode 工具，输入 `{ path, question }`，内部复用
`src/runtime/subagent-bridge.ts` 派发 observer 子会话并等待终态，返回结构化文本。
主 agent 一个工具调用完成"图→observer→结论"，与 Task Board 生命周期天然集成。

### 3.6 错误兜底：retry hook

`ctx.session.hook("retry")` 识别 `does not support image input` 类错误：
不改 retry 决策（重试无意义），通过 `ctx.session.synthetic` 注入提示：
"当前模型不支持图片，请调用 clipboard_image 工具获取路径后按 skill 委派 @observer"，
避免用户再遇到静默失败。

## 4. Skill：clipboard-image-observer（固定流程沉淀）

将"落盘 + observer 解析"梳理为 skill（`src/skills/` 注册，或
`.opencode/skills/clipboard-image-observer.md`），供主 agent 命中场景时加载：

```markdown
# Skill: clipboard-image-observer

## 触发条件
- 用户粘贴/提到截图、图片，且出现 "does not support image input" 类错误；或
- 用户消息包含已物化的图片路径（[oceanus] 已物化图片附件: ...）；或
- 你（主 agent）无法查看但需要理解某图片文件内容。

## 固定流程（严格按序执行）
1. 获取文件路径
   a. 消息中已有 [oceanus] 物化路径 → 直接使用
   b. 否则调用 clipboard_image 工具 → 读取返回的绝对路径
   c. 都不可用 → 请用户保存图片并告知路径；不要虚构图片内容
2. 校验：路径必须是绝对路径且文件存在（clipboard 等伪路径一律拒绝）
3. 委派 observer（必须包含完整上下文，子 agent 无父会话隐含上下文）：
   subagent({ agent: "observer", prompt: "读取图片 <绝对路径>。<分析目标：
   描述 UI 元素/提取文字/解读图表等>。用中文返回结构化结果，标注不确定项。" })
4. 回收 observer 的结构化结论，整合进当前任务；不重复读取原始图片
5. 若结论标注了不确定项且影响决策 → 向用户确认，不要基于猜测推进

## 禁止事项
- 严禁在未获得 observer 结论前描述/猜测图片内容
- 严禁把原始图片读入主会话上下文（即使主模型支持视觉，也优先 observer 隔离大文件）
- 严禁向 observer 传相对路径或 "clipboard" 伪路径
```

skill 与 3.3 的提示词补丁配合：补丁是"何时走"的路由规则，skill 是"怎么走"的
步骤手册，二者职责分离。

## 5. 文件映射与工作量

| 步骤 | 文件 | 量级 | 阶段 |
|---|---|---|---|
| clipboard_image 工具 | `src/tools/clipboard-image.ts` + 注册 | 小 | 一 |
| 剪贴板平台策略表 | `src/tools/clipboard/platforms.ts`（探测+读取+转换，纯函数可测） | 中 | 一 |
| 提示词补丁 | `src/agents/oceanus.ts`、`src/agents/observer.ts` | 很小 | 一 |
| skill 注册 | `src/skills/` 新增 | 小 | 一 |
| prompt hook 物化 | `src/hooks/image-materializer.ts` + `src/hooks/index.ts` | 中 | 二 |
| vision 配置 | `src/config/schema.ts` + `src/config/utils.ts` | 小 | 二 |
| observer_analyze 工具 | `src/tools/` 新增，复用 subagent-bridge | 中 | 二（可选） |
| retry hook 兜底 | `src/hooks/image-error-hint.ts` | 小 | 二 |

## 6. 边界与风险

- **prompt hook 非精确一次语义**：文档明确 hook 可能并发重入，物化必须幂等（内容 hash 文件名）
- **WSLg 掉线**：策略表顺序 1 失败自动落到顺序 3（powershell.exe interop），行为连续
- **超大图片**：媒体目录在 workspace 内，`.gitignore` 需追加 `.oceanus/media/`（或写入 `# oceanus-media` 注释段），避免误提交
- **隐私**：图片含敏感信息时 observer 结论已脱敏要求"标注不确定项"；媒体目录保留策略可后续加 TTL 清理
- **headless 环境**：所有探测失败 → fail-open 回写人工指引，绝不阻塞主流程

## 7. 验收标准

1. WSLg 环境：粘贴图片 → agent 调用 clipboard_image 工具落盘 → observer 返回结构化描述（本机已具备验证条件）
2. 阶段二后：粘贴图片主模型不再报错，主 agent 收到路径提示并自动委派 observer
3. 剪贴板无图/无可用工具时工具返回明确指引，无异常抛出
4. `wl-paste`/`xclip`/`powershell.exe`/`osascript` 各分支有单测（mock 探测结果）
5. skill 被正确注册并可在 skill 列表中发现，skill 流程不依赖任何用户 command
