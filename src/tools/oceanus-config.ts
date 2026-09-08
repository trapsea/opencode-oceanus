/**
 * oceanus_config_generate 工具：把厂商 blueprint 落盘为用户级配置 preset。
 *
 * 供 oceanus agent 在 `/oceanus-config` 对话流程中调用；写入动作由确定性
 * 代码完成（blueprint → writePreset），不让 LLM 手写 JSON，避免写坏配置。
 *
 * 语义：
 * - vendor 必须是内置 blueprint 名；overwrite=false 时同名 preset 已存在
 *   返回 conflict（由 agent 问用户是否覆盖后重试 overwrite=true）。
 * - activate=true 时同时把顶层 preset 字段切换为该厂商（落盘语义，
 *   下次 reload/新会话生效；当前会话立即切换用 `/preset <name>`）。
 * - 任何分支不抛异常，统一结构化 result（与现有工具 fail-open 语义一致）。
 */
import {
  getVendorBlueprint,
  listVendorBlueprints,
  type VendorBlueprint,
} from '../config/vendor-blueprints';
import {
  buildPresetSummary,
  readUserConfig,
  switchPresetOnDisk,
  writePreset,
  type Preset,
  type UserPresetOptions,
} from '../config/presets';
import type { ToolDefinition } from '../runtime/types';

/** 可注入依赖（测试用）。 */
export interface OceanusConfigToolDeps {
  /** 读取用户级配置（默认 presets.readUserConfig）。 */
  readUserConfig?: (configPath?: string) => Record<string, unknown>;
  /** 写入 preset（默认 presets.writePreset）。 */
  writePreset?: (name: string, preset: Preset, options?: UserPresetOptions) => boolean;
  /** 切换激活 preset（默认 presets.switchPresetOnDisk）。 */
  switchPresetOnDisk?: (
    presets: Record<string, Preset>,
    name: string,
    options?: UserPresetOptions,
  ) => { ok: boolean; message: string; summary: string[] };
  /** 用户配置路径选项（测试隔离）。 */
  userPresetOptions?: UserPresetOptions;
}

export interface GenerateResult {
  ok: boolean;
  status: 'written' | 'conflict' | 'unknown-vendor' | 'error';
  vendor: string;
  message: string;
  summary?: string[];
  availableVendors?: string[];
}

/** 生成（或覆盖）厂商 preset；不抛异常。 */
export async function generateVendorPreset(
  vendor: string,
  options: { overwrite?: boolean; activate?: boolean } = {},
  deps: OceanusConfigToolDeps = {},
): Promise<GenerateResult> {
  const blueprint = getVendorBlueprint(vendor);
  if (!blueprint) {
    return {
      ok: false,
      status: 'unknown-vendor',
      vendor,
      message: `未知厂商 "${vendor}"。`,
      availableVendors: listVendorBlueprints().map((v) => v.name),
    };
  }
  const readConfig = deps.readUserConfig ?? readUserConfig;
  const doWritePreset = deps.writePreset ?? writePreset;
  const doSwitch = deps.switchPresetOnDisk ?? switchPresetOnDisk;
  const userOptions = deps.userPresetOptions ?? {};

  try {
    const existing = readUserConfig(userOptions.configPath) as {
      presets?: Record<string, Preset>;
    };
    const conflict = Boolean(existing.presets?.[vendor]);
    if (conflict && !options.overwrite) {
      return {
        ok: false,
        status: 'conflict',
        vendor,
        message: `用户配置中已存在 preset "${vendor}"。确认覆盖请用 overwrite=true 重试；用户自定义厂商请走 writePreset 语义避免误覆盖。`,
        summary: buildPresetSummary(blueprint.preset),
      };
    }
    if (!doWritePreset(vendor, blueprint.preset, userOptions)) {
      return {
        ok: false,
        status: 'error',
        vendor,
        message: `写入 preset "${vendor}" 失败（磁盘写入错误）。`,
      };
    }
    const summary = buildPresetSummary(blueprint.preset);
    let activateMessage = '';
    if (options.activate) {
      const presets = (readConfig(userOptions.configPath).presets ?? {}) as Record<string, Preset>;
      const switched = doSwitch(presets, vendor, userOptions);
      activateMessage = switched.ok
        ? `已激活 preset "${vendor}"（下次 reload/新会话生效；当前会话立即切换可用 /preset ${vendor}）。`
        : `激活失败：${switched.message}`;
    }
    return {
      ok: true,
      status: 'written',
      vendor,
      message: [
        `已${conflict ? '覆盖' : '生成'} preset "${vendor}"（${blueprint.displayName}）并写入用户级配置。`,
        activateMessage,
      ]
        .filter(Boolean)
        .join(' '),
      summary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: 'error',
      vendor,
      message: `oceanus_config_generate 执行失败: ${message}`,
    };
  }
}

/** 构建注册到宿主的工具定义（直接工具：codemode 由注册层统一注入）。 */
export function buildOceanusConfigTool(deps: OceanusConfigToolDeps = {}): ToolDefinition {
  return {
    name: 'oceanus_config_generate',
    description:
      '把内置厂商 blueprint 生成（或覆盖）为用户级 opencode-oceanus 配置中的 preset。入参：vendor（内置厂商名）、overwrite（同名 preset 已存在时是否覆盖，默认 false 返回 conflict）、activate（是否同时设为激活 preset，默认 false）。返回结构化结果与各 agent → model 摘要。',
    input: {
      type: 'object',
      properties: {
        vendor: {
          type: 'string',
          description: '内置厂商名',
          enum: listVendorBlueprints().map((v: VendorBlueprint) => v.name),
        },
        overwrite: { type: 'boolean', description: '同名 preset 已存在时是否覆盖（默认 false）' },
        activate: { type: 'boolean', description: '生成后同时设为激活 preset（默认 false）' },
      },
      required: ['vendor'],
      additionalProperties: false,
    },
    async execute(input: unknown) {
      const args = (input ?? {}) as { vendor?: unknown; overwrite?: unknown; activate?: unknown };
      const vendor = typeof args.vendor === 'string' ? args.vendor : '';
      const result = await generateVendorPreset(
        vendor,
        {
          overwrite: args.overwrite === true,
          activate: args.activate === true,
        },
        deps,
      );
      return { content: JSON.stringify(result, null, 2) };
    },
  };
}
