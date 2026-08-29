# Review — 工具运行时名称对齐修复

## 结论：通过（矩阵全绿）

## 与 Momus 影响面预估对比

- 预估：`search_code` 共 3 处（registry.ts:57、oceanus.ts:257、index.test.ts:546 或关系断言）；RULES 常量消费方 10 agent；测试锚点 registry.test.ts / cbm-usage.test.ts。
- 复查（CBM daemon 30s 超时，降级为文本级 grep + 全量测试）：
  - 生产代码与 `dist/` 中 `search_code` = 0；仅 `index.test.ts` 保留或关系断言 `/grep|search_code/`（断言语义不变，仍绿）——与预估一致。
  - 实际修改文件 = 计划 Files 集合，无越界（未触碰 `src/runtime/*`、`src/index.ts`、工具注册）。
  - 一致 → 记为验证证据；无新调用方受影响（共享常量仅提示词注入，无代码契约变化）。

## Completion Audit（覆盖矩阵）

| 成功标准 | 证据 | 状态 |
|---|---|---|
| 1. 提示词不含臆造 `search_code`、不指导 execute 代理 | RED（3 fail）→ GREEN（110 pass）；全仓生产代码+dist grep=0 | ✅ |
| 2. 权限/提示词名称与注册集合一致 | `bun test` 全量 954 pass 0 fail（含 15 工具精确集合护栏）；`READONLY_DEFAULT_PERMISSION` 未改 | ✅ |
| 3. 回归测试覆盖相关 agent + typecheck | index.test 新 describe 覆盖 9 agent；`tsc --noEmit` exit=0 | ✅ |
| 4. 不新增 read/search/execute 插件工具 | tooling-registration 15 工具集合护栏通过；工具注册代码未改 | ✅ |
| SURFACE 真实产物 | `bun run build` 成功（index.js 0.85MB）；`verify-dist-skills` OK | ✅ |

## 降级记录

- Review 阶段 `cbm_index` 重建失败（daemon 超时 30s），影响面复查降级为文本级 grep + 全量测试；与 Momus 第 2 轮（同为降级口径）对比无差异。daemon 恢复后可做一次 CBM 复核（非阻断）。

## 残留不确定性

- 宿主 Code Mode 的 `execute` 工具目录由宿主控制；本修复通过提示词禁止代理调用并指明 `grep` 等直调名，消除本插件可控范围内的臆造调用源。若宿主侧目录仍缺失 `read/search`，属宿主运行时行为，非本插件范围。
