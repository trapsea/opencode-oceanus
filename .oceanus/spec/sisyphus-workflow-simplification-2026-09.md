# Sisyphus 工作流简化与调研协议优化

状态: approved

## 目标

保留六阶段工作流，但减少重复门禁叙述和阶段衔接摩擦；取消 Oracle 固定执行前审核，将 Oracle 限定为由 Sisyphus 按复杂架构或业务风险自主触发的 spec/plan 顾问；统一 Explorer/Librarian 的可审计研究结果格式。

## 非目标

- 不合并六个阶段。
- 不改变 OpenCode 宿主的 skill 注入机制。
- 不宣称 skill 或 Oracle 构成运行时强制 supervisor。
- 不新增 metis/momus agent。

## 已确认决策

- Metis 关闭，Momus 关闭。
- SDD、TDD、连续执行开启。
- Oracle 不再参与固定 plan-gate、放行或完成判定；仅按需 consult/analysis，审查对象优先为落盘 spec/plan。
- Explorer 与 Librarian 的研究结论必须有定位证据；缺失证据时阻塞并明确问题与影响。

## 验收标准

1. 六阶段顺序、旧阶段 skill 名称和注册链保持。
2. Sisyphus/Plan/Execute/Review/Finish 不再要求 Oracle plan-gate verdict 或双门禁。
3. Sisyphus 明确复杂架构/业务风险下的按需 Oracle 触发条件、输入和输出边界。
4. Explorer/Librarian 共用结构化研究结果协议，包含 claim、evidence、status、source_version、impact、open_questions、negative_findings。
5. 研究结果、Oracle 缺失上下文、CBM 降级和禁用 agent 均不得被伪造为成功。
6. 相关契约测试、typecheck、全量测试、build、dist/prompt 检查通过。

## 风险

- 旧测试和文档大量绑定 plan-gate、Momus 迁移语义，需要完整清理但保留 review 场景协议可复用性。
- Skill 只能通过宿主注入和 prompt 约定生效，不能提供真实运行时调用或强制审核。
- SDD 开启后新产物必须使用本任务专属路径，不能修改既有任务文件。
