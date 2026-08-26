import { loadPluginConfig } from '../config/loader';
import { getUserPresetConfigPath, readUserConfig, updateUserPreset, type UserPresetOptions } from '../config/presets';
import type { CommandDefinition, CommandInvocation } from './types';

export interface PresetCommandOptions extends UserPresetOptions {}

export async function runPresetCommand(
  args: readonly string[] = [],
  options: PresetCommandOptions = {},
): Promise<{ current: string | undefined; presets: string[] } | { preset: string }> {
  const config = (options.configDir || options.configPath
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
  updateUserPreset(argument, options);
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
  reply: (
    text: string,
    invocation: CommandInvocation,
  ) => Promise<void>;
}

/**
 * 构造 preset command：
 * - 切换成功 → `reloadAgents()` 一次 + `reply(成功消息)`
 * - 查询路径 → 仅 `reply(...)`
 * - 未知 / 写入失败 → 仅 `reply(失败消息)`，不 reload、不抛
 */
export function createPresetCommand(handlers: PresetCommandHandlers): CommandDefinition {
  return {
    name: 'preset',
    description: '查看或切换 Oceanus preset',
    async execute(invocation) {
      try {
        const argument = invocation.prompt.text.split(/\s+/).filter(Boolean);
        const result = await handlers.runPreset(argument);
        if ('preset' in result) {
          // 切换成功：先刷新 agent registry，再回写消息。
          await handlers.reloadAgents();
          await handlers.reply(
            `已刷新 agent registry 为 preset: ${result.preset}。当前 session 可能仍需新建会话以应用更改。`,
            invocation,
          );
          return;
        }
        // 查询路径：仅读取，不 reload。
        await handlers.reply(
          `Current preset: ${result.current ?? '(none)'}; available: ${result.presets.join(', ')}。此命令仅读取配置；项目级 preset 可能覆盖最终生效值。请 reload 或开启新会话使配置生效。`,
          invocation,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await handlers.reply(`Preset command failed: ${message}`, invocation);
      }
    },
  };
}
