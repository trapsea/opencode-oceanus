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
});
