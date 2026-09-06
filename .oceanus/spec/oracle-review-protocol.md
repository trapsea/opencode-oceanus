# Spec: 主 Agent 执行模式 + Oracle 统一审核协议改造

- 日期：2026-09-06
- 复杂度：Architecture
- 状态：approved

## 1. 背景与问题诊断

多轮调研（本仓现状、oh-my-openagent 源码、Codex/Claude Code 实践）确认当前编排的结构性成本：

- R1 没有"事实层"：所有知识靠 DelegationBrief 文本传递（plan/progress/CBM 定位审计，非 worker 消费输入）
- R2 冷启动会话：每次委派 = 新会话 = 零累积
- R3 brief 手工生成：主 agent 凭记忆写背景，写漏 = worker 缺上下文；fixer 禁止问用户只能 BLOCKED 回传
- R4 每个 subagent 重建世界模型：无事实缓存，worker 重复 read/grep/glob；阶段间重复发现
- R5 十个角色放大委派次数：explorer/oracle/metis/momus 四个只读会话边界重叠
- R6 六阶段+批问+双门禁对中小任务是固定开销

## 2. 改造方案（用户已批准）

### 2.1 主 agent 执行模式（Claude Code 验证过的模式）

- 主 agent（oceanus/sisyphus）编排 + 执行一体：读代码、编辑、跑测试、修复
- subagent 只保留只读角色：explorer（侦察/上下文隔离器）、librarian、observer、oracle（统一分析）
- fixer 降级为逃生舱：仅当「文件集完全不相交 + 改动机械同构 + 任务数 ≥3」才拆执行委派
- designer 收窄为视觉专业例外：仅视觉设计迭代任务（样式/布局/动效开发）；普通前端功能实现归主 agent
- Wave 写入调度退役（仅逃生舱场景保留）；只读并行保留
- DelegationBrief 保留 8 字段（逃生舱需要），新增只读调研简报（5 字段：goal/scope/background/return/deadline）
- explorer 返回契约强化：浓缩事实 + findings 落盘（.oceanus/findings/），对话只留摘要
- tool-loop-guard 放宽：同一文件在 write/edit/apply_patch 之后的重读不算重复（否则主 agent 执行循环被阻塞）

### 2.2 Oracle 统一审核（metis/momus 合并，skill 场景区分）

- 删除 metis、momus 两个 agent（agent 定义 + 注册 + 描述 + 引用全量切换）
- oracle 成为统一分析顾问平台，三场景：
  - consult（默认）：架构/调试/审查咨询——现有 oracle 人设
  - analysis（原 metis）：方案分析/背景研究/gap 分析——advisory 契约
  - gate（原 momus）：计划门禁 [OKAY]/[REJECT]——gate 契约，继承全部判定规则
- 场景指令不依赖 subagent 自发现 skill：委派时前置注入 <oracle_scene> 指令块（仿 oh-my-openagent load_skills 硬实现）
- 铁律：同一 work 内 gate 调用不得复用做过 analysis/consult 的会话（审查者 ≠ 方案参与者）；gate 会话亦不再用于咨询

### 2.3 统一审核协议（Review Protocol）

抽象六不变量为共享硬实现：
1. 审核对象是落盘 artifact（路径可寻址 + 白名单防注入）
2. verdict 契约三档：gate（[OKAY]/[REJECT] 阻断）/ graded（PASS/WARN/FAIL）/ advisory（不阻断）
3. findings 统一：severity(BLOCKER/SUGGESTION) + evidence(file:line) + fix
4. REJECT 受限循环：round 计数、只验前轮 BLOCKER + 新引入、3 轮上限 → 中断上报
5. 独立性：fresh-session 场景强制新会话
6. 审核者只读

场景注册表（reviewer 可插拔）：
- plan-gate（原 momus，oracle，gate，fresh-session，onReject=revise-plan）
- solution-analysis（原 metis analysis，oracle，advisory，reusable，onReject=escalate）
- diff-review（oracle，graded，fresh-session，onReject=return-execute）
- completion-audit（oracle，gate，fresh-session，onReject=return-execute）
- visual-acceptance（observer，graded，fresh-session，onReject=return-execute）
- consult 不进协议（开放问答，无对象无契约无循环）

不纳入协议（防过度抽象）：开放咨询、确定性验证命令（typecheck/test）、主 agent 每步自查。

### 2.4 执行配置批问：五项 → 四项

Metis 审核 + Momus 审核 合并为「Oracle 门禁审核」单项；SDD/TDD/连续执行授权不变。漏答回落推荐值规则不变。

## 3. 执行配置（用户 2026-09-06 批问抉择）

| 项 | 抉择 | 备注 |
|---|---|---|
| Metis 审核 | 关闭 | spec 记录残余风险：调研由主 agent 自查 |
| Momus 审核 | 关闭 | plan status 记录 SKIPPED_BY_USER 与残余风险 |
| SDD | 开启 | 本文档 + plan/progress/review 产物 |
| TDD | 开启 | 新协议模块测试先行 |
| 连续执行授权 | 授予 | 仅 3 轮循环到顶时中断上报 |

残余风险（Metis/Momus 审核关闭）：本次改造的方案风险由多轮源码调研 + 方案总批准人工门禁覆盖；plan 阶段将附自查 checklist 替代 momus 校验；Review 阶段以 CBM 影响面复查 + 全量测试兜底。

## 4. 验收标准

1. `bun run typecheck` 通过
2. `bun test` 全部通过（metis/momus 契约断言迁移到 review 场景产物上，不丢失覆盖）
3. `bun run build` + `bun run check:dist` 通过
4. 注册 agent 从 10 → 8（删 metis/momus）；oceanus/sisyphus prompt 含执行纪律段；oracle prompt 含场景路由段
5. review/protocol.ts 导出场景注册表与组装/解析函数，五个场景注册齐全（plan-gate/solution-analysis/diff-review/completion-audit/visual-acceptance；consult 为 oracle 基础人设不进协议），momus 原 BLOCKER 分级/max-3/最小修订集契约测试迁移保留
6. tool-loop-guard 对"编辑后重读"豁免有测试
7. skills 六阶段无 @metis/@momus 残留引用（grep 验证，文档历史除外）
8. README/AGENTS.md/docs 与新拓扑一致

## 5. 非目标

- 不实现 Context Pack 存储/失效（后续独立任务）
- 不实现 task→session 温池映射（后续独立任务）
- 不做 SQLite/MCP Context Memory 插件
- 不删除 fixer/designer agent 定义（仅路由语义降级；删除留待观察期后决策）
- 不改 CBM 二进制与工具集
