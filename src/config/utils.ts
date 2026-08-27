import { DEFAULT_DISABLED_AGENTS, PROTECTED_AGENTS } from './constants';
import type {
  AgentOverrideConfig,
  AutoUpdateConfig,
  CodebaseMemoryConfig,
  CodebaseMemoryUiConfig,
  HookConfig,
  PluginConfig,
  TaskReuseConfig,
  ToolConfig,
} from './schema';

export interface AutoUpdateResolvedConfig {
  enabled: boolean;
  checkIntervalMs: number;
}

const DEFAULT_AUTO_UPDATE_CONFIG: AutoUpdateResolvedConfig = {
  enabled: true,
  checkIntervalMs: 3_600_000,
};

/** 获取自动更新配置，缺省时启用并每小时检查一次。 */
export function getAutoUpdateConfig(
  config?: PluginConfig,
): AutoUpdateResolvedConfig {
  const raw: AutoUpdateConfig | undefined = config?.autoUpdate;
  return { ...DEFAULT_AUTO_UPDATE_CONFIG, ...raw };
}

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

/** codebase-memory-mcp 默认固定版本（官方当前受支持基线）。 */
export const DEFAULT_CODEBASE_MEMORY_VERSION = '0.10.8';

/** 解析后的 codebase-memory UI 配置（缺省字段已补齐）。 */
export interface CodebaseMemoryResolvedUi {
  enabled: boolean;
  autoStart: boolean;
  host: string;
  port: number;
  open: boolean;
}

/** 解析后的 codebase-memory 集成配置（缺省字段已补齐）。 */
export interface CodebaseMemoryResolvedConfig {
  enabled: boolean;
  autoDownload: boolean;
  version: string;
  binaryPath?: string;
  cacheDir?: string;
  autoIndex: boolean;
  indexOnStart: boolean;
  mcp: boolean;
  cliFallback: boolean;
  guidance: boolean;
  ui: CodebaseMemoryResolvedUi;
}

/** 返回 codebase-memory 配置的默认值。 */
export function getDefaultCodebaseMemoryConfig(): CodebaseMemoryResolvedConfig {
  return {
    enabled: true,
    autoDownload: true,
    version: DEFAULT_CODEBASE_MEMORY_VERSION,
    autoIndex: true,
    indexOnStart: false,
    mcp: true,
    cliFallback: true,
    guidance: true,
    ui: {
      enabled: true,
      autoStart: false,
      host: '127.0.0.1',
      port: 9749,
      open: false,
    },
  };
}

/**
 * 获取解析后的 codebase-memory 配置：显式字段覆盖默认值，缺省字段回落到默认。
 * 只对 codebaseMemory 顶层及其 ui 子对象做一层补齐（不做深递归合并）。
 */
export function getCodebaseMemoryConfig(
  config?: PluginConfig,
): CodebaseMemoryResolvedConfig {
  const defaults = getDefaultCodebaseMemoryConfig();
  const raw: CodebaseMemoryConfig | undefined = config?.codebaseMemory;
  if (!raw) return defaults;
  return {
    ...defaults,
    ...raw,
    ui: {
      ...defaults.ui,
      ...(raw.ui as CodebaseMemoryUiConfig | undefined),
    },
  };
}

/** codebase-memory 集成是否启用（默认 true）。 */
export function isCodebaseMemoryEnabled(config?: PluginConfig): boolean {
  return getCodebaseMemoryConfig(config).enabled;
}

/** 是否自动下载/安装 canonical release（默认 true）。 */
export function isCodebaseMemoryAutoDownloadEnabled(
  config?: PluginConfig,
): boolean {
  return getCodebaseMemoryConfig(config).autoDownload;
}

/** 首次结构化查询前是否自动建索引（默认 true）。 */
export function isCodebaseMemoryAutoIndexEnabled(
  config?: PluginConfig,
): boolean {
  return getCodebaseMemoryConfig(config).autoIndex;
}

/** 插件启动阶段是否立即全量索引（默认 false）。 */
export function isCodebaseMemoryIndexOnStart(config?: PluginConfig): boolean {
  return getCodebaseMemoryConfig(config).indexOnStart;
}

/** MCP 主通道是否启用（默认 true）。 */
export function isCodebaseMemoryMcpEnabled(config?: PluginConfig): boolean {
  return getCodebaseMemoryConfig(config).mcp;
}

/** CLI 兜底工具是否启用（默认 true）。 */
export function isCodebaseMemoryCliFallbackEnabled(
  config?: PluginConfig,
): boolean {
  return getCodebaseMemoryConfig(config).cliFallback;
}

/** 调度引导提示是否启用（默认 true）。 */
export function isCodebaseMemoryGuidanceEnabled(
  config?: PluginConfig,
): boolean {
  return getCodebaseMemoryConfig(config).guidance;
}

/** UI 是否自动启动（默认 false）。 */
export function isCodebaseMemoryUiAutoStart(config?: PluginConfig): boolean {
  return getCodebaseMemoryConfig(config).ui.autoStart;
}

/** 解析后的 subagent 复用配置（缺省字段已补齐）。 */
export interface TaskReuseResolvedConfig {
  enabled: boolean;
  ttlMs: number;
  maxRetained: number;
}

export const DEFAULT_TASK_REUSE_CONFIG: TaskReuseResolvedConfig = {
  enabled: true,
  ttlMs: 2 * 60 * 60 * 1000,
  maxRetained: 16,
};

/** 获取解析后的 subagent 复用配置：显式字段覆盖默认值。 */
export function getTaskReuseConfig(
  config?: PluginConfig,
): TaskReuseResolvedConfig {
  const raw: TaskReuseConfig | undefined = config?.taskReuse;
  return { ...DEFAULT_TASK_REUSE_CONFIG, ...raw };
}
