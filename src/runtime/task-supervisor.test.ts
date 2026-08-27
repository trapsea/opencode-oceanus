import { describe, expect, test } from 'bun:test';
import { createTaskSupervisor } from './task-supervisor';

const t = (state = 'running', extra: any = {}) => ({ task_id: 't', state, generation: 3, task_version: 8, board_revision: 12, parent_session_id: 'p', child_session_id: 'c', ownership: { parent_session_id: 'p', owner_agent: 'a' }, ...extra });
const makeBoard = (value: any) => ({ tasks: () => [value], get: () => structuredClone(value) }) as any;
const statefulBoard = (value: any) => { const store = { task: structuredClone(value) }; return { store, tasks: () => [store.task], get: () => structuredClone(store.task) } as any; };

describe('task-supervisor 控制竞态与能力边界', () => {
  test('cancel-before-host：先持久化 generation，再触碰 host', async () => {
    const order: string[] = []; const board = makeBoard(t());
    const s = createTaskSupervisor({ board, ownerAgent: 'a', persistGeneration: async () => { order.push('persist'); }, session: { get: async () => undefined, interrupt: async () => { order.push('host'); } } as any });
    expect(await s.cancel('t')).toBe('delivered'); expect(order).toEqual(['persist', 'host']);
  });

  test('v2 interrupt 只传合法参数，并在 interrupt 后重读 host status', async () => {
    const calls: any[] = [];
    const transitions: any[] = [];
    const value = t();
    const board = {
      ...makeBoard(value),
      transition: async (_id: string, state: string, options: any) => { transitions.push({ state, options }); (value as any).state = state; },
    } as any;
    const session = {
      get: async () => ({ outcome: 'interrupted' }),
      interrupt: async (input: any) => { calls.push(input); },
    };
    const supervisor = createTaskSupervisor({ board, session: session as any });

    expect(await supervisor.cancel('t')).toBe('delivered');
    expect(calls).toEqual([{ sessionID: 'c', continue: false }]);
    expect(transitions[0].state).toBe('cancel_requested');
    expect(transitions[1].state).toBe('cancelled');
  });

  test('cancel-unknown、host capability 缺失与 foreign owner 均 fail closed', async () => {
    const missing = createTaskSupervisor({ board: makeBoard(t()), session: { get: async () => undefined } as any });
    expect(await missing.cancel('t')).toBe('unsupported');
    const foreign = createTaskSupervisor({ board: makeBoard(t('running', { ownership: { owner_agent: 'other' } })), ownerAgent: 'a', session: { get: async () => undefined, interrupt: async () => {} } as any });
    expect(await foreign.cancel('t')).toBe('uncertain');
  });

  test('cancel-vs-complete/cancel-late-complete/cancel-reconcile：不把不确定结果伪装 cancelled', async () => {
    for (const [interrupt, expected] of [[async () => ({ interrupted: false }), 'uncertain'], [async () => { throw new Error('timeout'); }, 'timeout']] as const) {
      const s = createTaskSupervisor({ board: makeBoard(t()), session: { get: async () => ({ outcome: 'succeeded' }), interrupt } as any });
      expect(await s.cancel('t')).toBe(expected);
    }
  });

  test('cancel+succeeded 竞态最终 completed，不改 cancelled', async () => {
    const transitions: string[] = [];
    const board = statefulBoard(t('running'));
    board.transition = async (_id: string, state: string) => { transitions.push(state); board.store.task.state = state; };
    const s = createTaskSupervisor({ board, session: { get: async () => ({ outcome: 'succeeded' }), interrupt: async () => {} } as any });
    expect(await s.cancel('t')).toBe('delivered');
    expect(transitions).toEqual(['cancel_requested', 'completed']);
  });

  test('cancel+failed 竞态最终 failed', async () => {
    const transitions: string[] = [];
    const board = statefulBoard(t('running'));
    board.transition = async (_id: string, state: string) => { transitions.push(state); board.store.task.state = state; };
    const s = createTaskSupervisor({ board, session: { get: async () => ({ outcome: 'failed' }), interrupt: async () => {} } as any });
    expect(await s.cancel('t')).toBe('delivered');
    expect(transitions).toEqual(['cancel_requested', 'failed']);
  });

  test('host interrupted 才 cancelled', async () => {
    const transitions: string[] = [];
    const board = statefulBoard(t('running'));
    board.transition = async (_id: string, state: string) => { transitions.push(state); board.store.task.state = state; };
    const s = createTaskSupervisor({ board, session: { get: async () => ({ outcome: 'interrupted' }), interrupt: async () => {} } as any });
    expect(await s.cancel('t')).toBe('delivered');
    expect(transitions).toEqual(['cancel_requested', 'cancelled']);
  });

  test('宿主不可确认时不伪造终态：get 失败/无 outcome → uncertain', async () => {
    for (const info of [undefined, { outcome: undefined }, { outcome: 'active' }] as const) {
      const board = statefulBoard(t('running'));
      board.transition = async (_id: string, state: string) => { board.store.task.state = state; };
      const s = createTaskSupervisor({ board, session: { get: async () => info, interrupt: async () => {} } as any });
      expect(await s.cancel('t')).toBe('uncertain');
      expect(board.store.task.state).toBe('cancel_requested');
    }
  });

  test('终态任务 cancel 不触碰宿主也不降级；cancel_requested CAS 失败 → uncertain', async () => {
    for (const state of ['completed', 'failed', 'cancelled']) {
      let touched = false;
      const board = statefulBoard(t(state));
      const s = createTaskSupervisor({ board, session: { get: async () => { touched = true; return { outcome: state }; }, interrupt: async () => { touched = true; } } as any });
      expect(await s.cancel('t')).toBe('delivered');
      expect(touched).toBe(false);
      expect(board.store.task.state).toBe(state);
    }
    const board = statefulBoard(t('running'));
    board.transition = async () => { throw new Error('CAS'); };
    const s = createTaskSupervisor({ board, session: { get: async () => ({ outcome: 'interrupted' }), interrupt: async () => {} } as any });
    expect(await s.cancel('t')).toBe('uncertain');
  });

  test('revive-vs-cancel、revive-persist-failure、message-vs-terminal、stale generation由 board CAS/操作幂等保证', async () => {
    const operations = new Set<string>();
    const board = { ...makeBoard(t('blocked', { reusable: false })), revive: async (_id: string, o: any) => { if (operations.has(o.operationId)) return; operations.add(o.operationId); return { state: 'starting', generation: 4 }; } } as any;
    expect(await board.revive('t', { operationId: 'revive-1' })).toMatchObject({ state: 'starting' });
    expect(await board.revive('t', { operationId: 'revive-1' })).toBeUndefined();
    expect(operations.has('revive-1')).toBe(true);
  });
});
