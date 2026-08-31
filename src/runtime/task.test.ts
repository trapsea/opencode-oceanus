import { describe, expect, test } from 'bun:test';
import { cancelChildSession, readSessionLastAssistantText, resolveTaskHostStatus } from './task';
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

describe('readSessionLastAssistantText（revive/result 内容通道）', () => {
  const sessionWithMessages = (messages: unknown) =>
    ({ context: async () => messages, get: async () => ({}) }) as unknown as SessionLike;

  test('倒序取最后一条 assistant：parts 形态拼接', async () => {
    const session = sessionWithMessages([
      { role: 'user', parts: [{ type: 'text', text: '问题' }] },
      { role: 'assistant', parts: [{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }] },
    ]);
    expect(await readSessionLastAssistantText(session, 's1')).toBe('第一段\n第二段');
  });

  test('role 位于 info.role 的宿主形态同样可提取', async () => {
    const session = sessionWithMessages([
      { info: { role: 'assistant' }, content: [{ text: 'OK' }] },
    ]);
    expect(await readSessionLastAssistantText(session, 's1')).toBe('OK');
  });

  test('顶层 text 直取；跳过非 assistant 消息', async () => {
    const session = sessionWithMessages([
      { role: 'assistant', text: '早前回答' },
      { role: 'user', text: '追问' },
      { role: 'assistant', text: '最终回答' },
    ]);
    expect(await readSessionLastAssistantText(session, 's1')).toBe('最终回答');
  });

  test('无 assistant 消息 → undefined', async () => {
    const session = sessionWithMessages([{ role: 'user', text: '只有用户' }]);
    expect(await readSessionLastAssistantText(session, 's1')).toBeUndefined();
  });

  test('宿主未暴露 session.context → fail-open undefined', async () => {
    const session = { get: async () => ({}) } as unknown as SessionLike;
    expect(await readSessionLastAssistantText(session, 's1')).toBeUndefined();
  });

  test('context 抛错 → fail-open undefined', async () => {
    const session = { context: async () => { throw new Error('boom'); } } as unknown as SessionLike;
    expect(await readSessionLastAssistantText(session, 's1')).toBeUndefined();
  });

  test('超长文本截断到 maxChars', async () => {
    const session = sessionWithMessages([{ role: 'assistant', text: 'x'.repeat(50) }]);
    expect((await readSessionLastAssistantText(session, 's1', 10))?.length).toBe(10);
  });
});

