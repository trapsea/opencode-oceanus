import { describe, expect, test } from 'bun:test';
import { reconcileTasks } from './task-reconcile';

const task = (state: string, extra: any = {}) => ({ task_id: state, state, generation: 1, task_version: 1, board_revision: 1, parent_session_id: 'p', ownership: { parent_session_id: 'p', owner_agent: 'a' }, last_activity_at: 100, ...extra });
const board = (...tasks: any[]) => ({ tasks: () => tasks.map((x) => structuredClone(x)) }) as any;

describe('task-reconcile 确定性恢复', () => {
  test('startup rehydrate 分类 active/stopped/uncertain/lost/reusable，并隔离 foreign owner', async () => {
    const host = { get: async ({ sessionID }: any) => sessionID === 'live' ? {} : sessionID === 'stop' ? { outcome: 'interrupted' } : undefined, active: async () => ({}) } as any;
    const result = await reconcileTasks({ board: board(task('live', { child_session_id: 'live' }), task('stop', { state: 'stopped', child_session_id: 'stop' }), task('old', { child_session_id: 'missing', last_activity_at: 0 }), task('reuse', { state: 'completed', reusable: true }), task('foreign', { ownership: { owner_agent: 'other' } })), session: host, ownerAgent: 'a', now: () => 1000, timeoutMs: 500 });
    // 无 child 或未确认 outcome 的终态不标 reusable
    expect(result.map((x) => [x.task_id, x.kind])).toEqual([['live', 'active'], ['stop', 'stopped'], ['old', 'lost'], ['reuse', 'unreconciled']]);
    expect(result.find((x) => x.task_id === 'old')?.certainty).toBe('uncertain');
  });

  test('无宿主能力时保守返回 uncertain，不伪造 active', async () => {
    const result = await reconcileTasks({ board: board(task('x', { child_session_id: 'x', last_activity_at: Date.now() })), session: { get: undefined } as any });
    expect(result[0]).toMatchObject({ kind: 'unreconciled', certainty: 'uncertain' });
  });

  test('重复恢复是无副作用的幂等读取', async () => {
    const b = board(task('x'));
    const a = await reconcileTasks({ board: b }); const c = await reconcileTasks({ board: b });
    expect(c).toEqual(a);
  });

  test('重启恢复即使 host succeeded 也不为未授权记录新授予 reusable', async () => {
    const value: any = task('done', { state: 'completed', child_session_id: 'child', reusable: false, reconciliation: 'unreconciled' });
    let stored = value;
    const b: any = { tasks: () => [structuredClone(stored)], get: () => structuredClone(stored), replace: async (x: any) => { stored = x; } };
    await reconcileTasks({ board: b, session: { get: async () => ({ id: 'child', parentID: 'p', outcome: 'succeeded' }) } as any, ownerAgent: 'a' });
    expect(stored).not.toMatchObject({ reusable: true, reconciliation: 'reconciled' });
  });

  test('重启恢复拒绝 child id/parent 不匹配及 failed/interrupted outcome', async () => {
    for (const host of [{ id: 'wrong', parentID: 'p', outcome: 'succeeded' }, { id: 'c', parentID: 'other', outcome: 'succeeded' }, { id: 'c', parentID: 'p', outcome: 'failed' }, { id: 'c', parentID: 'p', outcome: 'interrupted' }]) {
      let stored: any = task('x', { child_session_id: 'c', reusable: true, reconciliation: 'reconciled' });
      const b: any = { tasks: () => [structuredClone(stored)], get: () => structuredClone(stored), replace: async (x: any) => { stored = x; } };
      await reconcileTasks({ board: b, session: { get: async () => host } as any, ownerAgent: 'a' });
      expect(stored).not.toMatchObject({ reconciliation: 'reconciled', reusable: true });
    }
  });
});
