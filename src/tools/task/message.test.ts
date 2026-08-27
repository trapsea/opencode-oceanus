import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTaskMessageTool, resetTaskMessages } from './message';
import { JobBoard } from './job-board';

const parse = (x: { content?: unknown }) => JSON.parse(x.content as string) as any;
const ctx = { sessionID: 'parent' } as any;

let workspace = '';
afterEach(async () => { if (workspace) { await rm(workspace, { recursive: true, force: true }); workspace = ''; } });

/** 打开独立 board 并 seed 一个 running 任务（带 child session）。 */
async function seeded(opts: { child?: string | null; state?: string; generation?: number; parent?: string } = {}) {
  workspace = await mkdtemp(join(tmpdir(), 'oceanus-msg-'));
  const board = await JobBoard.open({ workspaceRoot: workspace, parentSessionId: 'parent' });
  await board.replace({
    task_id: 't1', parent_session_id: opts.parent ?? 'parent', ownership: { parent_session_id: opts.parent ?? 'parent' },
    state: opts.state ?? 'running', task_version: 0, generation: opts.generation ?? 1,
    child_session_id: opts.child === null ? undefined : (opts.child ?? 'child-1'),
  }, { expectedRevision: 0, operationId: 'seed' });
  return { board, workspace };
}

/** 可脚本化的 fake send 能力：resolve=delivered，reject/ok:false=uncertain。 */
function fakeSend(script: Array<'ok' | 'fail' | 'reject'>) {
  const calls: any[] = [];
  const sendMessage = async (x: any) => {
    calls.push(x);
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    if (step === 'fail') return { ok: false, reason: 'host_refused' };
    if (step === 'reject') throw new Error('boom');
    return { ok: true, status: 'queued' };
  };
  return { sendMessage, calls };
}

describe('task_message 可靠投递（T4）', () => {
  test('send resolve → delivered，sequence 递增，读取模式只需 taskId', async () => {
    const { board } = await seeded();
    const send = fakeSend(['ok']);
    const tool = buildTaskMessageTool(board, send);
    const a = parse(await tool.execute({ taskId: 't1', message: 'm1', idempotencyKey: 'k1' }, ctx));
    expect(a.state).toBe('delivered');
    expect(a.attempts).toBe(1);
    expect(a.sequence).toBe(1);
    expect(a.key).toBe('k1');
    expect(send.calls).toHaveLength(1);
    expect(send.calls[0].childSessionId).toBe('child-1');
    const b = parse(await tool.execute({ taskId: 't1', message: 'm2', idempotencyKey: 'k2' }, ctx));
    expect(b.sequence).toBe(2);
    expect(b.state).toBe('delivered');
    // 读取模式：无 message / 无 key 均可，不报错
    const read = parse(await tool.execute({ taskId: 't1' }, ctx));
    expect(read.messages.map((x: any) => x.key)).toEqual(['k1', 'k2']);
    expect(read.messages.map((x: any) => x.state)).toEqual(['delivered', 'delivered']);
  });

  test('send 抛错 / ok:false → uncertain 带 error，attempts=1', async () => {
    const { board } = await seeded();
    const reject = buildTaskMessageTool(board, fakeSend(['reject']));
    const a = parse(await reject.execute({ taskId: 't1', message: 'm', idempotencyKey: 'k' }, ctx));
    expect(a.state).toBe('uncertain');
    expect(a.error).toBe('boom');
    expect(a.attempts).toBe(1);
    const fail = buildTaskMessageTool(board, fakeSend(['fail']));
    const b = parse(await fail.execute({ taskId: 't1', message: 'm', idempotencyKey: 'k2' }, ctx));
    expect(b.state).toBe('uncertain');
    expect(b.error).toBe('host_refused');
  });

  test('无 sendMessage 能力 → uncertain，不伪造 delivered', async () => {
    const { board } = await seeded();
    const tool = buildTaskMessageTool(board, {});
    const a = parse(await tool.execute({ taskId: 't1', message: 'm', idempotencyKey: 'k' }, ctx));
    expect(a.state).toBe('uncertain');
    expect(a.error).toBe('no_delivery_capability');
  });

  test('重复 key 不重复发送，返回既有记录', async () => {
    const { board } = await seeded();
    const send = fakeSend(['ok']);
    const tool = buildTaskMessageTool(board, send);
    const first = parse(await tool.execute({ taskId: 't1', message: 'm', idempotencyKey: 'k' }, ctx));
    const again = parse(await tool.execute({ taskId: 't1', message: 'm-changed', idempotencyKey: 'k' }, ctx));
    expect(again.sequence).toBe(first.sequence);
    expect(again.message).toBe('m');
    expect(send.calls).toHaveLength(1);
  });

  test('retry：uncertain 重试成功 → delivered；总 attempts ≤ 3，超限 RETRY_LIMIT；delivered 不重试', async () => {
    const { board } = await seeded();
    const send = fakeSend(['reject']);
    const tool = buildTaskMessageTool(board, send);
    const a = parse(await tool.execute({ taskId: 't1', message: 'm', idempotencyKey: 'k' }, ctx));
    expect(a.state).toBe('uncertain');
    // 换成功脚本重试
    const send2 = fakeSend(['ok']);
    const tool2 = buildTaskMessageTool(board, send2);
    const r1 = parse(await tool2.execute({ taskId: 't1', retryKey: 'k' }, ctx));
    expect(r1.state).toBe('delivered');
    expect(r1.attempts).toBe(2);
    expect(send2.calls).toHaveLength(1);
    // delivered 再 retry → 不发送，原样返回
    const r2 = parse(await tool2.execute({ taskId: 't1', retryKey: 'k' }, ctx));
    expect(r2.state).toBe('delivered');
    expect(r2.attempts).toBe(2);
    expect(send2.calls).toHaveLength(1);
    // 连续失败到上限
    const send3 = buildTaskMessageTool(board, fakeSend(['reject']));
    const b = parse(await send3.execute({ taskId: 't1', message: 'm2', idempotencyKey: 'k9' }, ctx));
    expect(b.attempts).toBe(1);
    const b2 = parse(await send3.execute({ taskId: 't1', retryKey: 'k9' }, ctx));
    expect(b2.state).toBe('uncertain');
    expect(b2.attempts).toBe(2);
    const b3 = parse(await send3.execute({ taskId: 't1', retryKey: 'k9' }, ctx));
    expect(b3.attempts).toBe(3);
    const b4 = parse(await send3.execute({ taskId: 't1', retryKey: 'k9' }, ctx));
    expect(b4.error).toBe('RETRY_LIMIT');
    expect(b4.attempts).toBe(3);
  });

  test('无 child / 非 running → TASK_NOT_LIVE，不写 outbox', async () => {
    const noChild = await seeded({ child: null });
    const t1 = buildTaskMessageTool(noChild.board, fakeSend(['ok']));
    expect(parse(await t1.execute({ taskId: 't1', message: 'm', idempotencyKey: 'k' }, ctx)).error).toBe('TASK_NOT_LIVE');
    expect((await noChild.board.messages('t1'))).toHaveLength(0);
    const notRunning = await seeded({ state: 'completed' });
    const t2 = buildTaskMessageTool(notRunning.board, fakeSend(['ok']));
    expect(parse(await t2.execute({ taskId: 't1', message: 'm', idempotencyKey: 'k' }, ctx)).error).toBe('TASK_NOT_LIVE');
    expect((await notRunning.board.messages('t1'))).toHaveLength(0);
  });

  test('跨 parent / generation 冲突 → 拒绝且不写 outbox', async () => {
    const { board } = await seeded();
    const tool = buildTaskMessageTool(board, fakeSend(['ok']));
    const p2 = parse(await tool.execute({ taskId: 't1', message: 'm', idempotencyKey: 'k' }, { sessionID: 'other' } as any));
    expect(p2.error).toBe('PARENT_OWNERSHIP');
    const g = parse(await tool.execute({ taskId: 't1', message: 'm', idempotencyKey: 'k', expectedGeneration: 2 }, ctx));
    expect(g.error).toBe('GENERATION_CONFLICT');
    expect((await board.messages('t1'))).toHaveLength(0);
  });

  test('超过 32 条 → MESSAGE_LIMIT', async () => {
    const { board } = await seeded();
    const send = fakeSend(['ok']);
    const tool = buildTaskMessageTool(board, send);
    for (let i = 0; i < 32; i++) {
      const r = parse(await tool.execute({ taskId: 't1', message: `m${i}`, idempotencyKey: `k${i}` }, ctx));
      expect(r.error).toBeUndefined();
    }
    expect(parse(await tool.execute({ taskId: 't1', message: 'overflow', idempotencyKey: 'kx' }, ctx)).error).toBe('MESSAGE_LIMIT');
    // 读取不受影响
    const read = parse(await tool.execute({ taskId: 't1', limit: 32 }, ctx));
    expect(read.messages).toHaveLength(32);
  });

  test('重启（重开 board）保留 pending/uncertain，不自动发送', async () => {
    const { board, workspace: ws } = await seeded();
    const tool = buildTaskMessageTool(board, fakeSend(['reject']));
    const a = parse(await tool.execute({ taskId: 't1', message: 'm', idempotencyKey: 'k' }, ctx));
    expect(a.state).toBe('uncertain');
    // 重启：重新打开 board，不自动 flush
    const reopened = await JobBoard.open({ workspaceRoot: ws, parentSessionId: 'parent' });
    const persisted = (await reopened.messages('t1')).find((m: any) => m.key === 'k');
    expect(persisted.state).toBe('uncertain');
    expect(persisted.attempts).toBe(1);
    expect(persisted.message).toBe('m');
  });

  test('写入模式缺 key / 空 message / 超大 → 拒绝', async () => {
    const { board } = await seeded();
    const tool = buildTaskMessageTool(board, fakeSend(['ok']));
    expect(parse(await tool.execute({ taskId: 't1', message: 'm' }, ctx)).error).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(parse(await tool.execute({ taskId: 't1', message: '', idempotencyKey: 'k' }, ctx)).error).toBe('MESSAGE_SIZE');
    expect(parse(await tool.execute({ taskId: 't1', message: '你'.repeat(2731), idempotencyKey: 'k' }, ctx)).error).toBe('MESSAGE_SIZE');
    expect(parse(await tool.execute({ taskId: 't1', message: '你'.repeat(2730), idempotencyKey: 'k' }, ctx)).error).toBeUndefined();
    expect(parse(await tool.execute({ taskId: '' }, ctx)).error).toBe('taskId 必填');
  });
});

describe('task_message 内存 fallback（无 board）', () => {
  test('尺寸限制、幂等、32 条上限、TASK_NOT_LIVE', async () => {
    resetTaskMessages(); const tool = buildTaskMessageTool(undefined, fakeSend(['ok']));
    const ok = parse(await tool.execute({ taskId: 'a', message: '你'.repeat(2730), idempotencyKey: 'k', taskStatus: 'running' }, ctx));
    expect(ok.error).toBeUndefined();
    expect(ok.state).toBe('delivered');
    expect(parse(await tool.execute({ taskId: 'a', message: '你'.repeat(2730), idempotencyKey: 'k', taskStatus: 'running' }, ctx)).sequence).toBe(ok.sequence);
    expect(parse(await tool.execute({ taskId: 'a', message: 'x', taskStatus: 'running' }, ctx)).error).toBe('IDEMPOTENCY_KEY_REQUIRED');
    for (let i = 0; i < 32; i++) expect(parse(await tool.execute({ taskId: 'b', message: `m${i}`, idempotencyKey: `k${i}`, taskStatus: 'running' }, ctx)).error).toBeUndefined();
    expect(parse(await tool.execute({ taskId: 'b', message: 'overflow', idempotencyKey: 'kx', taskStatus: 'running' }, ctx)).error).toBe('MESSAGE_LIMIT');
    expect(parse(await tool.execute({ taskId: 'b', message: 'm', idempotencyKey: 'ky', taskStatus: 'completed' }, ctx)).error).toBe('TASK_NOT_LIVE');
    const read = parse(await tool.execute({ taskId: 'b', limit: 32 }, ctx));
    expect(read.messages).toHaveLength(32);
  });
});
