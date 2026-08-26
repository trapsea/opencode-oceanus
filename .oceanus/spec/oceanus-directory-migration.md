# Sisyphus 工作流目录迁移设计

## 目标

将 Sisyphus 工作流产物目录从 旧的工作流目录 统一迁移到 `.oceanus/`，避免插件工作流与 Slim 工具目录混用。

## 范围

- 设计规格：`.oceanus/spec/`
- 实现计划：`.oceanus/plan/`
- 进度状态：`.oceanus/progress/`
- 同步修改内置 Sisyphus skills、Sisyphus agent 提示词和 README。

## 非目标

- 不改变 agent、skill 或插件 API 行为。
- 不迁移配置文件路径或构建产物路径。

## 验收标准

1. 工作流文档中的路径全部使用 `.oceanus/`。
2. 仓库源码、README 和内置 skill 中不再出现旧的 旧的工作流目录 工作流路径。
3. `bun run typecheck` 和 `bun run build` 通过。
