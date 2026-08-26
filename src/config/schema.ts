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
    options: z.record(z.string(), z.unknown()).optional(),
    displayName: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    color: z.string().min(1).optional(),
    permission: PermissionConfigSchema.optional(),
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
    agents: z.record(z.string(), AgentOverrideConfigSchema).optional(),
    disabled_agents: z.array(z.string()).optional(),
    disabled_tools: z.array(z.string()).optional(),
  })
  .strict();

export type PluginConfig = z.infer<typeof PluginConfigSchema>;
export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>;
