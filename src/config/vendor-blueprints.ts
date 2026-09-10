/**
 * 内置厂商 blueprint：为 `/oceanus-config` 提供各家厂商的默认
 * agent → model/variant 映射，生成用户级配置中的 preset。
 *
 * 数据来源：用户现有 opencode-oceanus.jsonc（zai/openai/deepseek/
 * ollama-cloud/opencode-go 逐字迁移，2026-09-10）+ 用户确认的默认建议
 * （default 同 ollama-cloud；aliyun/anthropic/gemini 为内置建议）。
 * 模型 ID 属可编辑数据，调整时只改本文件。
 *
 * agent 分层约定（沿用现有 jsonc 惯例）：
 * - 主力档：oceanus / sisyphus / prometheus / oracle（prometheus 与 oceanus 同模型）
 * - 轻量档：librarian / explorer
 * - 中间档：designer / fixer / observer（档位因厂商而异，以各 preset 显式覆盖为准）
 * - 已删除的 agent（metis/momus）不得再出现在任何 preset 中。
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
 * 组装完整 9-agent preset：主力档默认覆盖 oceanus/sisyphus/prometheus/oracle，
 * 轻量档覆盖 librarian/explorer，中间档（designer/fixer/observer）默认回落主力；
 * 与默认档位不同的条目经 overrides 显式覆盖（以用户 jsonc 逐字迁移为准）。
 */
function preset(
  primary: string,
  light: string,
  overrides: Partial<Record<string, AgentOverrideConfig>> = {},
): Preset {
  return {
    oceanus: p(primary),
    sisyphus: p(primary),
    prometheus: p(primary),
    oracle: p(primary),
    librarian: p(light),
    explorer: p(light),
    designer: p(primary),
    fixer: p(primary),
    observer: p(primary),
    ...overrides,
  };
}

/** 内置厂商清单（展示顺序即 question 选项顺序）。 */
export const VENDOR_BLUEPRINTS: readonly VendorBlueprint[] = [
  {
    name: 'default',
    displayName: '默认（Ollama Cloud / MiniMax）',
    providerPrefix: 'ollama-cloud',
    description: '现有默认配置：minimax-m3 主力 + deepseek-v4-flash 轻量，带 reasoning variant 分层。',
    supportsVariant: true,
    preset: preset('ollama-cloud/minimax-m3', 'ollama-cloud/deepseek-v4-flash', {
      oceanus: p('ollama-cloud/minimax-m3', 'high'),
      sisyphus: p('ollama-cloud/minimax-m3', 'high'),
      prometheus: p('ollama-cloud/minimax-m3', 'high'),
      oracle: p('ollama-cloud/minimax-m3', 'high'),
      librarian: p('ollama-cloud/deepseek-v4-flash', 'default'),
      explorer: p('ollama-cloud/deepseek-v4-flash', 'default'),
      designer: p('ollama-cloud/minimax-m3', 'medium'),
      fixer: p('ollama-cloud/minimax-m3', 'low'),
      observer: p('ollama-cloud/minimax-m3', 'medium'),
    }),
  },
  {
    name: 'zai',
    displayName: '智谱 ZAI Coding Plan（GLM）',
    providerPrefix: 'zai-coding-plan',
    description: 'GLM 编程套餐：glm-5.3 主力 + glm-4.7 轻量 + glm-5.3-flash 中间档，无 variant。',
    supportsVariant: false,
    preset: preset('zai-coding-plan/glm-5.3', 'zai-coding-plan/glm-4.7', {
      designer: p('zai-coding-plan/glm-5.3-flash'),
      observer: p('zai-coding-plan/glm-5.3-flash'),
    }),
  },
  {
    name: 'openai',
    displayName: 'OpenAI',
    providerPrefix: 'openai',
    description: 'gpt-5.6-terra 主力 + gpt-5.6-luna-fast 轻量，带 variant 分层。',
    supportsVariant: true,
    preset: preset('openai/gpt-5.6-terra', 'openai/gpt-5.6-luna-fast', {
      oracle: p('openai/gpt-5.6-terra', 'high'),
      librarian: p('openai/gpt-5.6-luna-fast', 'low'),
      explorer: p('openai/gpt-5.6-luna-fast', 'low'),
      designer: p('openai/gpt-5.6-terra', 'medium'),
      fixer: p('openai/gpt-5.6-luna-fast', 'low'),
      observer: p('openai/gpt-5.6-terra', 'medium'),
    }),
  },
  {
    name: 'deepseek',
    displayName: 'DeepSeek',
    providerPrefix: 'deepseek',
    description: 'deepseek-v4-flash 全家族，主力/轻量同模型，靠 variant 分层控制强度。',
    supportsVariant: true,
    preset: preset('deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-flash', {
      oracle: p('deepseek/deepseek-v4-flash', 'high'),
      librarian: p('deepseek/deepseek-v4-flash', 'low'),
      explorer: p('deepseek/deepseek-v4-flash', 'low'),
      designer: p('deepseek/deepseek-v4-flash', 'high'),
      fixer: p('deepseek/deepseek-v4-flash', 'low'),
      observer: p('deepseek/deepseek-v4-flash', 'high'),
    }),
  },
  {
    name: 'ollama-cloud',
    displayName: 'Ollama Cloud',
    providerPrefix: 'ollama-cloud',
    description: '与 default 相同的 Ollama Cloud 云端模型组合（独立 preset，便于与 default 区分管理）。',
    supportsVariant: true,
    preset: preset('ollama-cloud/minimax-m3', 'ollama-cloud/deepseek-v4-flash', {
      oceanus: p('ollama-cloud/minimax-m3', 'high'),
      sisyphus: p('ollama-cloud/minimax-m3', 'high'),
      prometheus: p('ollama-cloud/minimax-m3', 'high'),
      oracle: p('ollama-cloud/minimax-m3', 'high'),
      librarian: p('ollama-cloud/deepseek-v4-flash', 'default'),
      explorer: p('ollama-cloud/deepseek-v4-flash', 'default'),
      designer: p('ollama-cloud/minimax-m3', 'medium'),
      fixer: p('ollama-cloud/minimax-m3', 'low'),
      observer: p('ollama-cloud/minimax-m3', 'medium'),
    }),
  },
  {
    name: 'aliyun',
    displayName: '阿里云百炼 Token 套餐（Qwen）',
    providerPrefix: 'aliyun-token-plan',
    description: 'qwen3.5-coder-plus 主力 + qwen3.5-coder-flash 轻量，无 variant。',
    supportsVariant: false,
    preset: preset('aliyun-token-plan/qwen3.5-coder-plus', 'aliyun-token-plan/qwen3.5-coder-flash'),
  },
  {
    name: 'opencode-go',
    displayName: 'OpenCode Go（OpenCode 官方套餐）',
    providerPrefix: 'opencode-go',
    description: '经 OpenCode 官方网关的 GLM 套餐：glm-5.3 主力 + deepseek-v4-flash 轻量 + qwen-3.7-plus fixer 档，带 variant 分层。',
    supportsVariant: true,
    preset: preset('opencode-go/glm-5.3', 'opencode-go/deepseek-v4-flash', {
      oracle: p('opencode-go/glm-5.3', 'high'),
      librarian: p('opencode-go/deepseek-v4-flash', 'low'),
      explorer: p('opencode-go/deepseek-v4-flash', 'low'),
      designer: p('opencode-go/glm-5.3-flash', 'medium'),
      fixer: p('opencode-go/qwen-3.7-plus', 'low'),
      observer: p('opencode-go/glm-5.3-flash', 'medium'),
    }),
  },
  {
    name: 'anthropic',
    displayName: 'Anthropic Claude',
    providerPrefix: 'anthropic',
    description: 'claude-opus-4.6 主力 + claude-haiku-4.4 轻量，无 variant。',
    supportsVariant: false,
    preset: preset('anthropic/claude-opus-4.6', 'anthropic/claude-haiku-4.4'),
  },
  {
    name: 'gemini',
    displayName: 'Google Gemini',
    providerPrefix: 'gemini',
    description: 'gemini-3-pro 主力 + gemini-3-flash 轻量，无 variant。',
    supportsVariant: false,
    preset: preset('gemini/gemini-3-pro', 'gemini/gemini-3-flash'),
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
