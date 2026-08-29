import type { CommandDefinition, CommandInvocation } from './types';

/**
 * `/preset` server command（v2 命令通道）。
 *
 * 为什么是 server command 而不是 TUI keymap：宿主 TUI 的斜杠补全与提交
 * 拦截都消费 `command.list`（server 命令表，/cbm 等同通道）；插件 TUI
 * keymap layer 在无宿主 Solid owner 的上下文中注册不进可达命令集。
 *
 * 行为：
 * - `/preset`：查询——通过 session.synthetic 注入当前 preset 与可用列表
 *   （不触发 LLM turn）。
 * - `/preset <name>`：落盘切换 + 当前会话 switchModel 立即生效 + 重建
 *   agent registry（后续 subagent 立即用新模型），并 synthetic 回执。
 *   TUI sidebar 由 fs.watch 指纹监听自动刷新（~100ms）。
 */
export interface PresetCommandHandlers {
  /** 列出 { 当前 preset, 可用 presets }。 */
  listPresets: () => { current: string | undefined; presets: Record<string, unknown> };
  /** 落盘切换；返回 ok/message/summary。 */
  switchPreset: (name: string) => { ok: boolean; message: string; summary: string[] };
  /** 当前会话立即切换到 preset 中该 agent 的模型（若定义）；返回描述文本。 */
  switchSessionModel: (sessionID: string, presetName: string) => Promise<string | null>;
  /** 重建 agent registry（新 subagent 立即生效）。 */
  rebuildAgents: () => Promise<void>;
  /** 注入 synthetic 消息（无 LLM turn）。 */
  reply: (sessionID: string, text: string) => Promise<void>;
}

export function createPresetCommand(handlers: PresetCommandHandlers): CommandDefinition {
  return {
    name: 'preset',
    description:
      '查看或切换 Oceanus preset。/preset 查询；/preset <name> 切换（写用户级配置 + 当前会话模型立即生效 + registry 立即重建；新 subagent 立即用新模型）。',
    async execute(invocation: CommandInvocation) {
      const argument = invocation.prompt.text.trim();
      try {
        if (!argument) {
          const { current, presets } = handlers.listPresets();
          const names = Object.keys(presets).sort();
          const lines = [
            `当前 preset：${current ?? '（未设置）'}`,
            `可用 preset：${names.length > 0 ? names.join(', ') : '（无）'}`,
          ];
          await handlers.reply(invocation.sessionID, lines.join('\n'));
          return;
        }
        const result = handlers.switchPreset(argument);
        if (!result.ok) {
          await handlers.reply(invocation.sessionID, `切换失败：${result.message}`);
          return;
        }
        const immediate = await handlers.switchSessionModel(invocation.sessionID, argument);
        await handlers.rebuildAgents();
        await handlers.reply(
          invocation.sessionID,
          [
            immediate ?? '',
            result.message,
            result.summary.length > 0 ? result.summary.join('\n') : '',
          ]
            .filter(Boolean)
            .join('\n'),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // 回执失败不应掩盖切换结果；尽力而为。
        await handlers
          .reply(invocation.sessionID, `Preset command failed（preset 命令执行失败）: ${message}`)
          .catch(() => undefined);
      }
    },
  };
}
