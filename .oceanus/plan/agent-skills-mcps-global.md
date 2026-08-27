# Agent skills / MCP 全局生效计划

## 策略

- TDD：RED → GREEN → SURFACE。
- 工作区：共享工作区串行；不创建 worktree，不操作 Git 索引、分支或提交。

## 任务

### AGENT-CAP-1：能力配置解析与测试

- Wave：1
- Depends on：无
- Files：`src/config/schema.ts`、`src/agents/**` 测试、必要的新能力解析模块
- 目标：定义并测试 `*` / `!name` 语义、未知项诊断和 preset/显式覆盖后的有效配置。
- 验证：先新增失败单测，再实现解析；配置与边界测试通过。

### AGENT-CAP-2：全局 Skill/MCP 接线

- Wave：2
- Depends on：AGENT-CAP-1
- Files：`src/index.ts`、`src/skills/**`、必要的 `src/runtime/types.ts`
- 目标：按全局语义注册/暴露 Skill；校验宿主已有 MCP；将有效能力清单注入 Agent system/权限，不伪造外部 MCP。
- 验证：fake v2 context 接线测试，确认 reload、未知能力 warning、内置 sisyphus skills 与 CBM MCP 不回归。

### AGENT-CAP-3：preset reload 与文档

- Wave：3
- Depends on：AGENT-CAP-2
- Files：`src/commands/**`、`src/agents/**`、`README.md`、`src/skills/opencode-oceanus.ts`
- 目标：切换 preset 后更新能力清单并清理旧配置；同步真实语义和限制文档。
- 验证：reload 回归测试、文档示例检查。

### AGENT-CAP-4：最终验证

- Wave：4
- Depends on：AGENT-CAP-3
- Files：无
- 目标：运行 targeted tests、typecheck、build；记录真实 host smoke 的未覆盖边界。
- 验证：命令结果可审计，失败不得声称完成。

## Momus 门禁

- 状态：待审查
- Revision：0
- Verdict：待定
