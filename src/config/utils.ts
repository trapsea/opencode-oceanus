import { DEFAULT_DISABLED_AGENTS, PROTECTED_AGENTS } from './constants';
import type {
  AgentBrowserConfig,
  AgentOverrideConfig,
  AutoUpdateConfig,
  CodebaseMemoryConfig,
  CodebaseMemoryUiConfig,
  HookConfig,
  PluginConfig,
  ToolConfig,
} from './schema';

export interface AutoUpdateResolvedConfig {
  enabled: boolean;
  checkIntervalMs: number;
  /** 更新成功后及检查周期兜底时清理历史版本目录（默认 true）。 */
  cleanup: boolean;
}

/** 默认 3 小时：每进程仅一次检查（订阅后 2s 定时器），跨进程由该窗口节流。 */
const DEFAULT_AUTO_UPDATE_CONFIG: AutoUpdateResolvedConfig = {
  enabled: true,
  checkIntervalMs: 10_800_000,
  cleanup: true,
};

/** 获取自动更新配置，缺省时启用并按 checkIntervalMs（默认 3 小时）节流检查。 */
export function getAutoUpdateConfig(
  config?: PluginConfig,
): AutoUpdateResolvedConfig {
  const raw: AutoUpdateConfig | undefined = config?.autoUpdate;
  return { ...DEFAULT_AUTO_UPDATE_CONFIG, ...raw };
}

export interface AgentBrowserResolvedConfig {
  /** 能力总开关，默认 true（能力可用；per-task 是否启用仍由批问第四项决定）。 */
  enabled: boolean;
  /** 探测缺失时自动安装，默认 false（npm 安装 + Chrome 下载需显式授权）。 */
  autoInstall: boolean;
  version?: string;
  binaryPath?: string;
}

/**
 * agent-browser 默认配置：能力开、自动安装关。
 * 截图落盘目录由 agent-browser skill 文案固定为 `.oceanus/media/browser/<task-id>/`
 * （对齐 image-materializer 的 `.oceanus/media/` 约定），不作为可配置项暴露。
 */
const DEFAULT_AGENT_BROWSER_CONFIG: AgentBrowserResolvedConfig = {
  enabled: true,
  autoInstall: false,
};

/** 获取 agent-browser 配置（缺省字段回落默认值）。 */
export function getAgentBrowserConfig(
  config?: PluginConfig,
): AgentBrowserResolvedConfig {
  const raw: AgentBrowserConfig | undefined = config?.agentBrowser;
  return { ...DEFAULT_AGENT_BROWSER_CONFIG, ...raw };
}

/** agent-browser 能力是否启用（关闭则批问不出现第四项、setup 不探测）。 */
export function isAgentBrowserEnabled(config?: PluginConfig): boolean {
  return getAgentBrowserConfig(config).enabled;
}

/** agent-browser 探测缺失时是否自动安装（显式 opt-in）。 */
export function isAgentBrowserAutoInstallEnabled(config?: PluginConfig): boolean {
  return getAgentBrowserConfig(config).autoInstall;
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

/**
 * 解析 orchestratorVision 配置：
 * - 'false' → 主模型不支持视觉（prompt 阶段移除图片附件）
 * - 'true' → 支持视觉（保留图片附件）
 * - 'auto' / 未配置 → 默认按支持处理（保留图片，物化 + 追加提示兜底）
 */
export function isOrchestratorVisionSupported(
  config: PluginConfig | undefined,
): boolean {
  return config?.orchestratorVision !== 'false';
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
