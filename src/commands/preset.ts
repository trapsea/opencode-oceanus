import { getProjectPresetConfigPath, loadPluginConfig } from '../config/loader';
import { getUserPresetConfigPath, readUserConfig, updateUserPreset, type UserPresetOptions } from '../config/presets';
import type { CommandDefinition, CommandInvocation } from './types';

export interface PresetCommandOptions extends UserPresetOptions {
  /** 当前 location；指定后切换写入项目级配置。 */
  directory?: string;
}

export async function runPresetCommand(
  args: readonly string[] = [],
  options: PresetCommandOptions = {},
): Promise<{ current: string | undefined; presets: string[] } | { preset: string }> {
  const config = (options.directory
    ? loadPluginConfig({ directory: options.directory })
    : options.configDir || options.configPath
    ? readUserConfig(options.configPath ?? getUserPresetConfigPath(options.configDir))
    : loadPluginConfig({ directory: process.cwd() })) as {
      preset?: string;
      presets?: Record<string, unknown>;
    };
  const presets = Object.keys(config.presets ?? {}).sort();
  const argument = args.join(' ').trim();
  if (!argument) return { current: config.preset, presets };
  if (!presets.includes(argument)) {
    throw new Error(`Unknown preset: ${argument}（未知 preset）`);
  }
  updateUserPreset(
    argument,
    options.directory
      ? { configPath: getProjectPresetConfigPath(options.directory) }
      : options,
  );
  return { preset: argument };
}

/**
 * preset command 执行所需的外部依赖集合。
 *
 * 通过工厂注入而不是直接耦合 `ctx` / 插件运行时，便于在测试中替换为
 * 内存 spy，并确保运行时只持有真正需要的能力（reload、reply）。
 */
export interface PresetCommandHandlers {
  /**
   * 实际执行 preset 逻辑；签名与 {@link runPresetCommand} 一致。
   * 测试可注入 `runPresetCommand` 的部分应用以覆盖 configDir / configPath。
   */
  runPreset: (
    args: readonly string[],
    options?: PresetCommandOptions,
  ) => Promise<{ current: string | undefined; presets: string[] } | { preset: string }>;
  /** 切换 preset 成功时调用一次，用于刷新 agent registry。 */
  reloadAgents: () => Promise<void>;
  /**
   * 向当前 session 写回文本反馈。
   * 实现方必须只透传 sessionID / text / delivery，禁止转发 `invocation.prompt.skills`
   * 等其他字段，避免在响应消息中重复触发用户原 prompt 的 skill 引用。
   */
  /** 兼容旧注入方；preset 不再调用该回调，避免触发新的模型 turn。 */
  reply?: (
    text: string,
    invocation: CommandInvocation,
  ) => Promise<void>;
}

/**
 * 构造 preset command：
 * - 切换成功 → `reloadAgents()` 一次后直接返回，不创建新的模型 turn
 * - 查询路径 → 直接返回，不写配置、不 reload
 * - 未知 / 写入失败 → 抛出诊断错误，不 reload
 */
export function createPresetCommand(handlers: PresetCommandHandlers): CommandDefinition {
  return {
    name: 'preset',
    description: '查看或切换 Oceanus preset。/preset 查询；/preset <name> 切换当前目录 preset，立即刷新 agent，不中断当前任务，也不会创建新的模型任务。',
    async execute(invocation) {
      try {
        const argument = invocation.prompt.text.split(/\s+/).filter(Boolean);
        const result = await handlers.runPreset(argument);
        if ('preset' in result) {
          // 切换成功：只刷新 registry，不把反馈作为新 prompt 投递给模型。
          await handlers.reloadAgents();
          return;
        }
        // 查询路径：仅读取，不 reload，也不触发模型 turn。
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Preset command failed（preset 命令执行失败）: ${message}`, {
          cause: error,
        });
      }
    },
  };
}
