import { describe, expect, test } from 'bun:test';
import { buildTaskReuseTool } from './reuse';

const read = (r: any) => JSON.parse(r.content);

describe('task_reuse 契约', () => {
  test('无唯一候选也返回七字段', async () => {
    const board: any = { listReusable: () => [], get: () => ({}) };
    const tool = buildTaskReuseTool(board, { resumeChild: async () => ({ ok: true, status: 'succeeded' }) });
    const value = read(await tool.execute({ agent: 'a', lane: 'l', brief: 'b', reuse_id: 'r' }, { sessionID: 'p' } as any));
    expect(Object.keys(value).sort()).toEqual(['certainty', 'code', 'ok', 'reconciliation', 'result', 'state', 'task_id'].sort());
    expect(value.ok).toBe(false);
    expect(value.state).toBe('starting');
  });

  test('同父 agent/lane 的候选把第二个 brief 传给同一 child session', async () => {
    const calls: any[] = [];
    const board: any = {
      listReusable: () => [{ task_id: 't-1', child_session_id: 'child-1', parent_session_id: 'p', agent: 'a', lane_key: 'l', reuse_id: 'r', last_board_revision: 1, task_version: 1, generation: 1 }],
      revive: async (id: string) => ({ task_id: id, generation: 2 }), get: () => ({ last_board_revision: 1, task_version: 1 }),
    };
    const tool = buildTaskReuseTool(board, { resumeChild: async (x: any) => { calls.push(x); return { ok: true, status: 'succeeded' }; } });
    const value = read(await tool.execute({ agent: 'a', lane_key: 'l', brief: 'second brief', reuse_id: 'r' }, { sessionID: 'p' } as any));
    expect(value.ok).toBe(true);
    expect(calls).toEqual([{ childSessionId: 'child-1', resumeId: 'reuse:r', brief: 'second brief', generation: 2 }]);
  });

  test('跨父、agent 或 lane 的候选不调用 adapter', async () => {
    const resume = async () => { throw new Error('must not resume'); };
    const board: any = { listReusable: () => [{ task_id: 't', child_session_id: 'c', parent_session_id: 'other', agent: 'a', lane_key: 'l', reuse_id: 'r' }] };
    const value = read(await buildTaskReuseTool(board, { resumeChild: resume }).execute({ agent: 'a', lane_key: 'l', brief: 'b', reuse_id: 'r' }, { sessionID: 'p' } as any));
    expect(value.code).toBe('NO_REUSABLE_TASK');
  });
});
