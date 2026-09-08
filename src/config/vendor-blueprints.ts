/**
 * 内置厂商 blueprint：为 `/oceanus-config` 提供各家厂商的默认
 * agent → model/variant 映射，生成用户级配置中的 preset。
 *
 * 数据来源：用户现有 opencode-oceanus.jsonc（default/zai/openai/deepseek
 * 逐字迁移）+ 用户确认的默认建议（ollama-cloud/aliyun/opencode-go/
 * anthropic/gemini）。模型 ID 属可编辑数据，调整时只改本文件。
 *
 * agent 分层约定（沿用现有 jsonc 惯例）：
 * - 主力档：oceanus / sisyphus / oracle / metis / momus
 * - 轻量档：librarian / explorer
 * - 中间档：designer / fixer / observer（未提供中间模型时回落主力）
 */
import type { AgentOverrideConfig } from './schema';
import type { Preset } from './presets';

/** 厂商 blueprint：preset 数据 + 展示元信息。 */
export interface VendorBlueprint {
  /** preset 名（写入用户级配置 presets.<name>）。 */
  name: string;
  /** 展示名（question 选项文案）。 */
  displayName: string;
  /** 模型 provider 前缀（如 'zai-coding-plan'）。 */
  providerPrefix: string;
  /** 简要说明（厂商定位 / 计费方式提示）。 */
  description: string;
  /** 该厂商模型是否支持 reasoning variant 分层。 */
  supportsVariant: boolean;
  /** agent 名 → 覆盖配置。 */
  preset: Preset;
}

/** 单条 agent 覆盖的简写构造。 */
function p(model: string, variant?: string): AgentOverrideConfig {
  return variant ? { model, variant } : { model };
}

/**
 * 按分层规则组装 preset。
 *
 * @param primary 主力模型（主力档 + 中间档回落）
 * @param light 轻量模型（librarian / explorer）
 * @param tiers 各 agent 的 variant 映射（supportsVariant 的厂商使用）
 * @param mid 可选中间档模型（designer / fixer / observer）
 */
function buildPreset(
  primary: string,
  light: string,
  tiers: Record<string, string> = {},
  mid?: string,
): Preset {
  return {
    oceanus: p(primary, tiers.oceanus),
    sisyphus: p(primary, tiers.sisyphus),
    oracle: p(primary, tiers.oracle),
    metis: p(primary, tiers.metis),
    momus: p(primary, tiers.momus),
    librarian: p(light, tiers.librarian),
    explorer: p(light, tiers.explorer),
    designer: p(mid ?? primary, tiers.designer),
    fixer: p(mid ?? primary, tiers.fixer),
    observer: p(mid ?? primary, tiers.observer),
  };
}

/** 与用户 jsonc 中 openai/deepseek 一致的 reasoning variant 分层。 */
const TIERED_HIGH: Record<string, string> = {
  oracle: 'high',
  metis: 'high',
  momus: 'high',
  librarian: 'low',
  explorer: 'low',
  designer: 'medium',
  fixer: 'low',
  observer: 'medium',
};

const TIERED_DEEPSEEK: Record<string, string> = {
  ...TIERED_HIGH,
  designer: 'high',
  observer: 'high',
};

/** default preset 的 variant 分层（oceanus/sisyphus 也带 high）。 */
const TIERED_DEFAULT: Record<string, string> = {
  ...TIERED_HIGH,
  oceanus: 'high',
  sisyphus: 'high',
  librarian: 'default',
  explorer: 'default',
};

/** 内置厂商清单（展示顺序即 question 选项顺序）。 */
export const VENDOR_BLUEPRINTS: readonly VendorBlueprint[] = [
  {
    name: 'default',
    displayName: '默认（Ollama Cloud / MiniMax）',
    providerPrefix: 'ollama-cloud',
    description: '现有默认配置：minimax-m3 主力 + deepseek-v4-flash 轻量，带 reasoning variant 分层。',
    supportsVariant: true,
    preset: buildPreset(
      'ollama-cloud/minimax-m3',
      'ollama-cloud/deepseek-v4-flash',
      TIERED_DEFAULT,
    ),
  },
  {
    name: 'zai',
    displayName: '智谱 ZAI Coding Plan（GLM）',
    providerPrefix: 'zai-coding-plan',
    description: 'GLM 编程套餐：glm-5.3 主力 + glm-4.7 轻量 + glm-5.3-flash 中间档，无 variant。',
    supportsVariant: false,
    preset: buildPreset('zai-coding-plan/glm-5.3', 'zai-coding-plan/glm-4.7', {}, 'zai-coding-plan/glm-5.3-flash'),
  },
  {
    name: 'openai',
    displayName: 'OpenAI',
    providerPrefix: 'openai',
    description: 'gpt-5.6-luna 主力 + gpt-5.4-mini-fast 轻量 + gpt-5.6-luna-fast 中间档，带 variant 分层。',
    supportsVariant: true,
    preset: buildPreset(
      'openai/gpt-5.6-luna',
      'openai/gpt-5.4-mini-fast',
      TIERED_HIGH,
      'openai/gpt-5.6-luna-fast',
    ),
  },
  {
    name: 'deepseek',
    displayName: 'DeepSeek',
    providerPrefix: 'deepseek',
    description: 'deepseek-v4-flash 全家族，主力/轻量同模型，靠 variant 分层控制强度。',
    supportsVariant: true,
    preset: buildPreset('deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-flash', TIERED_DEEPSEEK),
  },
  {
    name: 'ollama-cloud',
    displayName: 'Ollama Cloud',
    providerPrefix: 'ollama-cloud',
    description: '与 default 相同的 Ollama Cloud 云端模型组合（独立 preset，便于与 default 区分管理）。',
    supportsVariant: true,
    preset: buildPreset(
      'ollama-cloud/minimax-m3',
      'ollama-cloud/deepseek-v4-flash',
      TIERED_DEFAULT,
    ),
  },
  {
    name: 'aliyun',
    displayName: '阿里云百炼 Token 套餐（Qwen）',
    providerPrefix: 'aliyun-token-plan',
    description: 'qwen3.5-coder-plus 主力 + qwen3.5-coder-flash 轻量，无 variant。',
    supportsVariant: false,
    preset: buildPreset(
      'aliyun-token-plan/qwen3.5-coder-plus',
      'aliyun-token-plan/qwen3.5-coder-flash',
    ),
  },
  {
    name: 'opencode-go',
    displayName: 'OpenCode Go（OpenCode 官方套餐）',
    providerPrefix: 'opencode',
    description: '经 OpenCode 官方网关：gpt-5.6-luna 主力 + gpt-5.4-mini-fast 轻量，带 variant 分层。',
    supportsVariant: true,
    preset: buildPreset('opencode/gpt-5.6-luna', 'opencode/gpt-5.4-mini-fast', TIERED_HIGH, 'opencode/gpt-5.6-luna-fast'),
  },
  {
    name: 'anthropic',
    displayName: 'Anthropic Claude',
    providerPrefix: 'anthropic',
    description: 'claude-opus-4.6 主力 + claude-haiku-4.4 轻量，无 variant。',
    supportsVariant: false,
    preset: buildPreset('anthropic/claude-opus-4.6', 'anthropic/claude-haiku-4.4'),
  },
  {
    name: 'gemini',
    displayName: 'Google Gemini',
    providerPrefix: 'gemini',
    description: 'gemini-3-pro 主力 + gemini-3-flash 轻量，无 variant。',
    supportsVariant: false,
    preset: buildPreset('gemini/gemini-3-pro', 'gemini/gemini-3-flash'),
  },
];

/** 列出全部内置厂商 blueprint（新数组，调用方可安全排序/过滤）。 */
export function listVendorBlueprints(): VendorBlueprint[] {
  return [...VENDOR_BLUEPRINTS];
}

/** 按名称取厂商 blueprint；不存在返回 undefined。 */
export function getVendorBlueprint(name: string): VendorBlueprint | undefined {
  return VENDOR_BLUEPRINTS.find((v) => v.name === name);
}

/** question 选项展示行：如 `zai — 智谱 ZAI Coding Plan（GLM）：主力 glm-5.3 / 轻量 glm-4.7`。 */
export function describeVendorBlueprint(blueprint: VendorBlueprint): string {
  const primary = blueprint.preset.oceanus?.model;
  const light = blueprint.preset.librarian?.model;
  const bits: string[] = [];
  if (typeof primary === 'string') bits.push(`主力 ${primary.split('/').pop()}`);
  if (typeof light === 'string') bits.push(`轻量 ${light.split('/').pop()}`);
  return `${blueprint.name} — ${blueprint.displayName}：${bits.join(' / ') || blueprint.description}`;
}
