# OpenAgent 与 Oceanus Agent 编排复核设计

## 范围

只做只读架构复核和文档产出，不修改 Oceanus 运行时代码。对比对象为当前 Oceanus 与 `code-yeongyu/oh-my-openagent`（旧名 oh-my-opencode），重点覆盖 Agent 注册/路由、prompt 注入、权限、模型选择、preset/config reload、task 生命周期、并行调度、恢复和 v2 适配边界。

## 交付物

- 新增一份中文详细对比文档到 `docs/`。
- 每项结论区分源码/官方文档已确认、静态推断和需要真实 host 验证的内容。
- 给出 P0/P1/P2 优先级、收益/成本/风险和不建议移植项。
- 不直接复制 `oh-my-openagent` 代码、prompt 或受限许可证内容。

## 已确认方向

- 报告优先于实现；本轮不落地 preset、权限、模型 fallback 或 task system 改造。
- Oceanus 继续保持原生 OpenCode v2、轻量单包和宿主能力优先的架构定位。
- 建议优先关注：preset 定义重建、默认 Agent 权限矩阵、Agent 元数据单一来源、能力声明一致性；模型 fallback、任务持久化/依赖门控和规则注入等待 API/需求进一步确认。
