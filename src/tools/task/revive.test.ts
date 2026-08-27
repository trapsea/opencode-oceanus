import { describe, expect, test } from 'bun:test';
import { buildTaskReviveTool } from './revive';

const parse = (x: { content?: unknown }) => JSON.parse(x.content as string) as any;
const ctx = { sessionID: 'parent' } as any;
const board = (task: any) => ({ get: () => ({ parent_session_id: 'parent', child_session_id: 'child', task_id: 't', task_version: 2, generation: 3, board_revision: 4, last_board_revision: 4, ...task }), revive: async (_id: string, o: any) => ({ ...task, state: 'starting', generation: o.expectedGeneration + 1 }) }) as any;
const input = (extra: any = {}) => ({ taskId: 't', resume_id: 'r', brief: 'brief', expected_board_revision: 4, expected_task_version: 2, expected_generation: 3, operation_id: 'op', ...extra });
const adapter = { resumeChild: async (_: any) => undefined };

describe('task_revive 服务契约（T6）', () => {
  test('blocked continuation、reusable 终态及不可恢复边界', async () => {
    expect(parse(await buildTaskReviveTool(board({ state: 'blocked' }), adapter).execute(input(), ctx)).status).toBe('revived');
    for (const state of ['running', 'stopped']) expect(parse(await buildTaskReviveTool(board({ state })).execute({ taskId: 't' }, ctx)).error).toBeTruthy();
    for (const state of ['completed', 'failed', 'cancelled']) expect(parse(await buildTaskReviveTool(board({ state, reusable: true }), adapter).execute(input(), ctx)).status).toBe('revived');
  });
  test('generation/CAS、unsupported/degraded、越权与缺失 resume_id', async () => {
    const calls: any[] = []; const b = board({ state: 'blocked' }); b.revive = async (_: string, o: any) => { calls.push(o); return {}; };
    await buildTaskReviveTool(b, adapter).execute(input(), ctx);
    expect(calls[0]).toMatchObject({ expectedRevision: 4, expectedTaskVersion: 2, expectedGeneration: 3, resumeId: 'r' });
    expect(parse(await buildTaskReviveTool(board({ state: 'blocked' }), adapter).execute({ taskId: 't' }, ctx)).error).toBeTruthy();
    expect(parse(await buildTaskReviveTool(undefined).execute({ taskId: 't' }, ctx)).error).toBe('unsupported');
    expect(parse(await buildTaskReviveTool(board({ state: 'blocked', parent_session_id: 'stranger' })).execute({ taskId: 't', resume_id: 'r' }, ctx)).error).toBeTruthy();
  });
  test('adapter ok:false → uncertain，ok:true → revived 带 delivery', async () => {
    const failAdapter = { resumeChild: async () => ({ ok: false as const, reason: 'unsupported' }) };
    expect(parse(await buildTaskReviveTool(board({ state: 'blocked' }), failAdapter).execute(input(), ctx)).status).toBe('uncertain');
    const okAdapter = { resumeChild: async () => ({ ok: true as const, status: 'succeeded' as const }) };
    const ok = parse(await buildTaskReviveTool(board({ state: 'blocked' }), okAdapter).execute(input(), ctx));
    expect(ok.status).toBe('revived');
    expect(ok.delivery).toBe('succeeded');
    // 旧语义：resumeChild 返回 undefined（未抛错）仍视为成功，保持向后兼容。
    const legacyAdapter = { resumeChild: async () => undefined };
    expect(parse(await buildTaskReviveTool(board({ state: 'blocked' }), legacyAdapter).execute(input(), ctx)).status).toBe('revived');
  });

  test('revive 后仅 host active=true 确认才 starting→running，generation+1', async () => {
    const transitions: any[] = [];
    const b = statefulReviveBoard('blocked');
    b.transition = async (_id: string, state: string, o: any) => { transitions.push({ state, o }); b.store.task = { ...b.store.task, state, task_version: b.store.task.task_version + 1 }; };
    // host 确认 active=true → running
    const active = buildTaskReviveTool(b, { resumeChild: async () => ({ ok: true, status: 'delivered' }), confirmActive: async () => true });
    const r1 = parse(await active.execute(input(), ctx));
    expect(r1.task.generation).toBe(4);
    expect(r1.task.state).toBe('running');
    expect(transitions.at(-1)).toMatchObject({ state: 'running' });
    expect(transitions.at(-1).o.expectedGeneration).toBe(4);
    // host 不可确认（缺 confirmActive / 返回 false）→ 保持 starting，不伪造 running
    const b2 = statefulReviveBoard('blocked');
    b2.transition = async (_id: string, state: string) => { b2.store.task = { ...b2.store.task, state }; };
    const unconfirmed = parse(await buildTaskReviveTool(b2, { resumeChild: async () => ({ ok: true, status: 'delivered' }) }).execute(input(), ctx));
    expect(unconfirmed.status).toBe('revived');
    expect(unconfirmed.confirmed).toBe(false);
    expect(unconfirmed.task.state).toBe('starting');
    expect(unconfirmed.task.generation).toBe(4);
    const b3 = statefulReviveBoard('blocked');
    b3.transition = async (_id: string, state: string) => { b3.store.task = { ...b3.store.task, state }; };
    const denied = parse(await buildTaskReviveTool(b3, { resumeChild: async () => ({ ok: true, status: 'delivered' }), confirmActive: async () => false }).execute(input(), ctx));
    expect(denied.task.state).toBe('starting');
    expect(denied.confirmed).toBe(false);
  });

  test('uncertain 任务可 revive 重开（adapter 失败回落 uncertain，可再次重试）', async () => {
    let calls = 0;
    const adapter = { resumeChild: async () => { calls++; return calls === 1 ? { ok: false, reason: 'timeout' } : { ok: true, status: 'delivered' }; }, confirmActive: async () => false };
    const b = statefulReviveBoard('uncertain');
    b.transition = async (_id: string, state: string) => { b.store.task = { ...b.store.task, state }; };
    const first = parse(await buildTaskReviveTool(b, adapter).execute(input(), ctx));
    expect(first.status).toBe('uncertain');
    expect(b.store.task.state).toBe('uncertain');
    // 再次重开：input revision/version 按当前任务
    const retry = parse(await buildTaskReviveTool(b, adapter).execute(input({ expected_board_revision: b.store.task.last_board_revision, expected_task_version: b.store.task.task_version, expected_generation: b.store.task.generation, operation_id: 'op2' }), ctx));
    expect(retry.status).toBe('revived');
    expect(retry.task.generation).toBe(5);
  });
});

const statefulReviveBoard = (state: string) => {
  const store: any = { task: { parent_session_id: 'parent', child_session_id: 'child', task_id: 't', task_version: 2, generation: 3, last_board_revision: 4, state, operations: {} } };
  const b: any = {
    store,
    get: () => structuredClone(store.task),
    revive: async (_id: string, o: any) => {
      const seen = store.task.operations?.[o.operationId];
      if (seen) return structuredClone(store.task);
      store.task = { ...store.task, state: 'starting', generation: o.expectedGeneration + 1, task_version: store.task.task_version + 1, last_board_revision: store.task.last_board_revision + 1, operations: { ...(store.task.operations || {}), [o.operationId]: true } };
      return structuredClone(store.task);
    },
  };
  return b;
};
