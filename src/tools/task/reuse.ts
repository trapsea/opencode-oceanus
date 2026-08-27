import type { ToolDefinition, ToolContextLike } from '../../runtime/types';
import type { JobBoard } from './job-board';
import type { TaskReviveAdapter } from './revive';

const out = (x: unknown) => ({ content: JSON.stringify(x) });
const response = (x: Partial<any> = {}) => ({ ok: x.ok ?? false, task_id: x.task_id ?? null, state: x.state ?? 'starting', certainty: x.certainty ?? 'uncertain', reconciliation: x.reconciliation ?? 'unreconciled', code: x.code ?? null, result: x.result ?? null });

/** 自动选择同 lane 的可复用 completed child，并在原 session 上续用。 */
export function buildTaskReuseTool(board?: JobBoard, adapter?: TaskReviveAdapter, enabled = true): ToolDefinition {
  return {
    name: 'task_reuse', description: '复用满足条件的既有 child session 执行新 brief（不创建新 session）',
    input: { type: 'object', properties: {
        brief: { type: 'string', maxLength: 32768 }, agent: { type: 'string' }, lane_key: { type: 'string' }, lane: { type: 'string' }, reuse_id: { type: 'string' }, operation_id: { type: 'string' },
      }, required: ['brief', 'agent', 'lane_key', 'reuse_id'] },
    async execute(input: any, ctx: ToolContextLike) {
       if (!enabled || !board || !adapter?.resumeChild) return out(response({ code: 'UNSUPPORTED' }));
        const laneKey = input?.lane_key || input?.lane;
        if (![input?.brief, input?.agent, laneKey, input?.reuse_id].every((v: any) => typeof v === 'string' && v.trim()) || input.brief.length > 32768) return out(response({ code: 'INVALID_INPUT' }));
      try {
          const candidates = board.listReusable({ agent: input.agent, lane_key: laneKey });
          const owned = candidates.filter((x: any) => x.parent_session_id === ctx.sessionID || x.ownership?.parent_session_id === ctx.sessionID);
          const matches = owned.filter((x: any) => x.reuse_id === input.reuse_id || x.task_id === input.reuse_id);
        const t: any = matches.length === 1 ? matches[0] : undefined;
        if (!t) return out(response({ code: matches.length ? 'AMBIGUOUS_REUSE' : 'NO_REUSABLE_TASK' }));
         const op = input.operation_id || `reuse:${input.reuse_id}`;
        const payload = JSON.stringify({ reuse_id: input.reuse_id, agent: input.agent, lane: input.lane, brief: input.brief });
        if (t.operations?.[op]) { if (t.operations[op] !== payload) return out(response({ code: 'IDEMPOTENCY_KEY_REUSE', task_id: t.task_id, state: t.state, certainty: t.certainty, reconciliation: t.reconciliation })); return out(response({ ok: true, task_id: t.task_id, state: t.state, certainty: t.certainty, reconciliation: t.reconciliation, code: 'REPLAY', result: t.result })); }
        const revived: any = await board.revive(t.task_id, {
          expectedRevision: t.last_board_revision, expectedTaskVersion: t.task_version,
          expectedGeneration: t.generation, operationId: op, resumeId: op, brief: input.brief,
        });
          const result = await adapter.resumeChild({ childSessionId: t.child_session_id, resumeId: op, brief: input.brief, generation: revived.generation });
         const fresh: any = board.get(t.task_id);
         if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') return out(response({ code: 'MALFORMED', task_id: t.task_id }));
         if (!result.ok) return out(response({ code: result.reason, task_id: t.task_id, state: 'starting', result }));
           const state = result.status === 'interrupted' ? 'cancelled' : result.status === 'succeeded' ? 'completed' : result.status;
           if (typeof (board as any).transition === 'function' && typeof result.status === 'string' && ['succeeded', 'failed', 'interrupted'].includes(result.status)) {
            try { await (board as any).transition(t.task_id, state, { sessionId: ctx.sessionID, expectedRevision: fresh.last_board_revision, expectedTaskVersion: fresh.task_version, expectedGeneration: revived.generation, operationId: `${op}:terminal` }); } catch { /* 由 board 保持真实状态 */ }
          }
          return out(response({ ok: true, task_id: t.task_id, state, certainty: state === 'completed' || state === 'failed' || state === 'cancelled' ? 'authoritative' : 'uncertain', reconciliation: fresh.reconciliation, code: 'OK', result }));
       } catch (e: any) {
         const error = String(e?.message ?? e);
         return out(response({ code: error.includes('CAS') ? 'CAS_CONFLICT' : error.includes('DEGRADED') ? 'DEGRADED' : 'UNCERTAIN', result: { error } }));
      }
    },
  };
}
