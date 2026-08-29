/**
 * task_revive：对可续用的原生 subagent session 追加新任务并等待终态。
 * 可续用 = 非 running：uncertain（宿主中断）/ cancelled / failed / completed（结果已消费）。
 *
 * 执行事实源是 V2 session.prompt/wait/get；coordinator 只做元数据护栏
 * （generation+1、lane 冲突；仅 completed 未消费拒绝）。
 */
import type { ToolDefinition, ToolContextLike } from '../../runtime/types';
import type { TaskCoordinator } from '../../runtime/task-coordinator';
import type { SessionLike } from '../../runtime/types';

export function buildTaskReviveTool(coordinator: TaskCoordinator, session?: SessionLike): ToolDefinition {
  return {
    name: 'task_revive',
    description: '续用既有子任务 session（uncertain/interrupted/cancelled/failed/completed+已消费）执行新任务：generation+1，prompt+wait+get 验证终态。中断/失败后可借此恢复原 session 续跑，无需重派新任务。',
    input: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: '任务 id（= child session ID）' },
        prompt: { type: 'string', description: '新任务 brief（完整自包含）' },
      },
      required: ['task_id', 'prompt'],
      additionalProperties: false,
    },
    async execute(input: any, ctx: ToolContextLike) {
      const taskId = String(input?.task_id ?? '');
      const prompt = String(input?.prompt ?? '');
      if (!taskId || !prompt) {
        return { content: JSON.stringify({ error: 'INVALID_INPUT', detail: 'task_id 与 prompt 必填' }) };
      }
      if (typeof session?.prompt !== 'function' || typeof session.wait !== 'function') {
        return { content: JSON.stringify({ error: 'UNSUPPORTED', detail: '宿主缺少 session.prompt/wait 能力' }) };
      }
      try {
        // 先以宿主事实收敛本地状态（只读任务可能停留在 running）。
        await coordinator.reconcile(ctx.sessionID).catch(() => undefined);
        // 登记缺失（bridge 未登记）时以宿主事实兜底登记，保持可复用性。
        if (typeof coordinator.ensureRegistered === 'function') {
          await coordinator.ensureRegistered(taskId, ctx.sessionID).catch(() => undefined);
        }
        const revived = await coordinator.registerRevive({ taskID: taskId, parentSessionID: ctx.sessionID, brief: prompt });
        await session.prompt({ sessionID: taskId, text: prompt, delivery: 'queue' });
        await session.wait({ sessionID: taskId });
        const info = typeof session.get === 'function' ? await session.get({ sessionID: taskId }) : undefined;
        const outcome = (info as { outcome?: string } | undefined)?.outcome;
        if (outcome === 'succeeded') {
          await coordinator.markTerminal(taskId, ctx.sessionID, 'completed');
        } else if (outcome === 'failed') {
          await coordinator.markTerminal(taskId, ctx.sessionID, 'failed');
        } else if (outcome === 'interrupted') {
          // 宿主中断 = 未决可恢复：标记 uncertain（非 cancelled），后续可再次 revive。
          await coordinator.markUncertain(taskId, ctx.sessionID);
        } else {
          // 宿主无法确认：不伪造终态，保持 running 供后续 reconcile 收敛。
        }
        const fresh = coordinator.listTasks(ctx.sessionID).find((t) => t.taskID === taskId);
        return {
          content: JSON.stringify({
            ok: true,
            task_id: taskId,
            generation: revived.generation,
            state: fresh?.state ?? 'running',
            outcome: outcome ?? 'unknown',
          }),
        };
      } catch (e: any) {
        return { content: JSON.stringify({ error: String(e?.message ?? e).split(':')[0], detail: String(e?.message ?? e) }) };
      }
    },
  };
}
