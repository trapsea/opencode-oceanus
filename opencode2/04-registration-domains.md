# 注册类域：Agent / Skill / Command / Catalog

> 版本基线：`@opencode-ai/plugin@0.0.0-beta-18721` + `@opencode-ai/schema@0.0.0-beta-18721`
> 证据源：tarball `promise/{agent,skill,command,catalog}.d.ts`、schema `{agent,skill,prompt-input,session-inbox}.d.ts`；官方文档 agents/skills/commands 页（v1/v2 混杂已甄别，标注处见下文）。

## 1. AgentDomain

```ts
interface AgentDraft {
  list(): readonly DeepMutable<Agent.Info>[]
  get(id: string): DeepMutable<Agent.Info> | undefined
  default(id: string | undefined): void        // 设置默认 agent
  update(id: string, update: (agent: DeepMutable<Agent.Info>) => void): void
  remove(id: string): void
}
interface AgentDomain extends AgentApi {
  readonly transform: Transform<AgentDraft>
  readonly reload: () => Promise<void>
}
```

注意：AgentDraft **没有 `add()`**——插件注册 agent 的方式是 `update(id, ...)` 一个尚不存在的 id 时创建（与 SkillDraft 的 `add` 不同）。宿主先加载配置文件/markdown agent，插件经 transform 补充或改写；改完调用 `reload()` 生效。

### Agent.Info（schema `agent.d.ts`）

```ts
interface Info {
  id: Agent.ID
  name: Agent.Name
  model?: { id: Model.ID; providerID: Provider.ID; variant?: Model.VariantID }  // 单个 ModelRef，非数组
  request: {
    settings: Record<string, any>   // 模型参数（temperature 等）
    headers: Record<string, string>
    body: Record<string, any>
  }
  system?: string                   // 系统提示词
  description?: string
  mode: "subagent" | "primary" | "all"
  hidden: boolean
  color?: string                    // TUI 显示色
  steps?: number                    // 最大迭代步数
  permissions: Array<{ action: string; resource: string; effect: "allow" | "deny" | "ask" }>
}
```

默认值：`mode: "primary"`、`hidden: false`、`request: {settings:{}, headers:{}, body:{}}`。

**适配注意**：`model` 是单个 ModelRef；配置中的模型数组只能取首项。权限为 `action/resource/effect` 三元组数组（`resource` 支持 glob 模式，如 `task` 子代理调用控制——官方 agents 页口径，与 schema 一致）。

## 2. SkillDomain

```ts
interface SkillDraft {
  list(): readonly DeepMutable<Skill.Info>[]
  add(skill: Skill.Info): void
  update(id: string, update: (skill: DeepMutable<Skill.Info>) => void): void
  remove(id: string): void
}
interface SkillDomain extends SkillApi {
  readonly transform: Transform<SkillDraft>
  readonly reload: () => Promise<void>
}
```

### Skill.Info（schema `skill.d.ts`）

```ts
interface Info {
  id: Skill.ID
  name: Skill.Name                 // 官方约束：1-64 字符，小写字母数字+连字符
  description?: string             // 1-1024 字符（官方）
  slash?: boolean                  // 是否注册为 /命令
  autoinvoke?: boolean
  location: AbsolutePath           // skill 内容文件的绝对路径（宿主按需读取）
  content: string                  // SKILL.md 正文内容
}
```

- 插件注册 skill：`draft.add({ id, name, description, content, location, ... })`，**不要依赖未公开的 `source()`**。
- skill 通过宿主 `skill` 工具暴露给 agent；`slash: true` 的 skill 同时出现在命令目录（实测宿主 command 列表中 skill 与 command 混排）。
- 文件系统 skill 目录：`.opencode/skills/<name>/SKILL.md`（frontmatter：name/description/license/compatibility/metadata）；宿主兼容 `.claude/`、`.agents/` 路径（官方 skills 页）。
- 变更事件：`skill.updated`（schema skill.d.ts Event）。

## 3. CommandDomain

```ts
interface CommandInvocation {
  readonly sessionID: Session.ID
  readonly prompt: PromptInput.Prompt       // 可变：构造发送给会话的提示词
  readonly delivery: SessionInbox.Delivery  // 投递方式
}
interface CommandDefinition {
  readonly name: string
  readonly description?: string
  readonly execute: (input: CommandInvocation) => Promise<void>
}
interface CommandDraft { add(definition: CommandDefinition): void }
interface CommandDomain extends Pick<CommandApi, "list"> {
  readonly transform: Transform<CommandDraft>
  readonly reload: () => Promise<void>
}
```

- 命令执行 = 往 session 投递 prompt：在 `execute` 内组装 `input.prompt` 与 `input.delivery`（官方 v1 文档的 `$ARGUMENTS`/`$1`/`!`shell``/`@file` 模板语法属于 **markdown 命令文件**机制，位于 `.opencode/commands/*.md`，与插件命令并行，不适用于 `CommandDraft`）。
- 官方 commands 页 frontmatter（description/agent/model/subtask）同样属于 markdown 命令文件口径。

## 4. CatalogDomain

```ts
interface CatalogDraft {
  readonly provider: {
    list(): readonly CatalogProviderRecord[]       // { provider, models: Map<modelID, Model.Info> }
    get(providerID: string): CatalogProviderRecord | undefined
    update(providerID, update: (provider: DeepMutable<Provider.Info>) => void): void
    remove(providerID: string): void
  }
  readonly model: {
    get(providerID, modelID): DeepMutable<Model.Info> | undefined
    update(providerID, modelID, update: (model) => void): void
    remove(providerID, modelID: string): void
    readonly default: {
      get(): { providerID: string; modelID: string } | undefined
      set(providerID: string, modelID: string): void
    }
  }
}
interface CatalogDomain extends CatalogApi {
  readonly transform: Transform<CatalogDraft>
  readonly reload: () => Promise<void>
}
```

用途：改写/隐藏 provider 与 model 元数据（名称、上下文限制等）、设置默认模型。与 `catalog` 相关的还有 `Context.generate`（见 06）。

## 5. 版本兼容锚点

| 事实 | 状态（18230 → 18721） |
|---|---|
| AgentDraft / SkillDraft / CommandDraft / CatalogDraft | 无变化 |
| Agent.Info（mode/steps/hidden/permissions） | 无变化 |
| Skill.Info | 无变化（prompt 附件中的 skills 数组新增 optional `text` 字段，属消费侧） |
| markdown agent/command 文件机制 | 官方文档口径，类型层无直接体现；宿主实测 command 目录含 init/review 内置命令 |
