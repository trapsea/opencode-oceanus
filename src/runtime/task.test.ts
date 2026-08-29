import { describe, expect, test } from 'bun:test';
import { cancelChildSession, resolveTaskHostStatus } from './task';
import type { SessionLike } from './types';

const makeSession = (spec: { active?: string[]; outcomes?: Record<string, string>; interrupts?: string[] }) =>
  ({
    active: async () => ({ data: Object.fromEntries((spec.active ?? []).map((s) => [s, {}])) }),
    get: async ({ sessionID }: any) => ({ id: sessionID, outcome: spec.outcomes?.[sessionID] }),
    interrupt: async ({ sessionID }: any) => { spec.interrupts?.push(sessionID); return { interrupted: true }; },
  }) as unknown as SessionLike;

describe('resolveTaskHostStatus', () => {
  test('宿主 active → running（host verified）', async () => {
    const session = makeSession({ active: ['child-1'], outcomes: {} });
    const st = await resolveTaskHostStatus(session, { childSessionId: 'child-1', status: 'completed' });
    expect(st).toEqual({ status: 'running', source: 'host', verified: true });
  });
  test('outcome 终态映射 completed/failed；interrupted → uncertain（未决可恢复）', async () => {
    const session = makeSession({ outcomes: { a: 'succeeded', b: 'failed', c: 'interrupted' } });
    expect((await resolveTaskHostStatus(session, { childSessionId: 'a', status: 'running' })).status).toBe('completed');
    expect((await resolveTaskHostStatus(session, { childSessionId: 'b', status: 'running' })).status).toBe('failed');
    expect((await resolveTaskHostStatus(session, { childSessionId: 'c', status: 'running' })).status).toBe('uncertain');
  });
  test('宿主 interrupted + 本地显式 cancelled（用户 task_cancel）→ 保持 cancelled', async () => {
    const session = makeSession({ outcomes: { c: 'interrupted' } });
    const st = await resolveTaskHostStatus(session, { childSessionId: 'c', status: 'cancelled' });
    expect(st.status).toBe('cancelled');
    expect(st.verified).toBe(true);
  });

  test('宿主不可确认 → 回退本地状态，verified:false，不伪造终态', async () => {
    const session = makeSession({});
    const st = await resolveTaskHostStatus(session, { childSessionId: 'x', status: 'unknown' });
    expect(st).toEqual({ status: 'unknown', source: 'local', verified: false });
  });
  test('无 childSessionId → 直接回退本地', async () => {
    const st = await resolveTaskHostStatus(makeSession({}), { status: 'running' });
    expect(st.verified).toBe(false);
  });
});

describe('cancelChildSession', () => {
  test('interrupt + 验证 outcome/active', async () => {
    const spec: { interrupts: string[] } = { interrupts: [] };
    const session = makeSession({ interrupts: spec.interrupts, outcomes: { c1: 'interrupted' } });
    const v = await cancelChildSession(session, 'c1');
    expect(spec.interrupts).toEqual(['c1']);
    expect(v.interrupted).toBe(true);
    expect(v.outcome).toBe('interrupted');
  });
});
