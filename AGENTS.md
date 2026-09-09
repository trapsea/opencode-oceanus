# opencode-oceanus 协作指南

## 项目定位

`opencode-oceanus` 是基于 OpenCode v2 beta 插件 API 的 TypeScript/Bun 插件，当前包版本为 `0.50.0`。它注册 Oceanus 编排器、Sisyphus 六阶段工作流、专家 agents、内置 skills、工具、运行时 hooks、CBM 集成、TUI 入口和自动更新能力。

OpenCode 版本锁定、API 事实与验证边界集中记录在 [`docs/opencode-v2-compatibility.md`](docs/opencode-v2-compatibility.md)，变更 OpenCode 依赖或宿主 API 前必须先更新该文档。

## 代码地图

| 路径 | 职责 |
|---|---|
| `src/index.ts` | CLI 插件入口、`Plugin.define`、setup 阶段及 agent/skill/command/tool/hook 接线 |
| `src/tui.tsx` | TUI sidebar 插件入口与会话/模型展示 |
| `src/agents/` | 8 个 agent 定义、工厂与编排协议 |
| `src/skills/` | 8 个内置 skill，包括 `opencode-oceanus`、6 个 Sisyphus 阶段和视觉分析 skill |
| `src/tools/` | 9 个核心工具；`src/tools/cbm/` 另有 7 个受配置门控的 CBM 工具 |
| `src/hooks/` | 工具输入输出、循环、任务登记、CBM 和图片处理保护 |
| `src/config/` | Zod schema、配置加载、preset、默认值与路径 |
| `src/runtime/` | task coordinator、任务索引、宿主桥接、workspace 与 dispatch guard |
| `src/cbm/` | CBM 下载、校验、进程、索引、MCP、CLI 与 wiring |
| `src/update/` | npm 版本检查、OpenCode 安装上下文、staging 与原子更新 |
| `src/commands/` | `/preset` 等插件命令 |
| `scripts/` | 构建产物和 skill 一致性验证 |
| `docs/` | 产品、运行时、CBM 与工作流说明 |
| `.oceanus/` | 已有任务的 spec、plan、progress、review 和 media 产物；不要把新任务状态写入既有任务文件 |

## Agent 与职责

- 主 agent：`oceanus`（默认 agent，颜色 `#0FFFFF`）、`sisyphus`（六阶段工作流）。
- 只读 subagent：`explorer`、`librarian`、`oracle`、`observer`。
- 写入/设计 subagent：`designer`、`fixer`。
- `observer` 默认禁用，需要视觉模型；只读 subagent（`explorer` / `librarian` / `oracle`）默认启用且不写任何文件、不委派、不执行 task；调研结果在回复中以七字段结构返回并在会话内复用，不落盘。
- 复杂任务遵循 `intake → discuss → plan → execute → review → finish`；执行配置由 Intake 前置的执行配置批问确认——一次 question 批量问三项（SDD/TDD/Review 循环执行），**三项默认推荐全部关闭**；仅实现类任务批问，调研/查询/方案设计等非实现类任务跳过批问并按默认关闭记录（not_asked: non-implementation）；漏答回落默认关闭并记录、不补问，Trivial 实现任务亦完整批问。Oracle 仅在复杂架构或高风险业务场景由 Sisyphus 按需调用，针对落盘 spec/plan 提供 advisory，不构成固定门禁。Review 发现 BLOCKER 后按「Review 循环执行」开关分流：开启时自动修复并重新 Review（复审闭环最多 3 轮，通过才进入 Finish）；关闭（默认）时一次性修复全部 BLOCKER 并取得当前状态验证证据后直接进入 Finish，不重新 Review；UNCERTAIN 在任何模式下都阻塞并请求用户决策。

## 修改与协作边界

1. 先读取相关入口、配置、测试和现有文档，再决定修改范围；不要凭 README 推断源码事实。
2. 保持 TypeScript strict、ESM 和现有模块边界；公共 API、宿主 API、配置契约变更要检查调用方与类型。
3. 只读 agent 不得写文件、运行 shell 或委派；`designer` 负责用户可见的布局/交互，`fixer` 负责明确且有界的机械实现。
4. 共享工作区中并行任务必须拥有完全不重叠的文件范围；worker 不得 `git add`、commit、reset、切分支或改动声明范围外文件。
5. 当前工作区可能包含用户未提交改动。开始前和结束后都检查 `git status --short`，不要重排、恢复或覆盖无关 diff。
6. 不把 mock、类型检查、skip 或降级结果表述为真实 OpenCode Host 已验证；宿主能力不足时按 fail-open 口径记录。

## 常用验证

```bash
bun install
bun run typecheck
bun test
bun run build
bun run check:dist
bun run check
```

文档-only 变更至少检查相对链接、文件范围和 `bun run typecheck`；CI 对 Markdown 和 `docs/**` 有路径忽略，不能单独依赖 CI 作为文档验收证据。

## 重要文档

- [`README.md`](README.md)：安装、配置、功能概览；遇到与源码不一致时以源码、类型和锁文件为准。
- [`docs/opencode-v2-compatibility.md`](docs/opencode-v2-compatibility.md)：OpenCode v2 beta 兼容矩阵与升级清单。
- [`docs/tooling-and-runtime.md`](docs/tooling-and-runtime.md)：工具与运行时保护。
- [`docs/codebase-memory-mcp.md`](docs/codebase-memory-mcp.md)：CBM 安装、缓存、权限和降级。
- [`docs/prompt-workflow-review-2026-08.md`](docs/prompt-workflow-review-2026-08.md)：工作流审查记录。
- [`.oceanus/spec/`](.oceanus/spec/)、[`.oceanus/plan/`](.oceanus/plan/)、[`.oceanus/review/`](.oceanus/review/)：已有任务产物；新增 SDD 文档前确认用户选择开启 SDD。
