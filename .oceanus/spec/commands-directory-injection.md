# Commands 目录化与注入设计

## 背景

当前 `src/commands.ts` 同时承载 command 类型、`preset` command 实现和运行时依赖，插件入口只注册一个 command。后续会继续新增 commands，需要与 `agents/`、`skills/` 一样具备按模块拆分和统一聚合入口。

## 已确认决策

- 允许破坏性调整，不保留旧 `commands.ts` 文件级导出兼容层。
- 采用 `src/commands/types.ts` + 每个 command 独立文件 + `src/commands/index.ts` 聚合工厂。
- command 的运行时依赖通过工厂参数注入；command 模块不直接持有完整插件上下文。
- 插件入口负责调用聚合工厂、逐个 `draft.add`，并执行一次 command reload。

## 目标结构

```text
src/commands/
├── types.ts       # v2 command 最小契约与注入依赖
├── preset.ts      # preset 业务逻辑、运行函数和 command 工厂
├── index.ts       # command 工厂聚合与公共导出
└── index.test.ts  # 聚合/注册契约与 preset 行为测试
```

## 注入设计

- `types.ts` 定义 `CommandDefinition`、`CommandInvocation` 和 command 所需的最小依赖类型。
- `preset.ts` 保留现有 `runPresetCommand` 与 preset 行为；`createPresetCommand` 接收最小 handlers，不依赖 `ctx`。
- `index.ts` 导出 `createCommands(deps)`，返回所有 command 定义数组；新增 command 时新增模块并加入聚合数组。
- `src/index.ts` 通过 `createCommands` 获取数组，统一执行 `draft.add(command)`，不再直接引用具体 `preset` 实现。

## 测试与验收

- 保留现有 preset 查询、切换、未知 preset、写入失败和 agent reload 行为。
- 新增聚合测试：command 数量、名称、定义形状和入口遍历注册行为。
- 验证新增 command 只需加入聚合模块即可被注入，不修改入口的具体 command 逻辑。
- 运行相关 Bun 测试、全量测试、类型检查和构建。

## 非目标

- 不新增 command 功能。
- 不改变 preset 配置格式、消息文案或 reload 语义。
- 不改动 agents、skills、tools、hooks 的业务逻辑。
- 不保留旧 `src/commands.ts` 兼容文件。
