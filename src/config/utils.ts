import { DEFAULT_DISABLED_AGENTS, PROTECTED_AGENTS } from './constants';
import type {
  AgentOverrideConfig,
  HookConfig,
  PluginConfig,
  ToolConfig,
} from './schema';

/** 获取某个 agent 的配置覆盖 */
export function getAgentOverride(
  config: PluginConfig | undefined,
  name: string,
): AgentOverrideConfig | undefined {
  return config?.agents?.[name];
}

/** 计算禁用 agent 集合，受 PROTECTED_AGENTS 保护 */
export function getDisabledAgents(config?: PluginConfig): Set<string> {
  const userDisabled = config?.disabled_agents;
  const disabledSource = Array.isArray(userDisabled)
    ? userDisabled
    : DEFAULT_DISABLED_AGENTS;
  const disabled = new Set<string>();
  for (const name of disabledSource) {
    if (!PROTECTED_AGENTS.has(name)) {
      disabled.add(name);
    }
  }
  return disabled;
}

/** 按名称索引工具配置的宽松访问类型（schema 为具名严格对象）。 */
type ToolConfigMap = Record<string, ToolConfig | undefined>;
type HookConfigMap = Record<string, HookConfig | undefined>;

/** 计算禁用工具集合 */
export function getDisabledTools(config?: PluginConfig): Set<string> {
  return new Set(config?.disabled_tools ?? []);
}

/** 计算禁用 Hook 集合 */
export function getDisabledHooks(config?: PluginConfig): Set<string> {
  return new Set(config?.disabled_hooks ?? []);
}

/** 获取某个工具的结构化配置（未配置返回 undefined） */
export function getToolConfig(
  config: PluginConfig | undefined,
  name: string,
): ToolConfig | undefined {
  return (config?.tools as ToolConfigMap | undefined)?.[name];
}

/** 获取某个 Hook 的结构化配置（未配置返回 undefined） */
export function getHookConfig(
  config: PluginConfig | undefined,
  name: string,
): HookConfig | undefined {
  return (config?.hooks as HookConfigMap | undefined)?.[name];
}

/**
 * 判断工具是否启用。
 * 优先级：disabled_tools > item.enabled > 默认 true。
 */
export function isToolEnabled(
  config: PluginConfig | undefined,
  name: string,
): boolean {
  if (getDisabledTools(config).has(name)) return false;
  return getToolConfig(config, name)?.enabled ?? true;
}

/**
 * 判断 Hook 是否启用。
 * 优先级：disabled_hooks > item.enabled > 默认 true。
 */
export function isHookEnabled(
  config: PluginConfig | undefined,
  name: string,
): boolean {
  if (getDisabledHooks(config).has(name)) return false;
  return getHookConfig(config, name)?.enabled ?? true;
}
