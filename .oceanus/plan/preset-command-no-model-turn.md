# `/preset` 命令无模型 Turn 反馈计划

## 策略

- 共享当前 worktree，串行执行；不进行 git/worktree 操作。
- RED→GREEN→SURFACE；保留 `package.json` 与 `src/update/*` 等用户变更。

### preset-command-1（Wave 1）命令反馈契约

- Files：`src/commands/preset.ts`、`src/commands.test.ts`、`src/commands/index.test.ts`、`src/commands/types.ts`、`src/index.ts`
- 目标：移除成功/查询/失败的 session prompt/reply 反馈，更新 command description；成功仍完成 `runPreset` 写入和 `reloadAgents`，查询直接返回，失败抛给宿主。
- 验证：相关测试 RED→GREEN，逐路径断言 `reply` 与 `session.prompt` 均为 0 次；成功断言实际配置写入、registry reload 各一次，查询不写配置且不 reload，失败抛出包含 preset/阶段上下文的诊断异常且不 reload；typecheck。

### preset-command-2（Wave 2）文档/skill 同步

- Depends on：preset-command-1
- Files：`src/skills/opencode-oceanus.ts`、必要的 skill 测试
- 目标：删除旧 preset 使用说明，补充当前 location、立即刷新、不创建新模型 turn、不主动中断的真实语义。
- 验证：文本断言/相关测试、grep 检查无矛盾旧文案；真实 host 错误 toast 不在 server command API 能力内，作为开放项记录，不伪造覆盖。

### preset-command-3（Wave 3）产物与回归

- Depends on：preset-command-2
- Files：`dist/*`
- 目标：构建并做全量回归。
- 验证：`bun run typecheck`、`bun test`、`bun run build`、dist 非空和新 description 字符串检查。

## Momus 门禁

- 状态：待审查
- 轮次：1
- 结论：前两轮 REJECT，已补充入口/聚合测试文件、实际持久化、查询无副作用和诊断异常策略，待复审
- 时间：2026-08-27
