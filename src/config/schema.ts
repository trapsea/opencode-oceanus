import { z } from 'zod';

// Permission 规则：允许单个 action 或 pattern→action 映射
const PermissionActionSchema = z.enum(['ask', 'allow', 'deny']);

const PermissionRuleSchema = z.union([
  PermissionActionSchema,
  z.record(z.string(), PermissionActionSchema),
]);

const PermissionObjectSchema = z
  .object({
    read: PermissionRuleSchema.optional(),
    edit: PermissionRuleSchema.optional(),
    glob: PermissionRuleSchema.optional(),
    grep: PermissionRuleSchema.optional(),
    list: PermissionRuleSchema.optional(),
    bash: PermissionRuleSchema.optional(),
    task: PermissionRuleSchema.optional(),
    lsp: PermissionRuleSchema.optional(),
    skill: PermissionRuleSchema.optional(),
    todowrite: PermissionActionSchema.optional(),
    question: PermissionActionSchema.optional(),
    webfetch: PermissionActionSchema.optional(),
    websearch: PermissionActionSchema.optional(),
    codesearch: PermissionActionSchema.optional(),
  })
  .catchall(PermissionRuleSchema);

export const PermissionConfigSchema = z.union([
  PermissionActionSchema,
  PermissionObjectSchema,
]);

/**
 * 单个 agent 的覆盖配置（区别于 SDK 的 AgentConfig）。
 * 与 omo-slim 的 AgentOverrideConfigSchema 对齐，支持独立配置每个 agent 的模型。
 */
export const AgentOverrideConfigSchema = z
  .object({
    model: z
      .union([
        z.string(),
        z
          .array(
            z.union([
              z.string(),
              z.object({
                id: z.string(),
                variant: z.string().optional(),
              }),
            ]),
          )
          .min(1),
      ])
      .optional(),
    temperature: z.number().min(0).max(2).optional(),
    variant: z.string().optional().catch(undefined),
    skills: z.array(z.string()).optional(),
    mcps: z.array(z.string()).optional(),
    prompt: z.string().min(1).optional(),
    orchestratorPrompt: z.string().min(1).optional(),
    options: z.record(z.string(), z.unknown()).optional(),
    displayName: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    color: z.string().min(1).optional(),
    permission: PermissionConfigSchema.optional(),
  })
  .strict();

/**
 * 单个工具的结构化配置。
 * 仅包含通用开关与本次 Wave 1 工具会用到的参数；
 * 未提供的字段表示使用默认值，`.strict()` 拒绝未知字段。
 */
export const ToolConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    timeoutMs: z.number().int().positive().optional(),
    maxMatches: z.number().int().positive().optional(),
    maxOutputBytes: z.number().int().positive().optional(),
    dryRun: z.boolean().optional(),
    maxFileBytes: z.number().int().positive().optional(),
  })
  .strict();

/**
 * 单个 Hook 的结构化配置。
 * 与 ToolConfigSchema 类似，`.strict()` 拒绝未知字段。
 */
export const HookConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    maxOutputBytes: z.number().int().positive().optional(),
    warnAt: z.number().int().nonnegative().optional(),
    blockAt: z.number().int().nonnegative().optional(),
    maxSessions: z.number().int().positive().optional(),
  })
  .strict();

/**
 * 本次 Wave 1 引入的工具集合。
 * 使用 `.strict()` 的具名对象：未知工具名会被 schema 拒绝（规格：未知工具必须被报告）。
 */
export const ToolsConfigSchema = z
  .object({
    ast_grep_search: ToolConfigSchema.optional(),
    ast_grep_replace: ToolConfigSchema.optional(),
    hashline_edit: ToolConfigSchema.optional(),
    task_status: ToolConfigSchema.optional(),
    task_result: ToolConfigSchema.optional(),
    task_cancel: ToolConfigSchema.optional(),
    cbm_status: ToolConfigSchema.optional(),
    cbm_index: ToolConfigSchema.optional(),
    cbm_search_graph: ToolConfigSchema.optional(),
    cbm_trace: ToolConfigSchema.optional(),
    cbm_code: ToolConfigSchema.optional(),
    cbm_query: ToolConfigSchema.optional(),
    cbm_detect_changes: ToolConfigSchema.optional(),
  })
  .strict();

/** 本次 Wave 1 引入的 Hook 集合，同样拒绝未知 Hook 名。 */
export const HooksConfigSchema = z
  .object({
    apply_patch: HookConfigSchema.optional(),
    tool_output_truncator: HookConfigSchema.optional(),
    json_error_recovery: HookConfigSchema.optional(),
    tool_loop_guard: HookConfigSchema.optional(),
    task_registry_observer: HookConfigSchema.optional(),
    cbm_guidance: HookConfigSchema.optional(),
  })
  .strict();

/**
 * codebase-memory-mcp 的 Web UI 配置。
 * 默认不自动启动 UI（`autoStart=false`）；host/port/open 均可配置覆盖。
 * `.strict()` 拒绝未知字段。
 */
export const CodebaseMemoryUiConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    autoStart: z.boolean().optional(),
    host: z.string().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    open: z.boolean().optional(),
  })
  .strict();

/**
 * codebase-memory-mcp 集成配置。
 * 仅包含开关、版本/路径与生命周期控制；缺省字段使用默认值（见 utils.ts）。
 * `.strict()` 拒绝未知字段。
 */
export const CodebaseMemoryConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    autoDownload: z.boolean().optional(),
    version: z.string().min(1).optional(),
    binaryPath: z.string().min(1).optional(),
    cacheDir: z.string().min(1).optional(),
    autoIndex: z.boolean().optional(),
    indexOnStart: z.boolean().optional(),
    mcp: z.boolean().optional(),
    cliFallback: z.boolean().optional(),
    guidance: z.boolean().optional(),
    ui: CodebaseMemoryUiConfigSchema.optional(),
  })
  .strict();

/**
 * 插件配置文件 schema。
 * 配置文件支持 .json/.jsonc，路径规则同 omo-slim：
 * 用户级 ~/.config/opencode/opencode-oceanus.{json,jsonc}，
 * 项目级 <project>/.opencode/opencode-oceanus.{json,jsonc}（项目优先）。
 */
export const PluginConfigSchema = z
  .object({
    preset: z.string().min(1).optional(),
    presets: z
      .record(z.string(), z.record(z.string(), AgentOverrideConfigSchema))
      .optional(),
    agents: z.record(z.string(), AgentOverrideConfigSchema).optional(),
    disabled_agents: z.array(z.string()).optional(),
    disabled_tools: z.array(z.string()).optional(),
    disabled_hooks: z.array(z.string()).optional(),
    tools: ToolsConfigSchema.optional(),
    hooks: HooksConfigSchema.optional(),
    codebaseMemory: CodebaseMemoryConfigSchema.optional(),
  })
  .strict();

export type PluginConfig = z.infer<typeof PluginConfigSchema>;
export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>;
export type ToolConfig = z.infer<typeof ToolConfigSchema>;
export type HookConfig = z.infer<typeof HookConfigSchema>;
export type ToolsConfig = z.infer<typeof ToolsConfigSchema>;
export type HooksConfig = z.infer<typeof HooksConfigSchema>;
export type CodebaseMemoryConfig = z.infer<
  typeof CodebaseMemoryConfigSchema
>;
export type CodebaseMemoryUiConfig = z.infer<
  typeof CodebaseMemoryUiConfigSchema
>;
