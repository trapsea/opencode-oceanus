# 计划：/preset 全局语义修复（rev 2）

## 背景（诊断结论）

- 用户执行 `/preset openai` 后模型不切换（新会话也不变）。
- 日志证据（opencode.log）：
  - 8/26 曾有 `SchemaError(Expected array at ["skills"])` 导致命令失败，后续版本已修复；今天 22:56（UTC 14:56）命令执行成功（`agent.updated` 事件 × 2，`/root/.opencode/opencode-oceanus.jsonc` 被写入）。
  - 宿主 beta-18414 **不提供 `ctx.directory`**，插件回退 `process.cwd()` = `/root`（service 守护进程 cwd），preset 被写入 `/root/.opencode/opencode-oceanus.jsonc`。
- 读写不一致：
  - 写入：`getProjectPresetConfigPath(directory)` → `/root/.opencode/...`（daemon cwd 的“项目级”）。
  - TUI sidebar 读取：`props.context.location?.directory`（真实项目目录）→ 显示永远不变。
  - README 承诺写“当前项目 `.opencode/`”与实际不符。
- 用户决策：**改为全局语义** —— `/preset` 写用户级配置顶层 `preset`，全局生效，sidebar/文档一致。

## 已确认决策

- 语义：`/preset <name>` 原子更新**用户级** `~/.config/opencode/opencode-oceanus.jsonc` 顶层 `preset` 字段。
- 读取 presets 列表时仍合并项目级定义（loadPluginConfig），允许切换项目级定义的 preset，但选择本身全局生效。
- 现场修复：清理 `/root/.opencode/opencode-oceanus.jsonc`（误导性的 daemon-cwd “项目级”配置）。
- TDD：先改/加测试（红）→ 实现（绿）。
- Worktree：共享当前工作区（改动集中、无并行写冲突），串行执行。

## 任务（rev 2，吸收 Momus 修订）

| ID | 任务 | Files | Depends on | 验证 |
|----|------|-------|-----------|------|
| T1 | `runPresetCommand` 写入目标改为用户级：移除 `directory→getProjectPresetConfigPath` 写入分支（`directory` 仅用于读取 presets 列表）；同步清理 preset.ts 顶部 `getProjectPresetConfigPath` import（成为零调用）、`PresetCommandOptions.directory` JSDoc、command description（“切换当前项目 preset”→“切换全局 preset”）；先改 `src/commands.test.ts`：修正 L68-90“项目级写入”用例为用户级写入断言（红）再实现（绿） | src/commands/preset.ts, src/commands.test.ts | - | `bun test src/commands.test.ts` |
| T2 | tui.tsx **两处** preset 读取统一改为用户级：L226 `createPresetWatcher({read})` 与 L345 `presetName` memo；将读取逻辑抽为可导出、可注入 configDir 的 helper（如 `readActivePresetName(options)`，内部用 `getUserPresetConfigPath`/`readUserConfig`）；`src/tui.test.ts` 新增用例：写用户级临时目录（含顶层 preset）→ helper 返回该 preset | src/tui.tsx, src/tui.test.ts | - | `bun test src/tui.test.ts` |
| T3 | README 三段更新为全局语义：L255-268（配置路径/优先级描述）、L340-346（合并优先级中“项目级 preset 覆盖用户级选择”的表述）、L357-366（`/preset` 章节改为“写用户级、全局生效、重启 opencode/新开项目窗口后新会话加载”） | README.md | T1 | 文档审查 |
| T4 | 现场配置清理：删除 `/root/.opencode/opencode-oceanus.jsonc`；用户级 preset 设为 `openai` | （环境文件，非仓库） | T1 | `cat` 验证；`loadPluginConfig()` preset=openai |
| T5 | 全量验证 | - | T1-T3 | `bun run typecheck`、`bun test src/commands.test.ts src/commands/index.test.ts src/config/presets.test.ts src/config.test.ts src/tui.test.ts`、`bun run build` |

## 注意（含 Momus 指出的已知边界）

- 工作区已有大量未提交改动（preset/runtime 重构），本计划只追加修改，不回滚既有改动。
- **已知边界**：`loadPluginConfig`/`mergePluginConfigs` 不改；若某真实项目存在带顶层 `preset` 的 `.opencode/opencode-oceanus.jsonc`，项目级仍覆盖用户级（loader 既有优先级），reloadAgents 加载的配置会被遮蔽，“全局生效”在该项目内不成立。当前用户环境无此类文件；README T3 中显式声明此边界。
- “新会话模型不变”的另一半原因：宿主按 location 实例化插件、setup 时快照配置；全局写入后需宿主重启/位置服务重建后新会话加载新 preset。README 中明确说明“重启 opencode 或新开项目窗口后生效”。
- 变体字段（variant: low/high 等）若宿主不支持对应模型变体可能导致模型解析失败，属后续观察项，不在本计划范围内。

## Momus 审查记录

- Round 1：REJECT（5 点：T1/T2 Files 缺测试文件、T2 无验收手段需抽 helper、T2 需点明两处读取点、T3 范围不足、JSDoc/description 同步与遮蔽边界未声明）→ 已全部吸收进 rev 2。
- 影响面预估（Momus，CBM 不可用，grep 代替，Review 需复核）：`runPresetCommand` 调用方 index.ts:255（注入传 directory，T1 后仅影响读取，无需改）、commands/index.ts re-export（无需改）、commands.test.ts（已入 Files）；`getProjectPresetConfigPath` 移除调用后零调用导出（loader 保留）；`presetName`/watcher 均在 tui.tsx 内部；`updateUserPreset` 默认用户级与 daemon cwd 无关，读写一致性成立。

## 状态

- Momus：Round 1 REJECT → rev 2 OKAY（2026-08-28 23:05）
- 人工批准：APPROVED（2026-08-28 23:08）
- 执行：T1-T5 全部 completed（见 .oceanus/progress/preset-global-semantics.md）
