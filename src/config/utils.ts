import { DEFAULT_DISABLED_AGENTS, PROTECTED_AGENTS } from './constants';
import type { AgentOverrideConfig, PluginConfig } from './schema';

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
