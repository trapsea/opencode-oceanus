/**
 * Commands 目录化聚合入口。
 *
 * 每个 command 独占一个模块并显式声明自身依赖的 handlers；`createCommands(deps)`
 * 按命令名命名空间注入依赖，返回可被 `ctx.command.transform` 的 `draft.add`
 * 逐个注册的 `CommandDefinition[]`。
 *
 * 注意：`/preset` 走 v2 server command 通道（斜杠补全与提交拦截消费
 * server 的 command.list；TUI keymap layer 在插件上下文中无法进入宿主
 * 可达命令集）。切换语义：落盘 + 当前会话 switchModel 立即生效 +
 * registry 立即重建；TUI sidebar 由其 fs.watch 监听自动刷新。
 *
 * 新增 command：新建模块（如 `foo.ts`）导出其 factory，在 {@link CommandsDeps}
 * 声明对应依赖分组，并在 {@link createCommands} 的数组中加入一条即可。
 */
import { createPresetCommand } from './preset';
import type { PresetCommandHandlers } from './preset';
import type { CommandDefinition } from './types';

export type { CommandDefinition, CommandInvocation } from './types';
export type { PresetCommandHandlers } from './preset';

/**
 * command 依赖集合：key 为命令名，value 为该命令所需的最小 handlers 集合。
 * 只声明当前用到的能力，不引入全量 ctx 依赖。
 */
export interface CommandsDeps {
  preset: PresetCommandHandlers;
}

/** 聚合工厂：注入一次依赖，返回全部 command 定义。 */
export function createCommands(deps: CommandsDeps): CommandDefinition[] {
  return [createPresetCommand(deps.preset)];
}
