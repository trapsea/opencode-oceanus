/**
 * Oceanus 原生 v2 运行时 —— 最小本地类型适配（tooling-9-v2-wiring）。
 *
 * 我们不依赖 `@opencode-ai/plugin` 的内部导出路径（ToolDomain / SessionDomain /
 * ToolContext 等未在插件根入口稳定导出），而是定义与宿主持久 API 形状兼容的
 * 最小结构契约。生产代码在 `src/index.ts` 中以 `as unknown as ToolingContext`
 * 注入真实 ctx；本模块只供 wiring 内部与测试使用，不伪造任何宿主行为。
 *
 * 与 beta 类型不一致处（已记录不确定性）：
 * - 插件 `SessionDomain` 的 `Pick<SessionApi, ...>` 未包含 `active`，但底层
 *   client 存在 `session.active()`。因此 `SessionLike.active?` 采用运行时特性
 *   探测（`typeof session.active === 'function'`），缺省回退到 `get`。
 * - 工作区根目录优先取 `session.get().location.directory`（`Session.Info` 已
 *   暴露该绝对路径），它等价于"该会话所在项目目录的 canonical 根"，无需再经
 *   project API 解析。若未来宿主暴露 project.canonical，可在此替换解析来源。
 */
import type { Tool } from '@opencode/schema/tool';

/** 会话信息的最小契约（对应 v2 `Session.Info` 的可用字段）。 */
export interface SessionInfoLike {
  id?: string;
  agent?: string;
  parentID?: string;
  projectID?: string;
  outcome?: 'succeeded' | 'failed' | 'interrupted';
  location?: { directory?: string; workspaceID?: string };
}

/**
 * 会话 API 的最小契约（宿主 `ctx.session` 结构兼容）。
 *
 * 契约（Wave 2A，由 smoke/setup-resilience.test.ts 与
 * runtime/production-task-harness.test.ts 锁定）：
 * 宿主 `ctx.session` 是 SessionDomain API 对象，**不含** `sessionID` / `id`
 * 属性——会话身份只存在于具体会话的事件 payload 与 ToolContext 中。
 * setup 期不存在真实会话，禁止从本对象读取或伪造 parent sessionID；
 * 需要会话身份时必须由调用方（工具 `context.sessionID`、事件
 * `event.sessionID` / `data.sessionID`）显式传入。
 */
export interface SessionLike {
  get?(input: { sessionID: string }): Promise<SessionInfoLike | undefined>;
  /** beta 类型未暴露 `active`；用可选字段 + 运行时探测。 */
  active?(): Promise<Record<string, unknown> | { data?: Record<string, unknown> }>;
  /**
   * 官方 v2 插件文档 `SessionContext.interrupt(input)` 返回 Promise<void>。
   * 允许返回显式对象以便测试/未来实现提供更多语义：
   * - `void`（正常返回）视为成功；
   * - 显式 `{ interrupted: false }` 视为失败。
   */
  interrupt?(input: { sessionID: string; continue?: boolean }): Promise<void | { interrupted?: boolean }>;
  /**
   * 官方 v2 插件文档 `SessionContext.prompt(input)`：向既有会话追加用户输入。
   * 对已完成 subagent 子会话继续 prompt 是插件续用会话的候选路径（是否被宿主
   * 接受/是否保留上下文为运行时能力，插件据此 fail-open 降级）。
   */
  prompt?(input: {
    sessionID: string;
    text: string;
    delivery?: 'steer' | 'queue';
    id?: string;
  }): Promise<unknown>;
  /** 官方 v2 插件文档 `SessionContext.wait(input)`：等待会话空闲/结束。 */
  wait?(input: { sessionID: string }): Promise<unknown>;
  /**
   * 官方 v2 插件文档 `SessionContext.context(input)`：读取会话消息列表
   * （`Promise<readonly SessionMessageInfo[]>`）。
   * 宿主未暴露该能力时运行时探测缺省，调用方 fail-open 降级为无内容。
   */
  context?(input: { sessionID: string }): Promise<unknown[] | undefined>;
}

/** Tool execute 上下文的最小契约（对应 v2 `ToolContext`）。 */
export interface ToolContextLike {
  readonly sessionID: string;
  readonly agent?: string;
  readonly messageID?: string;
  readonly id?: string;
}

/** 工具 execute 的返回结果（对应 v2 `Tool.Result`）。 */
export type ToolResult = Tool.Result;

/** 注册用工具定义（对应 v2 `Tool.Info`，input 以未知 JSON schema 传入）。 */
export interface ToolDefinition {
  name: string;
  description: string;
  input: unknown;
  execute(input: any, context: ToolContextLike): Promise<ToolResult>;
  /**
   * 对应宿主 `Tool.Info.output`（beta-18743 实证）：execute 返回的
   * `Tool.Result` 若声明 `output` 字段，工具定义必须携带 output schema，
   * 否则宿主以 "Tool result declared output without an output schema" 拒绝。
   */
  output?: unknown;
  /**
   * 对应宿主 `Tool.Options`（@opencode-ai/schema beta-18743）。
   *
   * 关键语义（宿主 Tool registry 实证，见 docs/opencode-v2-compatibility.md）：
   * - `codemode === false` → 进入会话直接工具目录（definitions），所有
   *   会话/agent（含 subagent）可直接调用；
   * - `codemode !== false`（含缺省）→ 进入 Code Mode catalog，只能在宿主
   *   `execute` 工具的 JS 运行时内经 `tools.<name>` 调用。
   * 宿主原生 write/edit/webfetch/websearch 均显式 `codemode: false`。
   * `permission` 缺省时宿主以工具名作为 permission action，须与
   * config/constants.ts 的 permission 表 key 对齐。
   */
  options?: {
    namespace?: string;
    permission?: string;
    codemode?: boolean;
  };
}

/** wiring 用 Tool transform draft 的最小契约。 */
export interface ToolDraftLike {
  add(tool: ToolDefinition): void;
}

/**
 * 本地 MCP server 的最小契约（对应 v2 `Mcp.LocalConfig`）。
 * `command` 必须为数组（参数数组模式，绝不启用 shell）。
 */
export interface MCPLocalConfigLike {
  type: 'local';
  command: string[];
  cwd?: string;
  environment?: Record<string, string>;
  disabled?: boolean;
  codemode?: boolean;
}

/** 远程 MCP server 的最小契约（对应 v2 `Mcp.RemoteConfig`）。 */
export interface MCPRemoteConfigLike {
  type: 'remote';
  url: string;
  headers?: Record<string, string>;
  disabled?: boolean;
  codemode?: boolean;
}

/** MCP server 配置的并集（对应 v2 `Mcp.ServerConfig`）。 */
export type MCPServerConfigLike = MCPLocalConfigLike | MCPRemoteConfigLike;

/** wiring 用 MCP transform draft 的最小契约（对应 v2 `MCPDraft`）。 */
export interface MCPDraftLike {
  list(): readonly [string, MCPServerConfigLike][];
  get(name: string): MCPServerConfigLike | undefined;
  set(name: string, config: MCPServerConfigLike): void;
  update(name: string, update: (config: MCPServerConfigLike) => void): void;
  remove(name: string): void;
}

/** wiring 用 MCP domain 的最小契约（`ctx.mcp`）。 */
export interface MCPDomainLike {
  transform(cb: (draft: MCPDraftLike) => void): Promise<unknown>;
  reload(): Promise<void>;
}

/** wiring 用完整上下文（`ctx.tool` + `ctx.session` + `ctx.mcp` 的最小镜像）。 */
export interface ToolingContext {
  readonly tool: {
    transform(cb: (draft: ToolDraftLike) => void): Promise<unknown>;
    hook(name: string, cb: (event: any) => Promise<void> | void): Promise<unknown>;
  };
  readonly session: SessionLike;
  readonly mcp: MCPDomainLike;
}

/** 命令回复入参的最小透传形状（只透传 sessionID / text / delivery）。 */
export interface PromptInputLike {
  sessionID: string;
  text: string;
  delivery: 'steer' | 'queue';
}

/**
 * v2 插件 setup ctx 的最小结构（仅含本插件使用的域）。
 *
 * 生产代码在 `src/index.ts` 中以 `ctx as unknown as PluginSetupContext` 注入真实
 * ctx；本类型只供入口接线（CBM-13）与 smoke 测试使用，不伪造宿主行为。
 * agent/skill/command 的 transform draft 形状较复杂，此处用 `any` 保持最小契约，
 * 具体 draft 方法由各 transform 回调内部使用。
 */
export interface PluginSetupContext {
  /**
   * 新宿主（service 多项目模式，按项目 scope 实例化插件）注入的项目位置：
   * `ctx.location.directory` 为该实例绑定项目目录的绝对路径（与
   * `Session.Info.location.directory` 同源）。
   *
   * 说明：`@opencode-ai/plugin`（beta-18721+）的 `Context` 类型已正式声明
   * `location: Location.Info`；运行时字段仍可能为空或缺失（类型声明不等于
   * 运行时保证），统一经 `runtime/host-adapter` 的 `resolvePluginDirectory`
   * 解析，禁止散落取值。
   */
  location?: { directory?: string };
  /**
   * 旧宿主/参考实现注入的项目目录（omo-slim 以 `ctx.directory` 作为按项目
   * 配置的键）。仅作兼容兜底：新宿主应优先读取 `ctx.location.directory`。
   *
   * 说明：`@opencode-ai/plugin` 类型（beta-18721+）的 `Context` 未声明该
   * 旧字段，但旧宿主运行时会为每个项目 scope 独立实例化插件并注入对应目录。
   * 新旧字段均未提供（或为空）时，调用方回退到 process.cwd()
   * （统一走 `resolvePluginDirectory`）。
   */
  directory?: string;
  agent: {
    transform(cb: (draft: any) => void): Promise<unknown>;
    reload(): Promise<void>;
  };
  skill: {
    transform(cb: (draft: any) => void): Promise<unknown>;
    reload(): Promise<void>;
  };
  command: {
    transform(cb: (draft: any) => void): Promise<unknown>;
    reload(): Promise<void>;
  };
  session: SessionLike & {
    prompt(input: PromptInputLike): Promise<unknown>;
    /** /preset 命令所需：读取会话当前 agent、切换模型、注入 synthetic 回执。 */
    get?(input: { sessionID: string }): Promise<SessionInfoLike | undefined>;
    switchModel?(input: { sessionID: string; model: { providerID: string; id: string; variant?: string } }): Promise<void>;
    synthetic?(input: { sessionID: string; text: string }): Promise<unknown>;
  };
  tool: ToolingContext['tool'];
  mcp: MCPDomainLike;
}

/** v2 事件总线中 session.created 的真实 payload 形状。 */
export interface SessionCreatedEvent {
  type: 'session.created';
  data: { sessionID: string; parentID?: string };
}
