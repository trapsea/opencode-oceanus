import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskCoordinator } from './task-coordinator';
import type { SessionLike } from './types';

let dir = '';
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ''; });

const launch = {
  taskID: 'ses_child_1', parentSessionID: 'ses_parent', agent: 'explorer',
  laneKey: 'search-api', objective: 'find api entry',
};

/** 可编程假宿主：active/outcome 按需返回。 */
function fakeSession(spec: { active?: Set<string>; outcomes?: Record<string, string> }): SessionLike {
  return {
    active: async () => ({ data: {} }),
    get: async ({ sessionID }: any) => {
      if (spec.outcomes?.[sessionID]) return { id: sessionID, parentID: 'ses_parent', outcome: spec.outcomes[sessionID] };
      return { id: sessionID, parentID: 'ses_parent' };
    },
  } as unknown as SessionLike;
}

describe('TaskCoordinator 契约', () => {
  test('reconcile：宿主 active → running；outcome=succeeded → completed（覆盖本地）', async () => {
    dir = await mkdtemp(join(tmpdir(), 'coord-'));
    const c = createTaskCoordinator({ workspaceRoot: dir, session: fakeSession({ outcomes: { ses_child_1: 'succeeded' } }) });
    await c.registerLaunch(launch);
    const [r] = await c.reconcile('ses_parent');
    expect(r.state).toBe('completed');
    expect(r.terminal).toBe(true);
  });

  test('reconcile：宿主不可确认 → uncertain，不伪造终态', async () => {
    dir = await mkdtemp(join(tmpdir(), 'coord-'));
    const c = createTaskCoordinator({ workspaceRoot: dir, session: fakeSession({}) });
    await c.registerLaunch(launch);
    const [r] = await c.reconcile('ses_parent');
    expect(r.state).toBe('uncertain');
    expect(r.terminal).toBeUndefined();
  });

  test('formatBoard：active/reusable 分区，reusable 仅限 completed 且结果已消费', async () => {
    dir = await mkdtemp(join(tmpdir(), 'coord-'));
    const c = createTaskCoordinator({ workspaceRoot: dir, session: fakeSession({ outcomes: { ses_child_1: 'succeeded' } }) });
    await c.registerLaunch(launch);
    const before = c.formatBoard('ses_parent');
    expect(before).toContain('Active');
    await c.reconcile('ses_parent');
    await c.markResultConsumed('ses_child_1', 'ses_parent');
    const after = c.formatBoard('ses_parent');
    expect(after).toContain('Reusable');
    expect(after).toContain('search-api');
  });

  test('resolveReusable：completed+已消费 可续用；uncertain 不可续用', async () => {
    dir = await mkdtemp(join(tmpdir(), 'coord-'));
    const c = createTaskCoordinator({ workspaceRoot: dir, session: fakeSession({ outcomes: { ses_child_1: 'succeeded' } }) });
    await c.registerLaunch(launch);
    expect(c.resolveReusable('ses_parent', 'search-api', 'explorer')).toBeUndefined();
    await c.reconcile('ses_parent');
    expect(c.resolveReusable('ses_parent', 'search-api', 'explorer')).toBeUndefined(); // 未消费不可续用
    await c.markResultConsumed('ses_child_1', 'ses_parent');
    const r = c.resolveReusable('ses_parent', 'search-api', 'explorer');
    expect(r?.taskID).toBe('ses_child_1');
  });

  test('revive：续用 generation+1 并重新 running；lane 冲突在 active 期被阻止', async () => {
    dir = await mkdtemp(join(tmpdir(), 'coord-'));
    const c = createTaskCoordinator({ workspaceRoot: dir, session: fakeSession({ outcomes: { ses_child_1: 'succeeded' } }) });
    await c.registerLaunch(launch);
    await c.reconcile('ses_parent');
    await c.markResultConsumed('ses_child_1', 'ses_parent');
    const revived = await c.registerRevive({ taskID: 'ses_child_1', parentSessionID: 'ses_parent', brief: 'next job' });
    expect(revived.generation).toBe(2);
    expect(revived.state).toBe('running');
    // active 期间同 lane 再 revive → LANE_CONFLICT
    expect(c.registerRevive({ taskID: 'ses_child_1', parentSessionID: 'ses_parent', brief: 'dup' })).rejects.toThrow('LANE_CONFLICT');
  });

  test('duplicate objective（dispatch-guard 输入）：同 objective 终态未消费 → 重复；已消费 → 放行', async () => {
    dir = await mkdtemp(join(tmpdir(), 'coord-'));
    const c = createTaskCoordinator({ workspaceRoot: dir, session: fakeSession({ outcomes: { ses_child_1: 'succeeded' } }) });
    await c.registerLaunch(launch);
    await c.reconcile('ses_parent');
    expect(c.findDuplicateObjective('ses_parent', 'find api entry')).toBe(true);
    await c.markResultConsumed('ses_child_1', 'ses_parent');
    expect(c.findDuplicateObjective('ses_parent', 'find api entry')).toBe(false);
  });

  test('ensureRegistered：已有记录 → 幂等返回（不触发宿主校验）', async () => {
    dir = await mkdtemp(join(tmpdir(), 'coord-'));
    let getCalls = 0;
    const session = {
      get: async () => { getCalls += 1; return { id: 'x', parentID: 'ses_parent' }; },
    } as unknown as SessionLike;
    const c = createTaskCoordinator({ workspaceRoot: dir, session });
    await c.registerLaunch(launch);
    const rec = await c.ensureRegistered('ses_child_1', 'ses_parent');
    expect(rec?.taskID).toBe('ses_child_1');
    expect(getCalls).toBe(0);
  });

  test('ensureRegistered：登记缺失 + 宿主 parentID 匹配 + outcome → 补偿登记并收敛终态', async () => {
    dir = await mkdtemp(join(tmpdir(), 'coord-'));
    const c = createTaskCoordinator({ workspaceRoot: dir, session: fakeSession({ outcomes: { ses_child_9: 'succeeded' } }) });
    expect(c.listTasks('ses_parent').find((t) => t.taskID === 'ses_child_9')).toBeUndefined();
    const rec = await c.ensureRegistered('ses_child_9', 'ses_parent');
    expect(rec?.state).toBe('completed');
    expect(rec?.terminal).toBe(true);
    // 登记后对本会话可见（task_status/task_message 兜底查询依赖此行为）
    expect(c.listTasks('ses_parent').find((t) => t.taskID === 'ses_child_9')?.state).toBe('completed');
  });

  test('ensureRegistered：宿主 outcome 不可确认 → 登记 running，不伪造终态', async () => {
    dir = await mkdtemp(join(tmpdir(), 'coord-'));
    const c = createTaskCoordinator({ workspaceRoot: dir, session: fakeSession({}) });
    const rec = await c.ensureRegistered('ses_child_2', 'ses_parent');
    expect(rec?.state).toBe('running');
    expect(rec?.terminal).toBeUndefined();
  });

  test('ensureRegistered：跨父访问（parentID 不匹配）与 parentID 缺失 → 拒绝登记', async () => {
    dir = await mkdtemp(join(tmpdir(), 'coord-'));
    const stranger = {
      get: async ({ sessionID }: any) => ({ id: sessionID, parentID: 'ses_other' }),
    } as unknown as SessionLike;
    const noParent = {
      get: async ({ sessionID }: any) => ({ id: sessionID }),
    } as unknown as SessionLike;
    const c1 = createTaskCoordinator({ workspaceRoot: dir, session: stranger });
    expect(await c1.ensureRegistered('ses_child_1', 'ses_parent')).toBeUndefined();
    const c2 = createTaskCoordinator({ workspaceRoot: dir, session: noParent });
    expect(await c2.ensureRegistered('ses_child_1', 'ses_parent')).toBeUndefined();
    expect(c1.listTasks('ses_parent')).toHaveLength(0);
    expect(c2.listTasks('ses_parent')).toHaveLength(0);
  });

  test('ensureRegistered：宿主 get 失败/无 session → undefined', async () => {
    dir = await mkdtemp(join(tmpdir(), 'coord-'));
    const broken = {
      get: async () => { throw new Error('boom'); },
    } as unknown as SessionLike;
    const c1 = createTaskCoordinator({ workspaceRoot: dir, session: broken });
    expect(await c1.ensureRegistered('ses_child_1', 'ses_parent')).toBeUndefined();
    const c2 = createTaskCoordinator({ workspaceRoot: dir });
    expect(await c2.ensureRegistered('ses_child_1', 'ses_parent')).toBeUndefined();
  });
});
