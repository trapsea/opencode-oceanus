import type { ToolDefinition, ToolContextLike } from '../../runtime/types';
import type { JobBoard } from './job-board';

const out = (x: unknown) => ({ content: JSON.stringify(x) });

export interface TaskReviveAdapter {
  resumeChild?: (x: any) => Promise<{ ok: boolean; reason?: string; status?: string }>;
  /** host active 确认：仅当宿主明确返回 true 时才把 starting 提升为 running。 */
  confirmActive?: (childSessionId: string) => Promise<boolean>;
}

export function buildTaskReviveTool(board?: JobBoard, adapter?: TaskReviveAdapter): ToolDefinition {
  return {
    name: 'task_revive',
    description: '恢复 blocked/uncertain 或可复用终态任务',
    input: { type: 'object' },
    async execute(input: any, ctx: ToolContextLike) {
      if (!board || !adapter?.resumeChild) return out({ error: 'unsupported' });
      try {
        const t: any = board.get(String(input?.taskId ?? ''));
        if (t.parent_session_id !== ctx.sessionID) return out({ error: 'PARENT_OWNERSHIP' });
        if (!input?.resume_id || !input?.brief || !Number.isInteger(input.expected_board_revision) || !Number.isInteger(input.expected_task_version) || !Number.isInteger(input.expected_generation) || !input.operation_id) return out({ error: 'INVALID_INPUT' });
        // uncertain 允许重新打开；running/stopped 不可 revive。
        if (t.state === 'running' || t.state === 'stopped') return out({ error: 'NOT_REVIVEABLE' });
        const already = t.operations?.[input.operation_id];
        const revived: any = await board.revive(t.task_id, {
          expectedRevision: input.expected_board_revision,
          expectedTaskVersion: input.expected_task_version,
          expectedGeneration: input.expected_generation,
          operationId: input.operation_id,
          resumeId: input.resume_id,
          brief: input.brief,
        });
        if (already) return out({ status: revived.state === 'uncertain' ? 'uncertain' : 'revived', task: revived });
        // adapter 返回 { ok } 而非抛错：续用失败时进入 uncertain，不伪造 revived。
        const result = await adapter.resumeChild({ childSessionId: t.child_session_id, resumeId: input.resume_id, brief: input.brief, generation: revived.generation });
        if (result?.ok === false) {
          if (typeof (board as any).transition === 'function') {
            try {
              await (board as any).transition(t.task_id, 'uncertain', { sessionId: ctx.sessionID, expectedRevision: revived.last_board_revision, expectedTaskVersion: revived.task_version, expectedGeneration: revived.generation, operationId: `${input.operation_id}:uncertain` });
            } catch { /* 收敛失败时下方 board.get 仍如实上报 */ }
          }
          return out({ status: 'uncertain', reason: result.reason, task: board.get(t.task_id) });
        }
        // 续用已投递：仅当 host 确认 active=true 才把 starting 提升为 running；
        // 无法确认时保持 starting（observer/宿主事件链路后续收敛），不伪造 running。
        let confirmed = false;
        if (adapter.confirmActive) {
          try { confirmed = (await adapter.confirmActive(t.child_session_id)) === true; } catch { confirmed = false; }
        }
        if (confirmed && typeof (board as any).transition === 'function') {
          try {
            await (board as any).transition(t.task_id, 'running', { sessionId: ctx.sessionID, expectedRevision: revived.last_board_revision, expectedTaskVersion: revived.task_version, expectedGeneration: revived.generation, operationId: `${input.operation_id}:running` });
          } catch { /* 保持 starting，交给后续观察收敛 */ }
        }
        return out({ status: 'revived', delivery: result?.status ?? 'queued', confirmed, task: board.get(t.task_id) });
      } catch (e: any) {
        return out({ error: String(e?.message ?? e) });
      }
    },
  };
}
