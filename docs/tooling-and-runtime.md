# 新增工具与运行时保护

本文记录 Oceanus 插件 Wave 2 新增的原生 v2 工具（Tools）与运行时保护 Hook，
以及对应的配置方式。实现细节与决策背景见
`.oceanus/spec/tooling-and-runtime-guards.md`。

## 总体说明

六阶段工作流（Intake → Brainstorm → Plan → Execute → Review → Finish）由 Agent/Skill 的
prompt 契约驱动：Agent 负责编排与委派，Skill 规定阶段边界；工具和 Hook 只提供运行时
能力，不是阶段 supervisor。Plan 必须经过 `@momus` 的 `OKAY` 后再获人工批准；Review
由 review subagent、`@momus` 复核并运行测试。Finish 只读 Review 报告，不再测试、构建、
调用 CBM、委派或写文件。

Ledger 与 Review 报告是不同契约：Ledger 记录任务 id、状态、父子关系和时间等进度视图；
Review schema 记录 success criteria、证据、发现、验证结果和结论。二者都不能把 registry
状态或 CBM（仅 advisory 依赖）提升为宿主事实，也不能用 advisory 结果替代权限门控。

- 新增 Tool 与 Hook 默认全部启用。
- 通过 `ctx.tool.transform` 注册工具、`ctx.tool.hook` 注册 Hook。
- 工具与 Hook 各自独立容错：单个初始化或执行失败不阻止其它 Hook 与插件启动。
- 工具一律以结构化 result 返回错误，不抛异常。
- 不引入 v1 client/session shim，不重复实现宿主已有的 `read` / `glob` / `grep` /
  `edit` / `webfetch` / `question` / `subagent`。

## 内置工具

### AST：`ast_grep_search` / `ast_grep_replace`

- `ast_grep_search`：按 AST 语法模式搜索（只读）。支持 `$VAR` / `$$$` 元变量、
  语言（`lang`）、路径（`paths`）、glob（`globs`）、上下文行数（`context`）、
  匹配数上限（`maxMatches`）、输出字节上限（`maxOutputBytes`）与超时（`timeoutMs`）。
- `ast_grep_replace`：查找并替换。**默认 dry-run**（只预览改写结果，不改写文件）；
  显式 `dryRun: false` 才真正写入。只改写工作区内文件。
- 两个工具都要求真实 ast-grep CLI；缺失时返回诊断信息。

### `hashline_edit`

- 按文件行 hash 锚点执行 `replace` / `append` / `prepend`，校验文件版本并返回
  结构化 diff。
- 使用前先 `read` 获取行 hash；hash mismatch（文件已被改动）时返回可操作的重新
  读取提示，**不会静默重试**，需要重新 `read` 后再次编辑。
- 目标文件必须位于工作区内，受文件大小上限（`maxFileBytes`）约束。
- 删除 / 重命名能力在路径安全检查明确前不开放。

### task 三件套：`task_status` / `task_result` / `task_cancel`

围绕 Oceanus 轻量 task registry + v2 session API 实现，只管理本插件创建的后台子任务。

- `task_status`：查询任务状态。只读；仅可访问当前 session 能访问的任务；优先使用运行时
  可用的宿主 session 事实（`session.active` / `session.get` / 事件快照），当前 beta
  插件类型未暴露 `session.active` 时诚实降级为 `session.get` / registry，并标记未验证。
- `task_result`：读取**已完成**任务的最终结果。只接受「宿主已验证的终态」或
  「registry 中明确存储的终态观察结果」，否则返回错误；不会把 registry 的
  `completed` 状态本身当作宿主事实。
- `task_cancel`：取消任务，中断其子 session 并通过宿主状态验证。调用方必须是任务的
  父或子 session；可传 `parentID` / `childID` 交叉校验 ownership。仅当宿主确认
  interrupt 成功、session 不再 active、且 outcome 明确为 `interrupted` / `succeeded`
  时才报告 `cancelled`，否则返回结构化错误，不伪造取消结果（interrupt 失败但
  outcome 已为自然终态时同样不伪造 cancelled）。

## 内置 Hook

固定执行顺序：

```text
before: apply-patch → loop-guard.before → task-registry-observer.before
after:  json-error-recovery → tool-output-truncator → tool-loop-guard → task-registry-observer.after
```

| Hook | 作用 | fail-open / fail-closed 边界 |
|------|------|------------------------------|
| `apply_patch` | 校验并保守规范化 `apply_patch` 输入：解析 Codex 风格 patch、路径边界、无损重写（CRLF→LF、heredoc 去包裹、空白裁剪、路径 `\`→`/`），以“重写前后语义等价”为校验闸门 | 工作区外路径、只读 `event.input` → **fail-open**（交由宿主处理）；输入形状无效、校验失败、内部异常 → **fail-closed**（抛错阻断执行）。无法解析工作区根时跳过校验（fail-open） |
| `json_error_recovery` | 修正工具返回的错误 JSON，避免错误被当作结果吞掉 | after Hook 默认 **fail-open** |
| `tool_output_truncator` | 截断超长工具输出，避免破坏上下文；保留错误、状态、diff 与 hash mismatch 等控制信息 | **fail-open** |
| `tool_loop_guard` | 检测重复工具调用：达到 `warnAt` 提示、`blockAt` 熔断；不阻止合法 task polling | **fail-open** |
| `task_registry_observer` | 观察宿主 `task` / `subagent` 的 before/after，把明确可识别的任务记录写入本地 task registry（任务 id、父子 ownership、观察到的 child session、受限结果摘要） | **fail-open**：不拦截、不抛错；未知结果形状不猜测、不伪造 child session 与终态 |

> after Hook 默认 fail-open：保护逻辑失败不阻断已完成的宿主工具结果。

## 配置

配置位于用户级 `~/.config/opencode/opencode-oceanus.jsonc` 与项目级
`.opencode/opencode-oceanus.jsonc`（项目优先）。相关字段：

```jsonc
{
  "disabled_tools": ["task_cancel"],
  "disabled_hooks": [],
  "tools": {
    "ast_grep_search": { "enabled": true, "timeoutMs": 30000, "maxMatches": 200, "maxOutputBytes": 262144 },
    "ast_grep_replace": { "enabled": true, "dryRun": true },
    "hashline_edit": { "enabled": true, "maxFileBytes": 1048576 },
    "task_status": { "enabled": true },
    "task_result": { "enabled": true },
    "task_cancel": { "enabled": true }
  },
  "hooks": {
    "apply_patch": { "enabled": true },
    "tool_output_truncator": { "enabled": true, "maxOutputBytes": 200000 },
    "json_error_recovery": { "enabled": true },
    "tool_loop_guard": { "enabled": true, "warnAt": 3, "blockAt": 5, "maxSessions": 512 },
    "task_registry_observer": { "enabled": true }
  }
}
```

配置规则：

1. 未配置时默认全部启用。
2. `disabled_tools` / `disabled_hooks` 对对应名称拥有最终禁用权。
3. 单项 `enabled: false` 等价于禁用。
4. 优先级：`disabled_*` > `item.enabled` > 默认 `true`。
5. 项目配置覆盖用户配置；`tools` / `hooks` 按名称深合并，同一项只覆盖显式字段；
   `disabled_tools` / `disabled_hooks` 作为数组整体由项目配置覆盖用户配置。
6. 未知工具名、Hook 名或配置字段会被 schema 拒绝，而不是静默忽略。

工具与 Hook 可用字段：

- `tools`（`ToolConfigSchema`）：`enabled`、`timeoutMs`、`maxMatches`、
  `maxOutputBytes`、`dryRun`、`maxFileBytes`。
- `hooks`（`HookConfigSchema`）：`enabled`、`maxOutputBytes`（truncator）、
  `warnAt` / `blockAt` / `maxSessions`（loop guard）。

## AST CLI 安装与诊断

`ast_grep_search` / `ast_grep_replace` 依赖真实 ast-grep CLI。插件不自动下载二进制。

解析顺序：

1. `AST_GREP_BIN` 环境变量显式覆盖
2. 缓存目录二进制
3. `@ast-grep/cli` 包（优先 `ast-grep`，回退 `sg`）
4. 平台专属包（如 `@ast-grep/cli-linux-x64-gnu`）
5. PATH 上的 `ast-grep` / `sg`

每个候选在接受前执行短超时 `--version` 验证，输出必须包含 `ast-grep`，从而拒绝
同名但非 ast-grep 的程序（如 Linux 上作为 `newgrp` 别名的 `sg`）。

安装方式：

```bash
bun add -D @ast-grep/cli   # 或 cargo install ast-grep、brew install ast-grep
```

或设置 `AST_GREP_BIN=/path/to/ast-grep` 指向已有二进制。

环境中没有真正可用的 ast-grep 时，工具返回诊断信息；测试
（`src/smoke/host-smoke.test.ts`、`src/smoke/ast-grep-probe.ts`）会**明确 skip 真实
CLI 集成并输出诊断**，不把环境缺失误报为产品失败。

## 测试与验证

- 单元测试覆盖工具参数、CLI 解析、hashline 编辑、task registry 与各 Hook。
- `src/smoke/host-smoke.test.ts` 在 bun test 下用 mock ctx 验证注册契约（默认 6 个
  工具 + 6 个 hooks，其中 3 个 before + 4 个 after 注册）。
- 真实 ast-grep CLI 集成测试仅在探针确认可用时运行（`describe.skipIf`）。
- 真实 OpenCode v2 host 能力（`session.active` / `interrupt` 等）只在 opencode 会话内
  执行插件时验证；无真实 host 时相关 smoke 会 skip，**不声称真实 host 已通过**。

## 不在范围

以下能力不作为本项目原生工具提供：`context7`、`gh_grep`、`task_message`、
`task_revive`、完整 BackgroundJobBoard / parent-wake / generation fence、
v1 `PluginInput` / client shim、multiplexer / team mode / ACP / smartfetch /
session-manager、telemetry 与长期 memory。
