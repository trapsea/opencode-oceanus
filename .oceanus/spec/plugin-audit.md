# OpenCode 插件兼容性全面审计设计

## 目标

检查当前工作区中的 `opencode-oceanus` 是否能作为 OpenCode v2 beta 插件被正确安装、加载和运行，并识别会导致加载失败、功能失效或发布包不可用的问题。

## 范围

- CLI 插件入口：`Plugin.define`、agent/skill/command transform 与 reload 生命周期。
- TUI 插件入口：`./tui` exports、TUI `Plugin.define`、sidebar 数据与事件订阅契约。
- OpenCode beta API 与当前锁定版本 `0.0.0-beta-18230` 的官方契约核对。
- `package.json`、`exports`、`files`、依赖、构建产物及 npm 打包内容。
- 配置加载、preset、权限映射及 agent 注册的静态行为。
- 类型检查、构建、现有测试、产物导入 smoke test。
- README 安装说明与实际行为的一致性。

## 非目标

- 本轮不修改实现代码、不回滚当前未提交改动、不提交 Git commit。
- 不评估 agent 提示词本身的效果，也不比较模型质量。
- 若没有可运行的 OpenCode 宿主环境，不宣称已完成真实交互式端到端验证。

## 验收标准

1. 所有可执行的类型检查、构建和测试结果均有记录。
2. CLI 与 TUI 入口均能从当前构建产物导入，且发布 tarball 包含运行所需文件。
3. OpenCode API 检查结论有本地类型/源码或官方文档证据。
4. 每个发现包含严重度、复现/证据、影响范围和是否需要修复；已验证问题与潜在风险分开。
5. 明确记录未能在当前环境验证的事项。

## 审计方式

采用全面审计：静态代码与文档检查、官方 API 核对、`typecheck`/build/测试、npm 打包检查和最小入口导入 smoke test。只读审计；任何发现的修复建议留待后续任务。

## 约束与风险

- 当前工作区已有未提交改动，审计必须保留这些改动，不得覆盖或回滚。
- OpenCode 处于 beta，API 可能与文档或本地安装包不一致；以当前锁定依赖和官方证据交叉核对。
- `dist` 是生成目录，构建会重建它；执行前需把产物变化视为审计副作用并在报告中说明。
