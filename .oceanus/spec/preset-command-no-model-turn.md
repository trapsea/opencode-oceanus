# `/preset` 命令无模型 Turn 反馈设计

## 目标

`/preset` 只执行配置切换和 agent registry 刷新，不通过 `session.prompt` 回写结果，避免模型把命令反馈当成新任务而继续执行其它工作。

## 已确认决策

- 切换不主动中断当前任务。
- 成功/查询路径不创建新的模型 turn。
- 不新增 TUI Toast 通信架构；状态通过 sidebar 和配置读取确认。
- command description 与运行时 skill 必须说明真实行为。

## 设计

- `createPresetCommand` 不再依赖/调用 `reply`；成功和查询直接返回。
- 失败路径抛出异常给宿主命令层，并记录可诊断错误；不把错误再次投递给模型。
- 更新命令描述：`/preset` 查询；`/preset <name>` 切换当前 location，立即刷新当前 registry，不中断当前任务，不创建新模型任务。
- 更新 `src/skills/opencode-oceanus.ts` 中的旧说明，删除“请 reload/新会话”“只写用户级配置”“项目级覆盖导致不生效”等已过时描述。
- 保留现有配置、agent reload 和 sidebar watcher 行为。

## 验收

- 成功、查询、失败路径均不调用 `ctx.session.prompt` / `reply`。
- 命令功能和限制在 description/skill 文案中一致。
- 成功切换仍完成写入、fresh config、registry reload；失败由命令层可见地抛出。
- 相关测试、typecheck、build 通过；现有用户变更不被覆盖。

## Metis 分析

Metis 已跳过：澄清后仅剩已批准的单一路径，无待比较的方案；API 风险已通过 librarian 对官方类型和仓库类型核对。残余风险是宿主如何展示 execute 抛出的错误，记录为测试与真实 host smoke 的开放项。
