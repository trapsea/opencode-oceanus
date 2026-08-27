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
});
