/**
 * 命令调用上下文：由 opencode 运行时在每次调用时传入 `execute`。
 * 仅透传运行时需要的字段，避免把整个 `ctx` 泄漏进 command 实现。
 */
export interface CommandInvocation {
  sessionID: string;
  prompt: { text: string };
  delivery: 'steer' | 'queue';
}

/**
 * 命令定义：与 opencode v2 `CommandDefinition` 的运行时形状保持一致，
 * 便于被 `ctx.command.transform` 的 `draft.add` 直接接受。
 */
export interface CommandDefinition {
  name: string;
  description?: string;
  execute: (invocation: CommandInvocation) => Promise<void>;
}
