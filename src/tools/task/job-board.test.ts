import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JobBoard, JobBoardCasError, JobBoardAccessError, JobBoardPersistenceError } from './job-board';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oceanus-task-board-'));
  await mkdir(join(root, '.oceanus'));
  return { root, path: join(root, '.oceanus', 'task-board.json') };
}

const task = (id = 't1') => ({
  task_id: id, alias: id, parent_session_id: 'parent', child_session_id: 'child',
  agent: 'fixer', objective: 'do work', state: 'queued', certainty: 'authoritative',
  reconciliation: 'unreconciled', task_version: 0, generation: 1, ownership: {
    parent_session_id: 'parent', owner_agent: 'sisyphus', file_scopes: ['src/a.ts'], resource_scopes: [],
  }, depends_on: [], leases: {}, messages: [], operations: {}, reusable: false,
  created_at: 1, updated_at: 1, last_activity_at: 1,
});

describe('Job Board schema v1 与持久化', () => {
  test('写入完整 v1 schema，保留 .bak 并使用原子提交', async () => {
    const f = await fixture();
    const board = await JobBoard.open({ workspaceRoot: f.root, parentSessionId: 'parent' });
    await board.replace({ ...task(), state: 'running' }, { expectedRevision: 0, operationId: 'op-1' });
    await board.replace({ ...task(), state: 'completed', reconciliation: 'reconciled' }, { expectedRevision: 1, operationId: 'op-2' });
    const saved = JSON.parse(await readFile(f.path, 'utf8'));
    expect(saved.schema_version).toBe('1');
    expect(saved.parent_agent).toBe('sisyphus');
    expect(saved.revision).toBe(2);
    expect(saved.tasks[0]).toMatchObject({ task_id: 't1', task_version: 2, generation: 1 });
    expect(saved.tasks[0].operations).toHaveProperty('op-2');
    expect(await readFile(`${f.path}.bak`, 'utf8')).toContain('"revision"');
  });

  test('截断 JSON、未知 schema、权限和写失败以 degraded 处理且不伪造完成', async () => {
    const f = await fixture();
    await writeFile(f.path, '{"schema_version":"1","tasks":');
    const broken = await JobBoard.open({ workspaceRoot: f.root, parentSessionId: 'parent' });
    expect(broken.degraded).toBe(true);
    expect(broken.tasks()).toEqual([]);
    await writeFile(f.path, JSON.stringify({ schema_version: '99', tasks: [] }));
    expect((await JobBoard.open({ workspaceRoot: f.root, parentSessionId: 'parent' })).degraded).toBe(true);
    await chmod(join(f.root, '.oceanus'), 0o500);
    await expect(JobBoard.open({ workspaceRoot: f.root, parentSessionId: 'parent' }).then(b => b.replace(task(), { expectedRevision: 0, operationId: 'x' }))).rejects.toBeInstanceOf(JobBoardPersistenceError);
  });

  test('主文件损坏时 rehydrate 使用 .bak', async () => {
    const f = await fixture();
    const board = await JobBoard.open({ workspaceRoot: f.root, parentSessionId: 'parent' });
    await board.replace(task(), { expectedRevision: 0, operationId: 'seed' });
    await writeFile(f.path, '{truncated');
    const restored = await JobBoard.open({ workspaceRoot: f.root, parentSessionId: 'parent' });
    expect(restored.tasks()[0].task_id).toBe('t1');
    expect(restored.degraded).toBe(true);
  });
});

describe('Job Board 状态、ownership、版本与 CAS', () => {
  test('跨实例同 revision 只有一个写入者成功', async () => {
    const f = await fixture();
    const a = await JobBoard.open({ workspaceRoot: f.root, parentSessionId: 'parent' });
    const b = await JobBoard.open({ workspaceRoot: f.root, parentSessionId: 'parent' });
    await a.replace(task(), { expectedRevision: 0, operationId: 'seed' });
    const left = a.replace({ ...task(), state: 'running' }, { expectedRevision: 1, operationId: 'left' });
    const right = b.replace({ ...task(), state: 'failed' }, { expectedRevision: 1, operationId: 'right' });
    const results = await Promise.allSettled([left, right]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(x => x.status === 'rejected' && x.reason instanceof JobBoardCasError)).toHaveLength(1);
    expect(JSON.parse(await readFile(f.path, 'utf8')).revision).toBe(2);
  });

  test('允许核心状态转换，拒绝非法转换和越权控制操作', async () => {
    const b = await JobBoard.open({ workspaceRoot: (await fixture()).root, parentSessionId: 'parent' });
    await b.replace(task(), { expectedRevision: 0, operationId: 'new' });
    await expect(b.transition('t1', 'starting', { sessionId: 'stranger', expectedRevision: 1, expectedTaskVersion: 1, operationId: 'bad' })).rejects.toBeInstanceOf(JobBoardAccessError);
    await expect(b.transition('t1', 'completed', { sessionId: 'parent', expectedRevision: 1, expectedTaskVersion: 1, operationId: 'illegal' })).rejects.toThrow();
    await b.transition('t1', 'starting', { sessionId: 'parent', expectedRevision: 1, expectedTaskVersion: 1, operationId: 'start' });
    await b.transition('t1', 'running', { sessionId: 'parent', expectedRevision: 2, expectedTaskVersion: 2, expectedGeneration: 1, operationId: 'run' });
    expect(b.get('t1').state).toBe('running');
  });

  test('CAS 冲突不产生副作用；operation_id 幂等且 payload 复用被拒绝', async () => {
    const b = await JobBoard.open({ workspaceRoot: (await fixture()).root, parentSessionId: 'parent' });
    await b.replace(task(), { expectedRevision: 0, operationId: 'create' });
    await expect(b.transition('t1', 'starting', { sessionId: 'parent', expectedRevision: 0, expectedTaskVersion: 1, operationId: 'race' })).rejects.toBeInstanceOf(JobBoardCasError);
    const first = await b.transition('t1', 'starting', { sessionId: 'parent', expectedRevision: 1, expectedTaskVersion: 1, operationId: 'same' });
    expect(await b.transition('t1', 'starting', { sessionId: 'parent', expectedRevision: 999, expectedTaskVersion: 999, operationId: 'same' })).toEqual(first);
    await expect(b.transition('t1', 'running', { sessionId: 'parent', expectedRevision: 2, expectedTaskVersion: 2, operationId: 'same' })).rejects.toThrow('IDEMPOTENCY_KEY_REUSE');
  });

  test('applyObservedEvent 幂等：同 eventId 同 payload revision 不增加', async () => {
    const b = await JobBoard.open({ workspaceRoot: (await fixture()).root, parentSessionId: 'parent' });
    await b.replace({ ...task(), state: 'running' }, { expectedRevision: 0, operationId: 'create' });
    const ev = { eventId: 'call-1:after:1', taskId: 't1', parentSessionId: 'parent', generation: 1, kind: 'completed', at: 1 };
    const revAfterFirst = b.revision;
    await b.applyObservedEvent(ev);
    const first = b.get('t1');
    expect(first.state).toBe('completed');
    expect(b.revision).toBe(revAfterFirst + 1);
    // 重放：同 eventId 同 payload → 幂等，revision 不增加
    const replay = await b.applyObservedEvent(ev);
    expect(b.revision).toBe(revAfterFirst + 1);
    expect(b.get('t1')).toEqual(first);
    expect(replay.state).toBe('completed');
  });

  test('applyObservedEvent 冲突：同 eventId 不同 payload 抛 EVENT_CONFLICT 且状态不变', async () => {
    const b = await JobBoard.open({ workspaceRoot: (await fixture()).root, parentSessionId: 'parent' });
    await b.replace({ ...task(), state: 'running' }, { expectedRevision: 0, operationId: 'create' });
    await b.applyObservedEvent({ eventId: 'call-1:after:1', taskId: 't1', parentSessionId: 'parent', generation: 1, kind: 'completed', at: 1 });
    const rev = b.revision;
    const before = b.get('t1');
    await expect(b.applyObservedEvent({ eventId: 'call-1:after:1', taskId: 't1', parentSessionId: 'parent', generation: 1, kind: 'failed', at: 2 })).rejects.toThrow('EVENT_CONFLICT');
    expect(b.revision).toBe(rev);
    expect(b.get('t1')).toEqual(before);
  });

  test('applyObservedEvent generation fence：旧 STALE_EVENT，新 FUTURE_GENERATION 不应用', async () => {
    const b = await JobBoard.open({ workspaceRoot: (await fixture()).root, parentSessionId: 'parent' });
    await b.replace({ ...task(), state: 'running', generation: 2 }, { expectedRevision: 0, operationId: 'create' });
    await expect(b.applyObservedEvent({ eventId: 'c:after:1', taskId: 't1', parentSessionId: 'parent', generation: 1, kind: 'completed', at: 1 })).rejects.toThrow('STALE_EVENT');
    await expect(b.applyObservedEvent({ eventId: 'c:after:1', taskId: 't1', parentSessionId: 'parent', generation: 3, kind: 'completed', at: 1 })).rejects.toThrow('FUTURE_GENERATION');
    expect(b.get('t1').state).toBe('running');
    // 同 generation 可应用
    await b.applyObservedEvent({ eventId: 'c:after:1', taskId: 't1', parentSessionId: 'parent', generation: 2, kind: 'failed', at: 1 });
    expect(b.get('t1').state).toBe('failed');
  });

  test('revive 后旧 generation 的 complete 事件不覆盖新 attempt（generation fixture）', async () => {
    const b = await JobBoard.open({ workspaceRoot: (await fixture()).root, parentSessionId: 'parent' });
    await b.replace({ ...task(), state: 'blocked', reusable: true }, { expectedRevision: 0, operationId: 'create' });
    await b.replace({ ...task(), state: 'completed', reusable: true, generation: 1 }, { expectedRevision: 1, operationId: 'done' });
    const revived = await b.revive('t1', { sessionId: 'parent', expectedRevision: 2, expectedTaskVersion: 2, expectedGeneration: 1, operationId: 'revive', resumeId: 'r1', brief: 'again' });
    expect(revived.generation).toBe(2);
    expect(revived.state).toBe('starting');
    // 旧 generation=1 的 complete 迟到 → STALE_EVENT，不覆盖新 attempt
    await expect(b.applyObservedEvent({ eventId: 'old:after:1', taskId: 't1', parentSessionId: 'parent', generation: 1, kind: 'completed', at: 1 })).rejects.toThrow('STALE_EVENT');
    expect(b.get('t1').state).toBe('starting');
    expect(b.get('t1').generation).toBe(2);
  });

  test('applyObservedEvent 终态事件缺 callId/phase（eventId 非三段式）不应用', async () => {
    const b = await JobBoard.open({ workspaceRoot: (await fixture()).root, parentSessionId: 'parent' });
    await b.replace({ ...task(), state: 'running' }, { expectedRevision: 0, operationId: 'create' });
    await expect(b.applyObservedEvent({ eventId: 'nope', taskId: 't1', parentSessionId: 'parent', generation: 1, kind: 'completed', at: 1 })).rejects.toThrow('MISSING_EVENT_KEY');
    expect(b.get('t1').state).toBe('running');
  });

  test('终态不可被同代迟到事件降级：completed 后 interrupted 不改成 cancelled', async () => {
    const b = await JobBoard.open({ workspaceRoot: (await fixture()).root, parentSessionId: 'parent' });
    await b.replace({ ...task(), state: 'running' }, { expectedRevision: 0, operationId: 'create' });
    await b.applyObservedEvent({ eventId: 'call:after:1', taskId: 't1', parentSessionId: 'parent', generation: 1, kind: 'completed', at: 1 });
    expect(b.get('t1').state).toBe('completed');
    // 同 generation 迟到的 interrupted 不得把 completed 降级为 cancelled
    await b.applyObservedEvent({ eventId: 'call:after:2', taskId: 't1', parentSessionId: 'parent', generation: 1, kind: 'interrupted', at: 2 });
    expect(b.get('t1').state).toBe('completed');
    // cancel_requested 遇 succeeded/failed 也保持 completed/failed，不改 cancelled
    await b.applyObservedEvent({ eventId: 'call:after:3', taskId: 't1', parentSessionId: 'parent', generation: 1, kind: 'failed', at: 3 });
    expect(b.get('t1').state).toBe('completed');
  });

  test('started 事件在已 running 时幂等 no-op，revision 不增加', async () => {
    const b = await JobBoard.open({ workspaceRoot: (await fixture()).root, parentSessionId: 'parent' });
    await b.replace({ ...task(), state: 'running' }, { expectedRevision: 0, operationId: 'create' });
    const rev = b.revision; const before = b.get('t1');
    await b.applyObservedEvent({ eventId: 'call:before:1', taskId: 't1', parentSessionId: 'parent', generation: 1, kind: 'started', at: 1 });
    await b.applyObservedEvent({ eventId: 'call:before:2', taskId: 't1', parentSessionId: 'parent', generation: 1, kind: 'started', at: 2 });
    expect(b.get('t1')).toEqual(before);
    expect(b.revision).toBe(rev);
  });

  test('宿主缺 attempt：同 callId:phase 同 kind 重试幂等，不误报 EVENT_CONFLICT', async () => {
    const b = await JobBoard.open({ workspaceRoot: (await fixture()).root, parentSessionId: 'parent' });
    await b.replace({ ...task(), state: 'running' }, { expectedRevision: 0, operationId: 'create' });
    await b.applyObservedEvent({ eventId: 'call-9:after:1', taskId: 't1', parentSessionId: 'parent', generation: 1, kind: 'completed', at: 1 });
    const rev = b.revision; const before = b.get('t1');
    // 宿主重试，attempt 未知 → 仍是 completed，状态与 revision 不变
    await b.applyObservedEvent({ eventId: 'call-9:after', taskId: 't1', parentSessionId: 'parent', generation: 1, kind: 'completed', at: 2 });
    expect(b.get('t1')).toEqual(before);
    expect(b.revision).toBe(rev);
    // 但同 callId:phase 不同 kind 仍是冲突
    await expect(b.applyObservedEvent({ eventId: 'call-9:after', taskId: 't1', parentSessionId: 'parent', generation: 1, kind: 'failed', at: 3 })).rejects.toThrow();
    expect(b.get('t1')).toEqual(before);
  });

  test('uncertain 任务可重新打开：revive → starting 且 generation+1', async () => {
    const b = await JobBoard.open({ workspaceRoot: (await fixture()).root, parentSessionId: 'parent' });
    await b.replace({ ...task(), state: 'uncertain' }, { expectedRevision: 0, operationId: 'create' });
    const revived = await b.revive('t1', { sessionId: 'parent', expectedRevision: 1, expectedTaskVersion: 1, expectedGeneration: 1, operationId: 'reopen', resumeId: 'r1', brief: 'again' });
    expect(revived.state).toBe('starting');
    expect(revived.generation).toBe(2);
    expect(b.get('t1').state).toBe('starting');
  });

  test('CAS 失败时 state/revision 均不变（transition 路径）', async () => {
    const b = await JobBoard.open({ workspaceRoot: (await fixture()).root, parentSessionId: 'parent' });
    await b.replace({ ...task(), state: 'running' }, { expectedRevision: 0, operationId: 'create' });
    const rev = b.revision; const before = b.get('t1');
    await expect(b.transition('t1', 'cancel_requested', { sessionId: 'parent', expectedRevision: 99, expectedTaskVersion: 99, expectedGeneration: 1, operationId: 'stale' })).rejects.toBeInstanceOf(JobBoardCasError);
    expect(b.revision).toBe(rev);
    expect(b.get('t1')).toEqual(before);
    const persisted = JSON.parse(await readFile((b as any).file, 'utf8'));
    expect(persisted.revision).toBe(rev);
    expect(persisted.tasks[0].state).toBe('running');
  });

  test('event_log 每 board（父）最多保留 32 条', async () => {
    const f = await fixture();
    const b = await JobBoard.open({ workspaceRoot: f.root, parentSessionId: 'parent' });
    await b.replace({ ...task(), state: 'running' }, { expectedRevision: 0, operationId: 'create' });
    for (let i = 0; i < 40; i++) {
      await b.applyObservedEvent({ eventId: `c-${i}:after:1`, taskId: 't1', parentSessionId: 'parent', generation: 1, kind: 'started', at: i });
    }
    const saved = JSON.parse(await readFile(f.path, 'utf8'));
    expect(Array.isArray(saved.event_log)).toBe(true);
    expect(saved.event_log.length).toBeLessThanOrEqual(32);
  });

  test('generation、旧事件和 cancel/revive 竞态按线性化结果处理', async () => {
    const b = await JobBoard.open({ workspaceRoot: (await fixture()).root, parentSessionId: 'parent' });
    await b.replace({ ...task(), state: 'running' }, { expectedRevision: 0, operationId: 'create' });
    const cancel = b.transition('t1', 'cancel_requested', { sessionId: 'parent', expectedRevision: 1, expectedTaskVersion: 1, expectedGeneration: 1, operationId: 'cancel' });
    const revive = b.revive('t1', { sessionId: 'parent', expectedRevision: 1, expectedTaskVersion: 1, expectedGeneration: 1, operationId: 'revive', resumeId: 'r1', brief: 'continue' });
    await Promise.allSettled([cancel, revive]);
    await expect(b.recordEvent('t1', { generation: 0, state: 'completed' })).rejects.toThrow('STALE_EVENT');
    expect(b.get('t1').generation).toBeGreaterThanOrEqual(1);
  });
});

describe('Job Board 消息 outbox（T4）', () => {
  test('appendMessage 返回更新后的 task，CAS 冲突拒绝；updateMessage 更新 state/attempts', async () => {
    const f = await fixture();
    const b = await JobBoard.open({ workspaceRoot: f.root, parentSessionId: 'parent' });
    await b.replace({ ...task(), state: 'running' }, { expectedRevision: 0, operationId: 'create' });
    const after = await b.appendMessage('t1', { sequence: 1, key: 'k1', message: 'm', state: 'pending', attempts: 0 }, { expectedRevision: 1, expectedTaskVersion: 1, generation: 1 });
    expect(after.task_version).toBe(2);
    expect(after.last_board_revision).toBe(2);
    // 旧 revision 重放 → CAS 冲突
    await expect(b.appendMessage('t1', { sequence: 2, key: 'k2', message: 'm2', state: 'pending', attempts: 0 }, { expectedRevision: 1, expectedTaskVersion: 1, generation: 1 })).rejects.toThrow(JobBoardCasError);
    // updateMessage：CAS 更新投递状态
    const upd = await b.updateMessage('t1', 'k1', { state: 'delivered', attempts: 1 }, { expectedRevision: 2, expectedTaskVersion: 2, generation: 1 });
    expect(upd.messages.find((m: any) => m.key === 'k1')).toMatchObject({ state: 'delivered', attempts: 1 });
    await expect(b.updateMessage('t1', 'k1', { state: 'delivered' }, { expectedRevision: 2, expectedTaskVersion: 2, generation: 1 })).rejects.toThrow(JobBoardCasError);
    await expect(b.updateMessage('t1', 'missing', { state: 'delivered' }, { expectedRevision: upd.last_board_revision, expectedTaskVersion: upd.task_version, generation: 1 })).rejects.toThrow('MESSAGE_NOT_FOUND');
    await expect(b.updateMessage('t1', 'k1', { state: 'delivered' }, { expectedRevision: upd.last_board_revision, expectedTaskVersion: upd.task_version, generation: 2 })).rejects.toThrow(JobBoardCasError);
  });

  test('appendMessage 非 running / generation 不符 → TASK_NOT_LIVE', async () => {
    const f = await fixture();
    const b = await JobBoard.open({ workspaceRoot: f.root, parentSessionId: 'parent' });
    await b.replace({ ...task(), state: 'running' }, { expectedRevision: 0, operationId: 'create' });
    await expect(b.appendMessage('t1', { sequence: 1, key: 'k', message: 'm', state: 'pending', attempts: 0 }, { expectedRevision: 1, expectedTaskVersion: 1, generation: 2 })).rejects.toThrow('TASK_NOT_LIVE');
    await b.transition('t1', 'completed', { sessionId: 'parent', expectedRevision: 1, expectedTaskVersion: 1, expectedGeneration: 1, operationId: 'done' });
    await expect(b.appendMessage('t1', { sequence: 1, key: 'k', message: 'm', state: 'pending', attempts: 0 }, { expectedRevision: 2, expectedTaskVersion: 2, generation: 1 })).rejects.toThrow('TASK_NOT_LIVE');
  });
});
