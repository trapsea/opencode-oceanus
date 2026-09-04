# 提示词与说明文本中文化
Status: approved

## Goal
全面梳理并中文化仓库中注入模型、展示给用户或描述工作流的提示词、用户文案、README、docs 与代码注释，消除不必要的中英文混杂。

## Context
提示词主要由 `src/agents/`、`src/skills/`、`src/hooks/`、`src/config/constants.ts` 与 `src/cbm/registry.ts` 生成或注入；README 与 `docs/` 记录同一工作流。当前文本大量使用英文标题和句子，且与中文规则混杂。

## Scope
- 中文化所有模型可见的 agent system prompt、skill 正文、共享协议、CBM guidance、错误恢复提示与用户可见描述。
- 中文化 README、docs 以及相关源码注释中的自然语言说明。
- 保持模板插值、代码块、命令、API、工具名、agent 名、状态值、路径、文件名、代码标识符、协议字段和第三方专有名词不变。
- 增加或调整机械检查，确认关键提示词不再包含可翻译的英文句子。

## Non-goals
- 不改业务逻辑、API 契约、工具行为、测试语义或现有用户未提交的 `src/config/constants.ts` 无关改动。
- 不翻译代码标识符、命令、工具名、状态值（如 `OKAY`/`REJECT`）、路径和固定协议字段。

## Requirements
1. agent 定义与聚合提示词全部使用中文自然语言。
2. 六阶段 skill 正文、视觉分析 skill 和 OpenCode skill 说明全部使用中文自然语言。
3. 运行时 hook、CBM 共享片段及文件操作规则中的自然语言全部使用中文。
4. README、docs 和相关注释中的自然语言说明全部使用中文；英文仅保留固定标识、代码/API/命令和必要原文。
5. 保持模板结构、插值、Markdown 层级和测试可执行性。

## Architecture / Design
优先修改单一来源常量和 agent/skill 原始文本，再用残留英文扫描与现有测试验证。共享拼装函数只调整字符串，不改变组合、过滤、动态插值或运行时分支。

## Tech Stack / Constraints
TypeScript strict、ESM、Bun；当前目录执行；不得创建隔离工作区或执行 git 操作；保留用户已有修改。

## Decisions & Alternatives
采用全量自然语言中文化方案；不采用仅修改模型提示词的窄范围方案，因为用户明确要求扩大到文档与注释。

## Risks & Mitigations
- 固定标识误翻导致运行时失败：以代码块、反引号、工具/API/字段清单为保护边界，并运行测试。
- 动态拼接漏改：覆盖共享常量、registry、聚合函数和 hook 常量，进行全仓残留扫描。
- 文档范围过大造成无关 diff：仅修改自然语言英文/混杂段落，保持代码示例和链接目标不变。

## Edge Cases / Failure Handling
遇到必须保留的英文原文、外部错误消息或协议值，保留并在扫描报告中归类为固定标识；无法确定是否可翻译时不改变其语义并记录风险。

## Acceptance Criteria
- `src/agents/`、`src/skills/`、`src/hooks/`、`src/config/constants.ts`、`src/cbm/registry.ts` 的提示词自然语言不再含未归类英文句子。
- README 与 `docs/` 的自然语言说明中文化，代码、命令、链接、标识符和专有名词保持有效。
- `bun run typecheck`、`bun test`、`bun run build`、`bun run check:dist`、`bun run check` 全部通过。
- 英文残留扫描只命中明确登记的固定标识、代码/API、命令、链接或外部原文，不命中待翻译句子。

## Implementation Notes
按文件所有权分波执行；修改后不得重排无关内容。测试优先增加可重复的文本断言，再进行文本替换。

## Files touched map
- Agent prompts：`src/agents/oceanus.ts`、`src/agents/sisyphus.ts`、`src/agents/explorer.ts`、`librarian.ts`、`oracle.ts`、`designer.ts`、`fixer.ts`、`observer.ts`、`metis.ts`、`momus.ts`、`orchestrator-context.ts`、`protocol.ts`。
- Skills：`src/skills/*.ts` 中 skill 正文与描述。
- Shared/runtime：`src/config/constants.ts`、`src/cbm/registry.ts`、`src/hooks/json-error-recovery.ts`、`src/hooks/image-materializer.ts`、`src/hooks/image-error-hint.ts`、`src/hooks/tool-loop-guard.ts`、`src/index.ts`、`src/agents/index.ts`。
- Docs/comments：`README.md`、`docs/*.md` 及上述源码文件中的自然语言注释。
- Tests/checks：受影响的 prompt 测试及必要的新一致性断言。

## Metis Analysis
- 需求缺口：已通过两波源码/文档扫描消除主要未知；用户明确扩大至文档和注释。
- 风险：固定技术标识与自然语言边界、动态模板漏改、现有用户 diff 冲突。
- 边界与非目标：不翻译标识符/API/命令/状态值/路径/链接目标，不改逻辑。
- 反例：外部错误原文、代码示例、第三方名称和协议值可能仍含英文，必须归类而非强行翻译。
- 依赖：依赖现有 prompt 聚合、skill 注册和 Bun 检查脚本。
- 迁移/回滚：文本变更可按任务文件范围回滚；不触碰用户既有无关修改。
- 验收：以固定英文白名单扫描、类型检查、测试、构建和 dist/check 为证据。
