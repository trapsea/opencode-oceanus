/**
 * task_message：向运行中的原生 subagent session 排队追加消息。
 *
 * 语义：`session.prompt(delivery:'queue')` 仅保证入队，不保证子 agent
 * 已读取/已执行；返回 queued 是诚实表述。
 */
import type { ToolDefinition, ToolContextLike } from '../../runtime/types';
import type { TaskCoordinator } from '../../runtime/task-coordinator';

export interface TaskMessageSession {
  prompt(input: { sessionID: string; text: string; delivery: 'steer' | 'queue' }): Promise<unknown>;
}

export function buildTaskMessageTool(coordinator: TaskCoordinator, session?: TaskMessageSession): ToolDefinition {
  return {
    name: 'task_message',
    description: '向运行中的子任务（原生 subagent session）排队追加消息。只保证入队（queued），不保证子 agent 已读取或执行。task_id 即 child session ID。',
    input: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 id（= child session ID）' },
        message: { type: 'string', description: '要追加的消息文本' },
      },
      required: ['taskId', 'message'],
      additionalProperties: false,
    },
    async execute(input: any, ctx: ToolContextLike) {
      const taskId = String(input?.taskId ?? '');
      const message = String(input?.message ?? '');
      if (!taskId || !message) {
        return { content: JSON.stringify({ error: 'INVALID_INPUT', detail: 'taskId 与 message 必填' }) };
      }
      if (message.length > 8192) {
        return { content: JSON.stringify({ error: 'MESSAGE_SIZE' }) };
      }
      try {
        const rec = coordinator.listTasks(ctx.sessionID).find((t) => t.taskID === taskId)
          // 登记缺失（bridge 未登记）时以宿主事实兜底登记后再查；parentID 校验保持在 coordinator 内。
          // 防御性调用：stub coordinator 可能不含 ensureRegistered。
          ?? (typeof coordinator.ensureRegistered === 'function'
            ? await coordinator.ensureRegistered(taskId, ctx.sessionID).catch(() => undefined)
            : undefined);
        if (!rec) return { content: JSON.stringify({ error: 'TASK_NOT_FOUND', taskId }) };
        if (!session || typeof session.prompt !== 'function') {
          return { content: JSON.stringify({ error: 'UNSUPPORTED', detail: '宿主缺少 session.prompt 能力' }) };
        }
        await session.prompt({ sessionID: taskId, text: message, delivery: 'queue' });
        return { content: JSON.stringify({ ok: true, taskId, state: 'queued' }) };
      } catch (e: any) {
        return { content: JSON.stringify({ error: 'UNCERTAIN', detail: String(e?.message ?? e) }) };
      }
    },
  };
}
