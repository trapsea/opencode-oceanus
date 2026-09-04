# 提示词与说明文本中文化
## Goal
完成所有模型可见提示词、用户文案、README/docs 与相关注释的中文化，并保持运行时契约。
## Architecture
按单一来源与文件所有权分波修改；先测试/扫描规则，再文本修改，最后全量验证。
## Tech Stack
TypeScript strict、ESM、Bun、Markdown。
## Spec: .oceanus/spec/prompt-chinese-localization.md
## Global Constraints
保留当前目录和用户未提交改动；不改标识符、API、命令、状态值、路径、链接目标与逻辑；worker 不执行 git 操作。
## Files touched map
各任务文件范围互不重叠；源码注释由对应源码任务所有者负责，文档任务只负责 README 与 docs。
## Dependencies / Assumptions
CBM 初始化已完成但结构查询不可用，按 fail-open 使用文本证据；现有测试与检查脚本可执行。
## Gate Status
- momus: { verdict: OKAY, round: 4, verifiedAt: "2026-09-03", reason: "按失败重规划拆分 PROMPT-AGENTS 后通过 Momus 复审" }
- human: { status: APPROVED, reason: "Brainstorm 方案总批准", verifiedAt: "2026-09-03", via: consolidated }
- impact_estimate: agents 只改变 system/description 文本，影响 `buildOceanusPromptSections`、`buildOceanusPrompt`、`create*Agent` 返回文本及 `createAgents` → `ctx.agent.transform`；skills 只改变 content/description，影响 `OCEANUS_SKILLS` → `ctx.skill.transform` → dist 校验；constants/registry 影响 `WRITABLE_FILE_OPERATIONS_RULES`、`READONLY_FILE_OPERATIONS_RULES`、`CBM_LIFECYCLE`、`cbmSection` 及其调用方；protocol 影响 `DISPATCH_PROTOCOL`、`LEDGER_PROTOCOL`、`RUNTIME_GUARDS_PROTOCOL`、`THREE_ROUND_TEMPLATE`、`MOMUS_GATE_PROTOCOL`、`CHILD_BLOCKING_PROTOCOL`、`buildAgentProtocol` 的 prompt 拼装；guidance 影响 `INDEXING_IN_PROGRESS_MESSAGE`、`AUTO_INDEX_DISABLED_MESSAGE`、`NO_PROJECT_MESSAGE`、`buildIndexingGuidance` → `createCbmGuidanceHook.before` 的注入结果；hooks 影响 `JSON_ERROR_REMINDER`、`LOOP_GUARD_WARNING`、`IMAGE_ERROR_HINT`；扫描器影响 `scripts/check-prompt-chinese.ts` CLI 成功输出与退出码契约，并被 Task 5/6 调用；docs/comments 无运行时调用方。所有签名、插值、名称、权限、工具名、状态值和 hook 行为不变。
## Task 1
Task ID / Goal / Context / Files（Create, Modify, Test） / Interfaces / Dependencies：PROMPT-TEST；建立固定英文白名单与 prompt 结构回归断言；Files：Create `scripts/check-prompt-chinese.ts`；Modify `src/agents/cbm-usage.test.ts`、`src/skills/evidence.test.ts`、`src/skills/gate.test.ts`、`src/skills/finish.test.ts`、`src/cbm/guidance.test.ts`；Dependencies：无；Wave 1；owner：Sisyphus。
扫描器 `TARGET_FILES` 固定为：`src/agents/oceanus.ts`、`sisyphus.ts`、`explorer.ts`、`librarian.ts`、`oracle.ts`、`designer.ts`、`fixer.ts`、`observer.ts`、`metis.ts`、`momus.ts`、`orchestrator-context.ts`、`protocol.ts`、`index.ts`，`src/skills/clipboard-image-observer.ts`、`opencode-oceanus.ts`、`oceanus-intake.ts`、`oceanus-brainstorm.ts`、`oceanus-plan.ts`、`oceanus-execute.ts`、`oceanus-review.ts`、`oceanus-finish.ts`，`src/config/constants.ts`，`src/cbm/registry.ts`、`guidance.ts`，`src/hooks/json-error-recovery.ts`、`image-materializer.ts`、`image-error-hint.ts`、`tool-loop-guard.ts`、`cbm-guidance.ts`，以及 `README.md`、`docs/opencode-v2-compatibility.md`、`docs/prompt-workflow-review-2026-08.md`、`docs/tooling-and-runtime.md`、`docs/codebase-memory-mcp.md`。`APPROVED_TOKENS` 固定包含 `You` 不得作为单独白名单、`OpenCode`、`Oceanus`、`Sisyphus`、`CBM`、`Metis`、`Momus`、`Fixer`、`Explorer`、`Librarian`、`Oracle`、`Designer`、`Observer`、`README`、`Markdown`、`TypeScript`、`ESM`、`Bun`、`API`、`UI/UX`、`JSON`、`OCR`、`PDF`、`YAGNI`、`TDD`、`SDD`、`L1-L5`；固定模式包括反引号代码、URL、文件路径、命令行、agent/tool 名称、状态值和测试输入，且只在这些语法位置允许。扫描未匹配的 ASCII 自然语言 token 输出 `file:line` 并退出 1；通过输出 `PROMPT_CHINESE_SCAN_OK: 0 unapproved English natural-language matches` 并退出 0。RED：`bun scripts/check-prompt-chinese.ts` 与 `bun test src/agents/cbm-usage.test.ts src/skills/evidence.test.ts src/skills/gate.test.ts src/skills/finish.test.ts src/cbm/guidance.test.ts`，预期当前文本报告英文并非 0；GREEN：后续任务完成后执行同一命令，预期退出 0。另以临时测试文本验证未登记句子退出 1、移除后退出 0。
Acceptance criteria / Risks & rollback / status / owner / wave / updated / expected diff lines：明确区分固定标识与自然语言；若断言过严按实际协议白名单修订；completed / Sisyphus / 1 / 2026-09-03 / 80 行。
## Task 2A
Task ID / Goal / Context / Files / Interfaces / Dependencies：PROMPT-AGENT-CORE；完成 Oceanus/Sisyphus 聚合 prompt 全文中文化；Files：`src/agents/oceanus.ts`、`src/agents/sisyphus.ts`（含注释）；Dependencies：PROMPT-TEST RED；Wave 2；owner：Fixer；预估 500 行。
Validation: `bun test src/agents`；Expected：两个文件无未登记英文自然语言，prompt 结构、组合和插值测试退出 0。
## Task 2B
Task ID / Goal / Context / Files / Interfaces / Dependencies：PROMPT-AGENT-SPECIALISTS；完成专家 agent prompt 全文中文化；Files：`src/agents/explorer.ts`、`librarian.ts`、`oracle.ts`、`designer.ts`、`fixer.ts`、`observer.ts`、`metis.ts`、`momus.ts`（含注释）；Dependencies：PROMPT-TEST RED；Wave 2；owner：Fixer；预估 500 行。
Validation: `bun test src/agents`；Expected：8 个文件无未登记英文自然语言，agent 描述/权限测试退出 0。
## Task 2C
Task ID / Goal / Context / Files / Interfaces / Dependencies：PROMPT-AGENT-PROTOCOL；完成编排上下文和共享协议 prompt 中文化；Files：`src/agents/orchestrator-context.ts`、`src/agents/protocol.ts`（含注释）；Dependencies：PROMPT-TEST RED；Wave 2；owner：Fixer；预估 250 行。
Validation: `bun test src/agents`；Expected：协议导出符号、模板和固定标识不变，测试退出 0。
## Task 3
Task ID / Goal / Context / Files / Interfaces / Dependencies：PROMPT-SKILLS；中文化全部 skill frontmatter 描述与正文；Files：`src/skills/clipboard-image-observer.ts`、`opencode-oceanus.ts`、`oceanus-intake.ts`、`oceanus-brainstorm.ts`、`oceanus-plan.ts`、`oceanus-execute.ts`、`oceanus-review.ts`、`oceanus-finish.ts`（含这些文件注释）；Dependencies：PROMPT-TEST RED 已记录；Wave 2；owner：Fixer；预估 650 行。
Validation: `bun test src/skills`；Expected：上述文件英文自然语言为 0，skill 结构、阶段编号和门禁断言退出 0。
Acceptance criteria / Risks & rollback / status / owner / wave / updated / expected diff lines：正文中文化且 frontmatter 有效；失败时按 skill 文件回滚；completed / Fixer / 2 / 2026-09-03 / 650 行。
## Task 4
Task ID / Goal / Context / Files / Interfaces / Dependencies：PROMPT-RUNTIME；中文化共享配置、CBM registry/guidance、hook/index 文案和错误提示；Files：`src/config/constants.ts`、`src/cbm/registry.ts`、`src/cbm/guidance.ts`、`src/hooks/json-error-recovery.ts`、`src/hooks/image-materializer.ts`、`src/hooks/image-error-hint.ts`、`src/hooks/tool-loop-guard.ts`、`src/index.ts`、`src/agents/index.ts`（含这些文件注释）；Dependencies：PROMPT-TEST RED 已记录；Wave 2；owner：Fixer；预估 500 行。
Validation: `bun test src/hooks src/cbm src/config src/agents`；Expected：相关测试退出 0，用户提示为中文，`src/config/constants.ts` 用户既有 diff 保留。
Acceptance criteria / Risks & rollback / status / owner / wave / updated / expected diff lines：保留既有 `src/config/constants.ts` 用户改动；失败按文件回滚；completed / Fixer / 2 / 2026-09-03 / 500 行。
## Task 5
Task ID / Goal / Context / Files / Interfaces / Dependencies：PROMPT-DOCS；中文化明确文档文件的自然语言说明；Files：`README.md`、`docs/opencode-v2-compatibility.md`、`docs/prompt-workflow-review-2026-08.md`、`docs/tooling-and-runtime.md`、`docs/codebase-memory-mcp.md`；Dependencies：PROMPT-AGENT-CORE、PROMPT-AGENT-SPECIALISTS、PROMPT-AGENT-PROTOCOL、PROMPT-SKILLS、PROMPT-RUNTIME；Wave 3；owner：Fixer；预估 1200 行。
Validation: `bun scripts/check-prompt-chinese.ts && bun run check`；Expected：上述每个文件无未登记英文自然语言，Markdown 链接目标、代码块和命令文本不变，检查退出 0。
Acceptance criteria / Risks & rollback / status / owner / wave / updated / expected diff lines：自然语言中文化，固定标识和示例有效；失败按文档文件回滚；completed / Fixer / 3 / 2026-09-03 / 1200 行。
## Task 6
Task ID / Goal / Context / Files / Interfaces / Dependencies：PROMPT-VERIFY；执行残留英文扫描、全量测试、类型检查、构建和 dist 检查；Files：源文件只读；允许 build 生成/覆盖 `dist/**` 临时产物，不提交 dist 变更；Dependencies：PROMPT-TEST、PROMPT-AGENT-CORE、PROMPT-AGENT-SPECIALISTS、PROMPT-AGENT-PROTOCOL、PROMPT-SKILLS、PROMPT-RUNTIME、PROMPT-DOCS；Wave 4；owner：Sisyphus；预估 0 行。
Validation: `bun scripts/check-prompt-chinese.ts && bun run typecheck && bun test && bun run build && bun run check:dist && bun run check && git status --short && git diff -- src/config/constants.ts`；Expected：全部退出 0，用户既有 diff 仍存在，除声明范围外无源文件变更，dist 不作为交付变更。
Acceptance criteria / Risks & rollback / status / owner / wave / updated / expected diff lines：所有验收有命令与预期结果；失败返回对应任务修复，不声称完成；completed / Sisyphus / 4 / 2026-09-03 / 0 行。
