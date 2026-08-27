# `/preset` 无模型 Turn Review

日期：2026-08-27

## CBM

Review 阶段重建 CBM 失败（daemon 30 秒不可连接），已降级为源码、API 类型、测试和构建产物审查。

## Completion Audit

| 验收标准 | 证据 | 结论 |
|---|---|---|
| 成功切换不触发新模型 turn | `createPresetCommand` 不再调用 `reply`；commands 测试断言 reply 为 0；RED 旧实现收到 1 条、GREEN 16 pass | ✅ |
| 查询不触发模型 turn/副作用 | 查询路径直接 return；测试断言 reply/reload 均为 0 | ✅ |
| 失败不触发模型 turn且可诊断 | execute 抛出带 preset 命令上下文的异常；测试断言 reject、reply/reload 为 0 | ✅ |
| 成功仍完成切换与 reload | 现有项目级配置测试、reload 测试和聚合测试通过 | ✅ |
| command/skill 语义一致 | command description 与 `src/skills/opencode-oceanus.ts` 已删除旧 reload/新会话语义 | ✅ |
| 回归与构建 | typecheck 通过；全量 950 pass/8 skip/0 fail；build 通过；dist 含新文案 | ✅ |

## Findings

- 已确认根因：原 `replyToSession` 使用 `ctx.session.prompt`，反馈文本会启动新的模型 turn。
- 已修复：成功/查询不再调用 reply；错误改为抛出，由宿主命令层处理。
- 已修复：运行时 skill 不再指导模型执行 reload/新会话或误解配置写入位置。
- 开放项：服务端 command execute 抛错后，真实 OpenCode host 的具体 UI 展示未在本地 host smoke 验证；不能声称已有 toast。
- 用户已有 `package.json`、`src/update/*` 等变更保持未回滚。

## Gate

PASS；核心验收证据完整，真实 host 的错误展示作为明确剩余不确定性记录。

## 通用 subagent 会话复用 Review

日期：2026-08-27

### CBM

Review 阶段重建 CBM 失败（daemon 30 秒不可连接），已降级为源码、测试和构建审查。

### Completion Audit

| 验收标准 | 证据 | 结论 |
|---|---|---|
| JobBoard lane/reusable 基础能力 | R1 定向测试 40 pass；隔离、旧 generation、CAS 与 observer/reconcile 回归通过 | ✅ |
| v2 child session 续用 | R2 定向测试 12 pass；adapter prompt/wait/get 缺能力和 uncertain 不伪造通过 | ✅ |
| 工具注册、默认开启与 workspace 回退 | 相关测试通过；全量测试 978 pass/8 skip/0 fail；typecheck/build 通过 | ✅ |
| 所有 specialist 的真实同 lane 端到端复用 | 当前仅有 task_reuse 无候选契约测试，未完成八类真实 host 场景验证 | ⚠️ |
| 真实 OpenCode host 行为 | 本地无 OpenCode host，smoke 仅 mock；CBM 不可用 | ⚠️ |

### Findings

- 已实现并接通 `task_reuse`、lane 元数据、child session v2 续用、默认配置和调度提示。
- 已将模糊 child/session 绑定、degraded board 读取、终态 reconciliation 和 uncertain revive 收紧。
- 剩余风险：`task_reuse` 的完整成功/replay/多候选/配置关闭/八类 specialist 端到端覆盖仍不足；不能声称这些场景已全部达到验收。

### Gate

CONDITIONAL PASS：核心实现、回归测试、类型检查和构建通过；保留上述端到端覆盖与真实 host 验证不确定性。
