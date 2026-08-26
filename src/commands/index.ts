/**
 * Commands 目录化聚合入口。
 *
 * 每个 command 独占一个模块并显式声明自身依赖的 handlers；`createCommands(deps)`
 * 按命令名命名空间注入依赖（本次仅 `preset`），返回可被
 * `ctx.command.transform` 的 `draft.add` 逐个注册的 `CommandDefinition[]`。
 *
 * 新增 command：新建模块（如 `foo.ts`）导出其 factory，在 {@link CommandsDeps}
 * 声明对应依赖分组，并在 {@link createCommands} 的数组中加入一条即可。
 */
import { createCbmCommand } from '../cbm/commands';
import type { CbmCommandHandlers } from '../cbm/commands';
import { createPresetCommand } from './preset';
import type { PresetCommandHandlers } from './preset';
import type { CommandDefinition } from './types';

export type { CommandDefinition, CommandInvocation } from './types';
export type { PresetCommandHandlers, PresetCommandOptions } from './preset';
export type { CbmCommandHandlers, CbmInstallStatus } from '../cbm/commands';
export { createCbmCommand, defaultInstallStatus } from '../cbm/commands';
// 兼容旧 `./commands`（即 src/commands.ts）的导入面。
export { createPresetCommand, runPresetCommand } from './preset';

/**
 * command 依赖集合：key 为命令名，value 为该命令所需的最小 handlers 集合。
 * 只声明当前用到的能力，不引入全量 ctx 依赖。
 */
export interface CommandsDeps {
  preset: PresetCommandHandlers;
  cbm: CbmCommandHandlers;
}

/** 聚合工厂：注入一次依赖，返回全部 command 定义。 */
export function createCommands(deps: CommandsDeps): CommandDefinition[] {
  return [createPresetCommand(deps.preset), createCbmCommand(deps.cbm)];
}
