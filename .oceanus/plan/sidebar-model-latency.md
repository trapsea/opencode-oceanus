# Sidebar 模型数据延迟优化 实现计划

## 已确认策略
- **TDD**：先补可自动验证的纯函数测试（RED），再实现（GREEN）。
- **Worktree**：共享工作区；任务文件范围不重叠则并行，否则串行。本计划 Wave 1 与 Wave 2 共享 `src/tui.tsx`，故串行执行。并行任务不得修改 ledger、运行 git 操作或越界编辑。
- **数据源**：插件配置 `opencode-oceanus.json` 为唯一权威；回写仅内存、仅当前会话族，不落盘。
- **不引入新文件**：内存回写状态与解析纯函数放在 `src/tui.tsx`（导出供测试）。

## 文件映射
- `src/tui.tsx`：新增内存回写状态 + 展示优先级解析纯函数 + setup 非阻塞 + 事件回写接线 + fallback 文案修正。
- `src/tui.test.ts`：新增展示优先级 / 回写聚合 / 白名单过滤 / 回写不覆盖配置 / setup 非阻塞的测试。

## 任务图

### Wave 1
#### model-resolve-logic
- **目标**：TDD 实现并测试模型展示的纯逻辑（接口契约见下，Wave 2 直接复用）：
  - `resolveDisplayModel(configModel: ModelRef | undefined, recall: ModelRef | undefined): { display: string; recalled: boolean }`：
    - 配置 model 存在 → `{ display: bareModelName(configModel), recalled: false }`（**永不覆盖**）；
    - 配置 undefined + recall 存在 → `{ display: bareModelName(recall), recalled: true }`（带标记）；
    - 都无 → `{ display: '跟随会话', recalled: false }`。
  - `recordRecall(recalls: Record<string, ModelRef>, agentID: string, model: ModelRef | undefined): Record<string, ModelRef>`（immutable）：
    - model 为 undefined → 不覆盖已有 recall，返回原引用；
    - 同 agent 相同 model → 返回原引用（**去重**，按 `id/providerID/variant` 值比较，不得用对象 `===`）。短路目的：值未变 → 调用方不更新 `recalls()` 信号 → memo 不重算；
    - 否则更新该 agent 的 recall（**最近一次使用胜出**）。
- **Files**：`src/tui.test.ts`、`src/tui.tsx`（仅导出/新增纯函数）
- **Depends on**：无
- **Worker**：@fixer
- **验证**：`bun test` 新用例（见下「Wave 1 断言」）通过；不改 sidebar 视觉结构。
- **Wave 1 断言**：
  1. 优先级：配置 model 存在 → display=配置、recalled=false；配置 undefined+recall → display=recall、recalled=true；都无 → '跟随会话'。
  2. 不覆盖：配置 model 存在时，recall 不影响 display。
  3. 去重：构造**新对象实例**但 `id/providerID/variant` 值全等的 model，断言 `recordRecall` 返回原引用（`===`）——验证按值比较而非实例 `===`。
  4. undefined 不覆盖：已有 recall 时传入 undefined → 原引用不变。
  5. 聚合：同 agent 不同 model 传入 → 更新为最近一次。
  6. 白名单过滤：`getRows` 导出供测试（或抽取白名单过滤纯函数）；扩展 `tui.test.ts` 的 `makeContext` mock 增加 `location.agent.list` 返回含非 `ALL_AGENT_NAMES` agent，断言 `getRows` 结果不含该 agent（过滤在展示层由 `getRows` 完成，recall 即使有该 agent 也不显示）。

### Wave 2
#### sidebar-nonblocking
- **目标**：接线改造：
  - **setup 非阻塞**：`setup` 只挂载 `sidebar.content` slot，**不 await、不调用 `agent.sync`**。同步动作移入组件 `AgentModelPanel` 的 `onMount`，复用现有 `refreshAgents()`（invalidate + sync + refreshData，fire-and-forget，catch 静默）。这样 sync 完成后组件内必有 `refreshData`，且不阻塞首帧渲染。（替代「setup 完成后 refreshData」的不可接线设计。）
  - **回写状态（组件级）**：`AgentModelPanel` 内用 `createSignal` 保存 `recalls: Record<string, ModelRef>`，另用 `createSignal` 维护 `sessionAgent: Map<sessionID, agentID>` 内存映射（供清理定位 agent）。生命周期随组件（复用现有 `cleanups`/`onCleanup`）。
  - **事件回写（仅当前会话族，叠加保留既有处理器）**：`session.model.selected` 与 `session.agent.selected` 的新逻辑**均叠加**在既有 `calibrateStatus` 之上。**`calibrateStatus` 总是先被调用**（对族内外所有事件都执行既有逻辑），family 不命中仅跳过新回写逻辑。`session.model.selected` 回调（data 含 `sessionID` + `model: ModelRef`）：
    1. 防御式取族 `const family = new Set(context.data.session.family(props.sessionID) ?? []); family.add(props.sessionID)`（store 未就绪时 `family()` 为空，add 自身避免误过滤当前会话）。
    2. `family.has(event.data.sessionID)` 不命中 → 跳过新逻辑（`calibrateStatus` 已在先执行）。
    3. 命中则解析该 session 的 agent 并**归一化为 `agent.id`**：`data.agent`/`session.agent` 可能是 name（现有 `matchesAgent` 已支持 name 匹配），须经 `location.agent.list` 反查 `agent.id`，查不到或无法解析 → 跳过不记录（避免把族内其它会话的 model 误写入当前 agent 的 recall）。
    4. `recordRecall(recalls, agentID, event.data.model)`（agentID 恒为 `agent.id`）；仅当返回新引用（值变化）时更新 `recalls()` 信号（**不额外调 `refreshData`**，渲染由 memo 自动重算）。
  - **时序取舍（明示）**：切换 agent 时若宿主先派发 `model.selected` 再派发 `agent.selected`，新 model 可能短暂误记到旧 agent 的 recall；随后 `agent.selected` 只清空新 agent 的 recall，旧 agent 的错误 recall 不被清。此为内存态、重启即失，接受该风险；且 `rows` memo 依赖 `recalls()` 信号，切换后随新事件自动收敛。
  - **清理规则**：`session.agent.selected`（data 含 `agent` + `previous?`）回调叠加在既有 `calibrateStatus` 之上（保留原调用）：当 `family.has(event.data.sessionID)` 时，清空 **`event.data.agent`（新选中 agent）** 的 recall（换 agent 后回退配置）。取舍说明：仅清空新选中 agent 的 recall，不清 `previous`——该 agent 若在族内其它会话最近用过模型，切回时保留较准确；跨会话偶尔残留属可接受取舍。**不监听 `session.deleted` 清理**（理由：data 仅含 `sessionID`、无法反查 agent，且按 agent 聚合不必然清空）。
  - **渲染与刷新链路**：`rows` memo 增加读取 `recalls()` 信号（`createMemo` 依赖 `recalls()`），回写/清理**自动触发重渲染，不再依赖额外的 `refreshData` 调用**（`recordRecall` 短路的目的即为「值未变 → 不 setRecalls → memo 不重算」）。无双重渲染/死循环：memo 重算只读信号不写回，`recalls` 更新不改变 `dataVersion`，无反馈回路；叠加保留的 `calibrateStatus` 之 `finally(refreshData)` 仍按既有语义执行（对非回写路径的会话状态刷新，与本功能无关）。`getRows` 增加可选 `recalls` 参数，展示文本 = `resolveDisplayModel(agent.model, recalls[agent.id])`；`recalled: true` 时模型文本前加 `*`。**颜色规则**：以 `resolveDisplayModel` 返回的 `recalled`/display 来源判定（非字符串比较「跟随会话」魔法值）——display 有实际 model 时用 `theme().text`，否则 `theme().textMuted`。
  - **修正 fallback 文案**：目标文案改为「agent registry 同步中…」（本改造不实现会话模型降级展示，旧文案失真）。判定：**rows 为空且 recalls 为空**时显示该文案（意图=首次启动同步中的占位）；rows 空但 recalls 非空时显示空列表（曾工作过、列表暂时空，空白可接受）。
- **Files**：`src/tui.tsx`
- **Depends on**：`model-resolve-logic`
- **Worker**：@fixer
- **验证**：`bun test`、`bun run typecheck`、`bun run build` 通过；人工审阅 setup 无阻塞、事件过滤与清理正确、既有 `calibrateStatus` 处理器未被移除。

### Wave 3
#### sidebar-verify
- **目标**：串行整合全部变更并执行最终检查。
  - 补 `setup` 非阻塞单测：mock 永不 resolve 的 `location.agent.sync`，断言 setup 仍返回、面板可挂载。
  - 执行人工行为验收并记录（见下「人工验收」）。
- **Files**：`src/tui.tsx`、`src/tui.test.ts`
- **Depends on**：`model-resolve-logic`、`sidebar-nonblocking`
- **Worker**：Sisyphus
- **验证**：`bun test`、`bun run typecheck`、`bun run build`、`git diff --check`；人工验收记录到 `.oceanus/progress/sidebar-model-latency.md`。
- **人工验收**（Sisyphus 执行并记录结果）：
  1. 启动 opencode：TUI 立即出现，不再卡在启动期。
  2. 会话内 `/model` 切换：对应 agent 行更新为实际使用 model（回写路径）。
  3. 改 agent 配置 model 保存：sidebar 显示配置 model（不覆盖）。
  4. 重启 opencode：无 model agent 显示配置 model 或「跟随会话」，无需等待 sync。

## Momus 审查状态
- **verdict**：OKAY（第6轮，放行 execute）
- **issues**：
  1. (P0) 回写「仅当前会话族」执行落点 → 已在 Wave 2 补充：`family ?? []` 防御过滤、`session.agent.selected` 清理、组件级生命周期。
  2. (P0) 接口契约 → Wave 1 补齐返回类型/标记/recall 类型/断言。
  3. (P1) message.updated 事件风暴 → 已确认宿主无此事件，数据源仅 `session.model.selected`。
  4. (P1) 白名单过滤 → Wave 1 断言 6 已补，并注明导出 `getRows`。
  5. (P1) 人工验收 → 并入 Wave 3。
  6. (P1, rev2) A. `session.deleted` 无法反查 agent → 已改为**不监听 `session.deleted` 清理**，并记录理由（data 仅含 sessionID、无法反查 agent、按 agent 聚合不必然清空）。
  7. (P1, rev2) B. setup 后台 sync 完成后 refreshData 无接线 → 改为**同步移入组件 onMount 复用现有 `refreshAgents()`**，sync 完成后组件内必有 refreshData。
  8. (P1, rev2) C. 清理逻辑与既有监听器叠加 → 已写明在同一回调叠加、保留既有 `calibrateStatus` 调用。
  9. (P2, rev2) D. `getRows` 未导出 → 注明导出 `getRows`。
  10. (P2, rev2) E. 去重按值比较 → Wave 1 已改为 `id/providerID/variant` 值比较。
  11. (P2, rev2) F. family undefined 防御 → 已用 `?? []`。
  12. (P2, rev2) G. recall 渲染颜色 → 已统一为「display 非跟随会话用 text」规则。
  13. (P1, rev3) `session.model.selected` 新回调与既有 `calibrateStatus` 关系 → 已明确**叠加保留原调用**（与 `session.agent.selected` 一致），Wave 3 验证覆盖该监听器。
  14. (P1, rev3) `session.agent.selected` 清理目标 → 已明确清空 `event.data.agent`（新选中）+ 取舍说明；`session.model.selected` 无法解析 agent 时**跳过不记录**（不错误关联族内其它会话）。
  15. (P2, rev3) 断言 3 → 明确构造新对象实例但值全等，验证值比较。
  16. (P2, rev3) family 过滤 → 已改为 `new Set(family ?? []).add(props.sessionID)`。
  17. (P2, rev3) 断言 6 → 扩展 makeContext 增加 `location.agent.list` mock。
  18. (P2, rev4) rows memo 未追踪 recalls 信号 → 已改为 rows memo 依赖 `recalls()`，回写/清理自动触发重渲染。
  19. (P2, rev4) agent 切换时序取舍 → 已补「时序取舍（明示）」段落。
  20. (P3, rev4) fallback 文案未定 → 已定目标文案「agent registry 同步中…」+ 判定条件。
  21. (P1, rev5) agentID 规范形式未定义 → 已明确**统一以 `agent.id` 为 recall key**；`data.agent`/`session.agent` 为 name 时经 `location.agent.list` 反查 id，查不到则跳过。
  22. (P1, rev5) refreshData 与 memo 冲突 → 已删除 `recordRecall` 后的 `refreshData`，回写渲染交 memo 自动重算；短路意义改为「值未变 → 不 setRecalls → memo 不重算」；并说明无双重渲染/死循环。
  23. (P2, rev5) fallback 边缘 → 判定简化为「rows 空且 recalls 空」+ 意图说明；rows 空 + recalls 非空显示空列表。
  24. (P2, rev5) 去重短路措辞 → 已与问题 22 统一。
  25. (P2, rev5) family 不命中顺序 → 已明确 `calibrateStatus` 总是先被调用，family 不命中仅跳过新逻辑。
- **revision**：5
- **checked_at**：（待复审）
