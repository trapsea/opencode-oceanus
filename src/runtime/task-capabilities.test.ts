import { describe, expect, test } from 'bun:test';
import { createV2SessionAdapter } from './task-capabilities';
import type { SessionLike } from './types';

describe('createV2SessionAdapter（真实 v2 会话续用/投递）', () => {
  test('resumeChild：prompt + wait + get 验证 outcome', async () => {
    const calls: string[] = [];
    const session = {
      prompt: async (input: any) => { calls.push(`prompt:${input.sessionID}:${input.text}`); },
      wait: async (input: any) => { calls.push(`wait:${input.sessionID}`); },
      get: async (input: any) => {
        calls.push(`get:${input.sessionID}`);
        return { id: input.sessionID, outcome: 'succeeded' as const };
      },
    } as unknown as SessionLike;
    const adapter = createV2SessionAdapter(session);
    const res = await adapter.resumeChild({ childSessionId: 'c1', brief: '继续', generation: 2 });
    expect(res).toEqual({ ok: true, status: 'succeeded' });
    expect(calls).toEqual(['prompt:c1:继续', 'wait:c1', 'get:c1']);
  });

  test('resumeChild：wait 后拿不到 outcome → delivered（不伪造终态）', async () => {
    const session = {
      prompt: async () => {},
      wait: async () => {},
      get: async () => ({}),
    } as unknown as SessionLike;
    const res = await createV2SessionAdapter(session).resumeChild({ childSessionId: 'c1', brief: 'b', generation: 1 });
    expect(res).toEqual({ ok: true, status: 'delivered' });
  });

  test('resumeChild：缺 wait 能力 → unsupported', async () => {
    const session = { prompt: async () => {} } as unknown as SessionLike;
    const res = await createV2SessionAdapter(session).resumeChild({ childSessionId: 'c1', brief: 'b', generation: 1 });
    expect(res).toEqual({ ok: false, reason: 'unsupported' });
  });

  test('resumeChild：调用抛错/timeout → ok:false', async () => {
    const timeout = { prompt: async () => { throw new Error('request timed out'); }, wait: async () => {} } as unknown as SessionLike;
    expect(await createV2SessionAdapter(timeout).resumeChild({ childSessionId: 'c1', brief: 'b', generation: 1 }))
      .toEqual({ ok: false, reason: 'timeout' });
    const boom = { prompt: async () => { throw new Error('boom'); }, wait: async () => {} } as unknown as SessionLike;
    expect(await createV2SessionAdapter(boom).resumeChild({ childSessionId: 'c1', brief: 'b', generation: 1 }))
      .toEqual({ ok: false, reason: 'boom' });
  });

  test('sendMessage：仅入队 → queued；缺 prompt → unsupported', async () => {
    const sent: any[] = [];
    const session = { prompt: async (input: any) => { sent.push(input); } } as unknown as SessionLike;
    const adapter = createV2SessionAdapter(session);
    expect(await adapter.sendMessage({ childSessionId: 'c1', message: 'hi' })).toEqual({ ok: true, status: 'queued' });
    expect(sent[0]).toMatchObject({ sessionID: 'c1', text: 'hi', delivery: 'queue' });
    expect(await createV2SessionAdapter({} as SessionLike).sendMessage({ childSessionId: 'c1', message: 'hi' }))
      .toEqual({ ok: false, reason: 'unsupported' });
  });

  test('缺少 childSessionId → missing_child_session', async () => {
    const adapter = createV2SessionAdapter({} as SessionLike);
    expect(await adapter.resumeChild({ childSessionId: '', brief: 'b', generation: 1 }))
      .toEqual({ ok: false, reason: 'missing_child_session' });
    expect(await adapter.sendMessage({ childSessionId: '', message: 'x' }))
      .toEqual({ ok: false, reason: 'missing_child_session' });
  });
});
