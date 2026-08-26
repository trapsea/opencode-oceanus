# OpenCode 插件全面审计计划

## 策略

- TDD：本轮只执行现有测试，不新增测试、不修改实现。
- Worktree：使用当前工作区直接审计，不创建 worktree；保留现有未提交改动。
- 调度：只读检查可并行；构建/测试/打包任务串行执行，避免生成目录相互影响；最终汇总串行复核。

## 任务图

### AUDIT-01：本地插件 API 与静态实现核对

- **Wave**：1
- **Depends on**：无
- **Files**：`src/index.ts`、`src/tui.tsx`、`src/agents/**`、`src/config/**`、`src/skills/**`、`package.json`
- **Worker**：主编排器
- **目标**：核对入口导出、transform/reload 生命周期、agent 字段映射、依赖声明和 CLI/TUI 双入口的静态一致性。
- **验证**：逐项记录文件/行号证据；不改文件。

### AUDIT-02：OpenCode 官方 API 与版本契约核对

- **Wave**：1
- **Depends on**：无
- **Files**：无（外部文档与本地依赖只读）
- **Worker**：@librarian
- **目标**：核对目标 OpenCode v2 beta/current 版本的插件加载配置、`Plugin.define`、CLI/TUI、transform/reload 和 command invocation 契约。
- **验证**：每个结论附官方 URL、版本或本地类型证据，并区分目标版本。

### AUDIT-03：类型、构建、测试与入口导入验证

- **Wave**：1
- **Depends on**：无
- **Files**：`dist/`（生成副作用，禁止手工编辑）
- **Worker**：主编排器
- **目标**：执行 `bun run typecheck`、`bun run build`、现有 Bun 测试，并从构建产物导入 CLI 与 TUI 入口。
- **验证**：保存命令、退出码、关键输出和产物导入结果；构建造成的 `dist/` 变化不纳入实现修改。

### AUDIT-04：发布包与 README 安装路径审查

- **Wave**：1
- **Depends on**：无
- **Files**：`package.json`、`.npmignore`、`README.md`、`dist/`
- **Worker**：@explorer
- **目标**：检查 `exports`、`files`、依赖/peerDependencies、npm tarball 内容，以及 README 的 CLI/TUI 配置和本地/发布态说明是否一致。
- **验证**：执行 npm pack dry-run 或等价清单检查，结合源码逐项标注证据；不改文件。

### AUDIT-05：证据汇总与审计结论复核

- **Wave**：2
- **Depends on**：AUDIT-01、AUDIT-02、AUDIT-03、AUDIT-04
- **Files**：无（仅生成最终回复）
- **Worker**：主编排器；必要时升级 @oracle 进行高风险结论复核
- **目标**：合并所有发现，验证高严重度问题，按严重度输出影响、复现证据、修复建议和未验证事项。
- **验证**：所有任务有终态；无未经证实的结论；检查工作区未被实现性修改。
