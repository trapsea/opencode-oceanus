# Review v1

## 结论

P1-P15 的代码与测试验收通过，可以进入 Finish。真实 OpenCode Host、CBM daemon 冷启动和 ast-grep 外部 CLI 仍未验证，因此这些环境性准则仅标记为未验证，不影响已验证的代码级 fail-open 结论。

## Completion Audit

| 任务 | 验收准则 | 证据 | 结果 |
|---|---|---|---|
| P1 | 公共 Agent 协议、Metis trigger、disabledAgents、sections/Verify | Agent 测试与 prompt 表面检查 | 通过 |
| P2 | Skill 编号、缩进、占位符和参数示例格式 | stages 测试 | 通过 |
| P3 | 双门禁、Gate Status、impact_estimate、Plan-Change | gate 测试 | 通过 |
| P4 | strict/light/exempt evidence tier 与升级 | evidence 测试 | 通过 |
| P5 | Review 30s+60s/90s budget、docs-only skip、stale fail-open | review-budget 测试与 Review prompt | 通过 |
| P6/P11 | Finish 自包含且严格默认拒绝 | Finish 状态矩阵 5 项、45 断言；`decideFinish` 表面 | 通过 |
| P7 | Momus 仅校验 impact_estimate，registry advisory/fail-open | registry/Agent 测试 | 通过 |
| P8/P12 | args-file→stdin→raw、timeout 收敛、错误码/字段兼容 | CLI 测试 35 项；fake process argv/stdin/kill/exitCode | 通过 |
| P9/P13 | starting/stale、attempt2、查询 guard 不放行非 fresh 索引 | CBM/indexer/builders/guidance 测试 67 项；fake daemon transitions | 通过 |
| P14 | starting/stale 术语、Metis 权限、cbm_index 注册文案一致 | Agent/CBM/guidance 相关测试 34 项及 prompt/registry/command 表面 | 通过 |
| P10/P15 | 问题清单、工具数量和环境限制与实现一致 | 文档交叉检查、`git diff --check` | 通过 |

## CBM impact review

- Review 阶段重建索引：第一次成功，报告 `status: indexed`，2413 nodes、7645 edges、0 未索引文件，存在 `xx.sql` 单行 partial parse 信号。
- 后续 `cbm_detect_changes`/`cbm_search_graph` 查询在 2026-08-29 会话中降级：原始响应包含 `index_status_failed:unparsed_status`、daemon 在 30 秒内无法接受客户端；最终一次还返回 `secure CLI coordination could not be created (process-fingerprint)`。
- 因此本次影响面复查使用静态 `grep/read` 和实际 diff：`SISYPHUS_FINISH_SKILL`、`runCbmCli/runPass`、`createIndexer`、`guardForQuery`、`ensureIndexed`、`createCbmGuidanceHook`、`registerOceanusHooks`、`METIS_DEFAULT_PERMISSION`、`createAgents`、`registerOceanusTools`、`buildCbmTools`、`buildCbmSharedDeps`。
- 与 Plan/Momus 预估相比，复查新增并已纳入的调用方是 `createAgents`、`registerOceanusTools`、`buildCbmTools`、`buildCbmSharedDeps`；已由 P13/P14 的代码、测试和类型检查覆盖。CBM 图谱调用本身未能提供可靠 trace，保留该不确定性。

## Final verification

- `bun test`：1021 pass、8 skip、0 fail（1029 tests，3578 assertions）。
- `bun run typecheck`：通过。
- `bun run build`：通过，生成 `dist/index.js` 与 `dist/tui.js`。
- `git diff --check`：通过。
- 跳过项：真实 OpenCode Host、真实 ast-grep CLI 注册链路；环境探测已记录，mock 注册契约通过。

## Remaining uncertainty

未执行 git 操作。工作区原有未提交改动已保留；由于没有独立基线提交，hunk 归属只能依据执行前后会话记录和当前 diff 审查。真实 CBM daemon 的 starting→retry→indexed/stale 行为仍需在可用 Host/daemon 环境补充验证。
