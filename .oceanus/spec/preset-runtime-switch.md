# `/preset` 运行时切换修复设计

## 目标

`/preset <name>` 成功后，当前工作目录的最终生效配置与所选 preset 一致，当前会话已注册的 Oceanus agents 立即更新；新会话也读取同一选择。

## 已确认决策

- 当前会话必须立即生效。
- 当前目录存在项目配置时，切换应改变当前 location 的生效值，而不是只修改用户级配置。
- 保留 preset 配置结构及未知 preset 拒绝语义。
- 不修改用户已有的 `package.json` 版本变更。

## 设计

1. `/preset` 解析当前 `process.cwd()` 的最终配置与可用 preset。
2. 切换写入当前 location 的项目配置 `<cwd>/.opencode/opencode-oceanus.jsonc`，采用现有原子写入逻辑，并保留项目配置中其他字段。
3. 写入成功后重新加载完整配置，重新应用 agent 定义；刷新流程必须处理旧 model、旧 permission/options 及被新 preset 禁用的 agent，最后调用宿主 reload。
4. 命令成功反馈只在刷新成功后发送；写入或刷新失败均反馈失败，避免报告“已生效”但 registry 未更新。
5. 增加纯逻辑测试和 fake host 接线测试，覆盖项目级覆盖、当前 registry 的 model/prompt 更新、旧字段清理、未知 preset/写入失败不刷新。
6. 构建后同步验证 `dist`，并检查工作区现有用户变更不被覆盖。

## 范围与非目标

- 范围：`src/commands/preset*`、配置路径/写入、入口 agent reload、相关测试和构建产物。
- 非目标：改变 preset 合并优先级、重做 Agent API、修改 TUI 展示或无关 task/status 逻辑。

## 风险与边界

- 宿主 `agent.reload()` 的实际 registry 语义需要 fake host 及静态 API 验证；若宿主 API 本身不支持当前会话更新，必须保留明确失败/提示，不能伪报成功。
- 现有用户级 preset 配置需继续作为可用 preset 来源；项目文件只覆盖当前选择字段。
- 项目配置不存在时需创建目录和文件；JSONC 注释格式不要求保留，但其他字段不得丢失。

## Metis 分析

Metis 已跳过：澄清后方案已由用户明确批准，未剩余需要独立比较的方案选择。残余风险通过 host fake 测试、typecheck、全量测试和构建审查覆盖。

## 验收标准

- `/preset safe` 后当前 location 的最终 `loadPluginConfig` 返回 `preset=safe`。
- 当前会话 registry 中受影响 agent 的 model/prompt/options/permission 与新配置一致，旧值不残留，被禁用 agent 不再存在。
- 查询、未知 preset、写入失败、刷新失败均不误调用成功路径。
- 相关测试、typecheck、build 通过；`package.json` 原有用户修改保持不变。
