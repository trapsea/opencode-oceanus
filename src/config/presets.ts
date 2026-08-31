import * as fs from 'node:fs';
import * as path from 'node:path';
import { AGENT_ALIASES } from './constants';
import { getConfigDir } from './paths';
import type { AgentOverrideConfig } from './schema';

export type UserConfig = Record<string, unknown>;

/** preset 定义：agent 名 → 覆盖配置（与 schema 的 presets 项一致）。 */
export type Preset = Record<string, AgentOverrideConfig>;

export interface UserPresetOptions {
  /** 覆盖默认的用户配置目录，主要用于测试或嵌入式调用。 */
  configDir?: string;
  /** 指定配置文件；未指定时按 jsonc、json 的优先级选择。 */
  configPath?: string;
}

export interface UpdatedUserPreset {
  path: string;
  config: UserConfig;
}

function stripJsonc(source: string): string {
  const comments = /\\"|"(?:\\"|[^"\\])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g;
  const trailingCommas = /\\"|"(?:\\"|[^"\\])*"|(,)(\s*[}\]])/g;

  return source
    .replace(comments, (match, comment: string | undefined) =>
      comment ? '' : match,
    )
    .replace(trailingCommas, (match, comma: string | undefined, closing: string) =>
      comma ? closing : match,
    );
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/** 选择用户级配置文件：已有 jsonc 优先于 json，新配置默认使用 jsonc。 */
export function getUserPresetConfigPath(configDir = getConfigDir()): string {
  const basePath = path.join(configDir, 'opencode-oceanus');
  const jsoncPath = `${basePath}.jsonc`;
  const jsonPath = `${basePath}.json`;

  if (isFile(jsoncPath)) return jsoncPath;
  if (isFile(jsonPath)) return jsonPath;
  return jsoncPath;
}

/** 读取一个用户配置文件；不存在的文件按空配置处理。 */
export function readUserConfig(configPath = getUserPresetConfigPath()): UserConfig {
  if (!isFile(configPath)) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonc(fs.readFileSync(configPath, 'utf8')));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无法解析用户配置 ${configPath}: ${message}`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`用户配置 ${configPath} 必须是 JSON 对象`);
  }
  return parsed as UserConfig;
}

/**
 * 原子更新用户配置的顶层 preset 字段。
 * 先完整读取并校验旧文件，再写入同目录临时文件并 rename，避免半写入配置。
 */
export function updateUserPreset(
  preset: string | null | undefined,
  options: UserPresetOptions = {},
): UpdatedUserPreset {
  const configPath = options.configPath ?? getUserPresetConfigPath(options.configDir);
  const configDir = path.dirname(configPath);
  const config = readUserConfig(configPath);

  if (preset === null || preset === undefined) {
    delete config.preset;
  } else {
    if (!preset.trim()) throw new Error('preset 不能为空');
    config.preset = preset;
  }

  fs.mkdirSync(configDir, { recursive: true });
  const temporaryPath = path.join(
    configDir,
    `.${path.basename(configPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  const mode = isFile(configPath) ? fs.statSync(configPath).mode & 0o777 : 0o600;

  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: 'utf8',
      mode,
    });
    fs.renameSync(temporaryPath, configPath);
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // 保留原始写入错误。
    }
    throw error;
  }

  return { path: configPath, config };
}

// 便于调用方使用更语义化的名称，同时保持单一实现。
export const selectUserConfigPath = getUserPresetConfigPath;
export const setUserPreset = updateUserPreset;

/**
 * preset 切换/管理结果。`message` 面向用户（TUI toast），不注入 LLM 上下文。
 * 参考 omo-slim：切换只落盘，不动 agent registry；新 preset 在下次
 * reload/新会话时由 loadPluginConfig 重新读盘合并生效。
 */
export interface PresetSwitchResult {
  ok: boolean;
  presetName: string;
  message: string;
  /** 每个 agent 的变更摘要，如 "explorer → model: x, variant: y"。 */
  summary: string[];
}

/** 把 preset 展平为按 agent 名（解析别名后）分组的覆盖摘要来源。 */
export function buildAgentUpdates(preset: Preset): Record<string, AgentOverrideConfig> {
  const updates: Record<string, AgentOverrideConfig> = {};
  for (const [agentName, override] of Object.entries(preset)) {
    const resolvedName = AGENT_ALIASES[agentName] ?? agentName;
    if (Object.keys(override).length > 0) {
      updates[resolvedName] = override;
    }
  }
  return updates;
}

/** 构建切换结果中每个 agent 的摘要行（展示用，不参与生效逻辑）。 */
export function buildPresetSummary(updates: Record<string, AgentOverrideConfig>): string[] {
  return Object.entries(updates).map(([name, override]) => `${name} → ${describeOverride(override)}`);
}

/** 单个 agent 覆盖配置的人类可读摘要。 */
export function describeOverride(override: AgentOverrideConfig): string {
  const bits: string[] = [];
  if (typeof override.model === 'string') {
    bits.push(override.model);
  } else if (Array.isArray(override.model) && override.model.length > 0) {
    const first = override.model[0];
    bits.push(typeof first === 'string' ? first : first.id);
  }
  if (typeof override.variant === 'string') bits.push(`variant=${override.variant}`);
  if (typeof override.temperature === 'number') bits.push(`temp=${override.temperature}`);
  if (override.skills?.length) bits.push(`skills=${override.skills.length}`);
  if (override.mcps?.length) bits.push(`mcps=${override.mcps.length}`);
  if (override.options && Object.keys(override.options).length > 0) bits.push('options');
  return bits.length > 0 ? bits.join(', ') : '(unset)';
}

/**
 * 仅通过磁盘状态切换 preset（omo-slim switchPresetOnDisk 语义）：
 * 校验 preset 存在后把名称持久化到用户级配置顶层 `preset`。
 * 本函数只负责落盘；会话内立即生效（当前会话模型切换 + registry 重建）
 * 由 /preset 命令层调用 switchSessionModel / rebuildAgents 完成。
 */
export function switchPresetOnDisk(
  presets: Record<string, Preset>,
  presetName: string,
  options: UserPresetOptions = {},
): PresetSwitchResult {
  const preset = presets[presetName];
  if (!preset) {
    const available = Object.keys(presets);
    const hint = available.length > 0
      ? `可用 preset：${available.join(', ')}`
      : '未配置任何 preset。请在用户级配置文件中定义 presets。';
    return {
      ok: false,
      presetName,
      message: `preset "${presetName}" 不存在。${hint}`,
      summary: [],
    };
  }

  const updates = buildAgentUpdates(preset);
  if (Object.keys(updates).length === 0) {
    return {
      ok: false,
      presetName,
      message: `preset "${presetName}" 为空（未定义任何 agent 覆盖）。`,
      summary: [],
    };
  }

  updateUserPreset(presetName, options);
  return {
    ok: true,
    presetName,
    message: `已保存 preset "${presetName}"。当前会话模型已立即切换，agent registry 已重建：后续 subagent 立即使用新模型。`,
    summary: buildPresetSummary(updates),
  };
}

/** 写入（创建或覆盖）用户级配置中的某个 preset。失败返回 false。 */
export function writePreset(name: string, preset: Preset, options: UserPresetOptions = {}): boolean {
  try {
    const configPath = options.configPath ?? getUserPresetConfigPath(options.configDir);
    const config = readUserConfig(configPath);
    const presets = (config.presets as Record<string, Preset> | undefined) ?? {};
    presets[name] = preset;
    config.presets = presets;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * 删除用户级配置中的某个 preset。preset 不存在或写入失败返回 false；
 * 删除的是当前激活 preset 时同时清除顶层 `preset` 字段。
 */
export function deletePreset(name: string, options: UserPresetOptions = {}): boolean {
  try {
    const configPath = options.configPath ?? getUserPresetConfigPath(options.configDir);
    const config = readUserConfig(configPath);
    const presets = config.presets as Record<string, Preset> | undefined;
    if (!presets || !(name in presets)) return false;
    delete presets[name];
    if (config.preset === name) delete config.preset;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** 在内存 preset 中设置（或替换）某个 agent 的覆盖配置；不可变，返回新对象。 */
export function setAgentOverride(preset: Preset, agentName: string, override: AgentOverrideConfig): Preset {
  return { ...preset, [agentName]: override };
}

/** 从内存 preset 中移除某个 agent；不可变；不存在时返回原对象。 */
export function removeAgentFromPreset(preset: Preset, agentName: string): Preset {
  if (!(agentName in preset)) return preset;
  const next = { ...preset };
  delete next[agentName];
  return next;
}
