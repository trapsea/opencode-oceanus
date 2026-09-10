import { Model } from '@opencode-ai/plugin';
import {
  READONLY_AGENTS,
  READONLY_DEFAULT_PERMISSION,
  SUBAGENT_NAMES,
} from '../config/constants';
import type { AgentOverrideConfig, PluginConfig } from '../config/schema';
import { getAgentOverride, getDisabledAgents } from '../config/utils';
import { createSisyphusAgent } from './sisyphus';
import { createPrometheusAgent } from './prometheus';
import { createDesignerAgent } from './designer';
import { createExplorerAgent } from './explorer';
import { createFixerAgent } from './fixer';
import { createLibrarianAgent } from './librarian';
import { createObserverAgent } from './observer';
import { createOracleAgent } from './oracle';
import {
  type AgentDefinition,
  type ModelRef,
  createOceanusAgent,
} from './oceanus';
import { CHILD_BLOCKING_PROTOCOL } from './protocol';

export type { AgentDefinition } from './oceanus';
export { formatDelegationBrief, formatOracleBrief, getMissingOracleBriefFields, getMissingOracleSceneFields } from './orchestrator-context';
export type { DelegationBrief, OracleBrief, OracleScene } from './orchestrator-context';
const CHILD_BLOCKING_RULE = `\n${CHILD_BLOCKING_PROTOCOL}\n`;

/** 工厂可选项：当前仅写入策略（fixer/designer 消费，其余工厂忽略）。 */
export interface AgentFactoryOptions {
}

type AgentFactory = (
  model?: ModelRef,
  customPrompt?: string,
  customAppendPrompt?: string,
  options?: AgentFactoryOptions,
) => AgentDefinition;

const SUBAGENT_FACTORIES: Record<(typeof SUBAGENT_NAMES)[number], AgentFactory> =
  {
    explorer: createExplorerAgent,
    librarian: createLibrarianAgent,
    oracle: createOracleAgent,
    designer: createDesignerAgent,
    fixer: createFixerAgent,
    observer: createObserverAgent,
  };

/** 解析配置中的 model 字符串（provider/model#variant）为 v2 ModelRef */
function parseModelString(input: string): ModelRef | undefined {
  try {
    const ref = Model.Ref.parse(input);
    return { id: ref.id, providerID: ref.providerID, variant: ref.variant };
  } catch (error) {
    console.warn(
      `[opencode-oceanus] 无效的模型引用 "${input}":`,
      error instanceof Error ? error.message : String(error),
    );
    return undefined;
  }
}

/**
 * 从配置覆盖中解析主模型。
 * 仅支持字符串形式（provider/model#variant）；数组形式取第一个字符串项，
 * 其余字段（对象项）无法映射到 v2 的单个 ModelRef，返回 undefined 即跟随会话模型。
 */
function getPrimaryModelFromOverride(
  override: AgentOverrideConfig | undefined,
): ModelRef | undefined {
  const model = override?.model;
  const variant = override?.variant;
  let parsed: ModelRef | undefined;
  if (typeof model === 'string') {
    parsed = parseModelString(model);
  } else if (Array.isArray(model) && model.length > 0) {
    const first = model[0];
    parsed =
      typeof first === 'string'
        ? parseModelString(first)
        : parseModelString(first.id);
  }
  if (parsed && variant !== undefined) {
    parsed.variant = variant;
  }
  return parsed;
}

function applyOverrides(
  agent: AgentDefinition,
  override: AgentOverrideConfig,
): void {
  const model = getPrimaryModelFromOverride(override);
  if (model) {
    agent.model = model;
  }
  if (override.temperature !== undefined) {
    agent.temperature = override.temperature;
  }
  if (override.description) {
    agent.description = override.description;
  }
  if (override.color) {
    agent.color = override.color;
  }
  if (override.prompt) {
    agent.system = override.prompt;
  }
  if (override.displayName) agent.displayName = override.displayName;
  if (override.options) {
    agent.options = { ...agent.options, ...override.options };
  }
  if (override.permission !== undefined) agent.permission = override.permission;
  if (override.orchestratorPrompt) {
    agent.orchestratorPrompt = override.orchestratorPrompt;
  }
  if (override.skills) {
    agent.skills = override.skills;
  }
  if (override.mcps) {
    agent.mcps = override.mcps;
  }
  if (override.skills || override.mcps) {
    console.warn(
      `[opencode-oceanus] Agent '${agent.name}': skills/mcps 配置在 v2 Agent.Info 中没有直接字段，已忽略。`,
    );
  }
}

export type SubagentName = (typeof SUBAGENT_NAMES)[number];

export function isSubagent(name: string): name is SubagentName {
  return (SUBAGENT_NAMES as readonly string[]).includes(name);
}

/**
 * 创建所有 agent 定义（v2 Agent.Info 可写字段）。
 * oceanus 与 sisyphus 为主 agent，其余为子 agent。
 * 每个 agent 的模型：优先取配置文件中 agents.<name>.model，否则跟随当前会话模型。
 */
export function createAgents(
  config?: PluginConfig,
): AgentDefinition[] {
  const disabled = getDisabledAgents(config);


  // 1. 组装子 agent（应用配置覆盖）
  const subAgents = Object.entries(SUBAGENT_FACTORIES)
    .filter(([name]) => !disabled.has(name))
    .map(([name, factory]) => {
      const override = getAgentOverride(config, name);
      const model = getPrimaryModelFromOverride(override);
      const agent = factory(model, override?.prompt);

       if (!override?.prompt && agent.system) agent.system += CHILD_BLOCKING_RULE;

      if (override) {
        applyOverrides(agent, override);
      }

      // 只读 agent 在无显式 permission 时集中应用默认只读权限。
      // 显式 agents.<name>.permission 已在上方 applyOverrides 中设置，此处分支自动跳过。
      // explorer 与其他只读 agent 一致：不放开任何写路径（调研结果不落盘，回复内交付）。
       if (READONLY_AGENTS.has(name) && agent.permission === undefined) {
         agent.permission = READONLY_DEFAULT_PERMISSION;
      }
      return agent;
    });

  // 2. 创建 oceanus 主 agent
  const oceanusOverride = getAgentOverride(config, 'oceanus');
  const oceanus = createOceanusAgent(
    getPrimaryModelFromOverride(oceanusOverride),
    oceanusOverride?.prompt,
    undefined,
    disabled,
  );

  if (oceanusOverride) {
    applyOverrides(oceanus, oceanusOverride);
  }

  // 3. 创建 sisyphus 主 agent
  const sisyphusOverride = getAgentOverride(config, 'sisyphus');
  const sisyphusDisabled = disabled.has('sisyphus');
  let sisyphus: AgentDefinition | undefined;
  if (!sisyphusDisabled) {
    sisyphus = createSisyphusAgent(
      getPrimaryModelFromOverride(sisyphusOverride),
      sisyphusOverride?.prompt,
      undefined,
      disabled,
    );
    if (sisyphusOverride) {
      applyOverrides(sisyphus, sisyphusOverride);
    }
  }

  // 4. 创建 prometheus 规划主 agent（可禁用；受限权限在工厂内联设置，
  //    不追加 CHILD_BLOCKING_RULE——primary 直接面对用户，无父 agent 可反馈）
  const prometheusOverride = getAgentOverride(config, 'prometheus');
  const prometheusDisabled = disabled.has('prometheus');
  let prometheus: AgentDefinition | undefined;
  if (!prometheusDisabled) {
    prometheus = createPrometheusAgent(
      getPrimaryModelFromOverride(prometheusOverride),
      prometheusOverride?.prompt,
      undefined,
    );
    if (prometheusOverride) {
      applyOverrides(prometheus, prometheusOverride);
    }
  }

  return [
    oceanus,
    ...(sisyphus ? [sisyphus] : []),
    ...(prometheus ? [prometheus] : []),
    ...subAgents,
  ];
}

/** 供插件入口使用的最终 agent 定义列表 */
export function getAgentDefinitions(
  config?: PluginConfig,
): AgentDefinition[] {
  return createAgents(config);
}
