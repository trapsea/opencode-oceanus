# Sisyphus 工作流与 Skill 契约澄清

状态: approved

## 目标

根据已确认的 32 项决策，统一 Sisyphus 六阶段工作流、Skill 元数据、CBM 生命周期、证据协议、视觉降级和 README/校验描述，消除相互矛盾的流程语义。

## 范围

- 六阶段 Skill 与支持型 Skill 的职责、入口、交接和状态流转；
- Intake/Review 的 CBM 初始化与刷新语义；
- Finish、Brainstorm、Execute 和视觉流程的已确认边界；
- Skill 注册元数据、README、CBM 文档和 dist 校验。

## 非目标

- 不改变 OpenCode v2 Skill 注入机制；
- 不新增 agent 或运行时 supervisor；
- 不修改既有用户未授权的业务功能；
- 不恢复 Oracle 固定 plan-gate 或 Finish 人工批准门禁。

## 验收标准

1. 六阶段顺序保持，Trivial 允许阶段内压缩并可审计记录。
2. Intake 首次初始化 CBM，Review 可刷新最终 diff 索引，均 fail-open 并记录证据。
3. Finish 不要求人工批准、不写入 learnings，并保持只读。
4. Brainstorm 主流程要求 Intake；支持只读调研，禁止写入 worker。
5. Skill 元数据包含 category，阶段交接使用共享最小 phase_handoff。
6. README 使用 OpenCode v2 subagent 官方能力与项目内部约定的准确描述。
7. typecheck、定向测试、全量测试、build、dist 校验和文档一致性检查通过。

## 已确认执行配置

- Oracle advisory: 开启，但仅按需提供建议，不构成门禁；
- SDD: 开启；
- TDD: 开启；
- 连续执行: 开启。
