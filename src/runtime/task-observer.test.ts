import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
  createTaskObserver,
  extractChildSessionId,
  extractResultText,
  inferObservationStatus,
} from './task-observer';
import { TaskRegistry } from '../tools/task/registry';
import { resetTaskRegistry } from './task';
import { JobBoard } from '../tools/task/job-board';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function boardFixture() {
  const root = await mkdtemp(join(tmpdir(), 'oceanus-observer-'));
  await mkdir(join(root, '.oceanus'));
  return JobBoard.open({ workspaceRoot: root, parentSessionId: 'parent-1' });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('task-observer 结果解析', () => {
  test('extractChildSessionId 优先级 childSessionId > sessionID，并排除父 session', () => {
    expect(
      extractChildSessionId(
        { output: { sessionID: 'other', childSessionId: 'child-1' } },
        'parent-1',
      ),
    ).toBe('child-1');
    // 模糊的 sessionID 不足以确认 child session
    expect(extractChildSessionId({ sessionID: 'child-1' }, 'parent-1')).toBeUndefined();
    // 父 session 不当 child
    expect(extractChildSessionId({ sessionID: 'parent-1' }, 'parent-1')).toBeUndefined();
    expect(extractChildSessionId({ output: 'no object' }, 'parent-1')).toBeUndefined();
  });

  test('extractChildSessionId 可递归提取 metadata 深层 child_session_id', () => {
    const result = {
      metadata: { nested: [{ child_session_id: 'deep-child' }] },
      content: 'x',
    };
    expect(extractChildSessionId(result, 'parent-1')).toBe('deep-child');
  });

  test('extractResultText 有限长度且取 content/output/nested text', () => {
    expect(extractResultText('plain', 4)).toBe('plai');
    expect(extractResultText({ content: 'hello' }, 100)).toBe('hello');
    expect(extractResultText({ output: 'out' }, 100)).toBe('out');
    expect(extractResultText({ output: { text: 'nested' } }, 100)).toBe('nested');
    expect(extractResultText({ a: 1 }, 5)).toBe('{"a":');
  });

  test('inferObservationStatus completed→completed、error→failed、未知→undefined', () => {
    expect(inferObservationStatus({ status: 'completed' })).toBe('completed');
    expect(inferObservationStatus({ status: 'error' })).toBe('failed');
    expect(inferObservationStatus({ status: 'running' })).toBeUndefined();
    expect(inferObservationStatus({})).toBeUndefined();
  });
});

describe('createTaskObserver before/after 行为', () => {
  afterEach(() => resetTaskRegistry());

  test('before 用显式 taskId 创建任务，after 绑定 child 并写入结果', async () => {
    const registry = new TaskRegistry();
    const observer = createTaskObserver({ registry });
    await observer['execute.before']({
      tool: 'task',
      sessionID: 'parent-1',
      id: 'call-1',
      input: { taskId: 't-obs', description: 'job' },
    });
    expect(registry.get('t-obs', 'parent-1')?.status).toBe('running');

    await observer['execute.after']({
      tool: 'task',
      sessionID: 'parent-1',
      id: 'call-1',
      status: 'completed',
      result: { output: { childSessionId: 'child-1', text: 'done' } },
    });
    const rec = registry.get('t-obs', 'parent-1')!;
    expect(rec.childSessionId).toBe('child-1');
    expect(rec.status).toBe('completed');
    expect(rec.observation?.text).toBe('done');
  });

  test('after 无 callID 映射时 fail-open 不抛错', async () => {
    const registry = new TaskRegistry();
    const observer = createTaskObserver({ registry });
    await observer['execute.after']({
      tool: 'subagent',
      sessionID: 'parent-1',
      id: 'never-before',
      status: 'completed',
      result: { output: { childSessionId: 'child-1' } },
    });
    expect(registry.count()).toBe(0);
  });

  test('不观察自定义 task_status/result/cancel 工具', async () => {
    const registry = new TaskRegistry();
    const observer = createTaskObserver({ registry });
    await observer['execute.before']({
      tool: 'task_status',
      sessionID: 'parent-1',
      id: 'c1',
      input: { taskId: 'x' },
    });
    expect(registry.count()).toBe(0);
  });

  test('未知输入不抛错、不伪造 child session', async () => {
    const registry = new TaskRegistry();
    const observer = createTaskObserver({ registry });
    await observer['execute.before']({ tool: 'task', input: { bogus: true } });
    // 无 sessionID / 无 taskId → 不创建
    expect(registry.count()).toBe(0);
  });

  test('默认关闭终态 queue 通知：completed/failed 均不调用 session.prompt，board 仍更新', async () => {
    const registry = new TaskRegistry();
    const prompt = mock(() => Promise.resolve({}));
    const board = await boardFixture();
    const session: any = { prompt: prompt as any };
    const observer = createTaskObserver({ registry, board, session });

    await observer['execute.before']({
      tool: 'task',
      sessionID: 'parent-1',
      id: 'call-n1',
      input: { taskId: 't-notify-off' },
    });
    await observer['execute.after']({
      tool: 'task',
      sessionID: 'parent-1',
      id: 'call-n1',
      status: 'completed',
      result: { output: { childSessionId: 'child-1', text: 'done' } },
    });
    await sleep(30);
    expect(registry.get('t-notify-off', 'parent-1')?.status).toBe('completed');
    expect(board.get('t-notify-off').state).toBe('completed');

    await observer['execute.before']({
      tool: 'subagent',
      sessionID: 'parent-1',
      id: 'call-n2',
      input: { taskId: 't-notify-fail' },
    });
    await observer['execute.after']({
      tool: 'subagent',
      sessionID: 'parent-1',
      id: 'call-n2',
      status: 'error',
      result: { output: { childSessionId: 'child-2', text: 'boom' } },
    });
    await sleep(30);

    // 默认关闭：绝不调用 session.prompt
    expect(prompt.mock.calls.length).toBe(0);
    expect(registry.get('t-notify-fail', 'parent-1')?.status).toBe('failed');
    expect(board.get('t-notify-fail').state).toBe('failed');
  });

  test('重复 taskId（再次引用）不抛错，仅保留 callID 映射', async () => {
    const registry = new TaskRegistry();
    const observer = createTaskObserver({ registry });
    await observer['execute.before']({
      tool: 'task',
      sessionID: 'parent-1',
      id: 'c1',
      input: { taskId: 't-dup' },
    });
    await observer['execute.before']({
      tool: 'task',
      sessionID: 'parent-1',
      id: 'c2',
      input: { taskId: 't-dup' },
    });
    expect(registry.count()).toBe(1);
    // c2 仍能通过映射更新同一任务
    await observer['execute.after']({
      tool: 'task',
      sessionID: 'parent-1',
      id: 'c2',
      status: 'completed',
      result: { output: { childSessionId: 'child-2' } },
    });
    expect(registry.get('t-dup', 'parent-1')?.childSessionId).toBe('child-2');
  });
});

describe('task-observer 事件幂等 / generation fence / before-after barrier', () => {
  afterEach(() => resetTaskRegistry());

  test('after 先到：barrier 等待 late before 后最终 completed', async () => {
    const registry = new TaskRegistry();
    const board = await boardFixture();
    const observer = createTaskObserver({ registry, board, barrierTimeoutMs: 600 });

    // after 先到（before 尚未发生），observer 需等待 barrier
    observer['execute.after']({
      tool: 'task',
      sessionID: 'parent-1',
      id: 'call-race',
      status: 'completed',
      result: { output: { childSessionId: 'child-r', text: 'done' } },
    });
    await sleep(50);
    // before 未到：barrier 未建立，board 上尚无终态/uncertain 落盘（任务可能还未创建）
    expect(() => board.get('call-race')).toThrow('TASK_NOT_FOUND');
    // late before 到达，barrier 建立
    await observer['execute.before']({
      tool: 'task',
      sessionID: 'parent-1',
      id: 'call-race',
      input: { taskId: 'call-race' },
    });
    await sleep(150);
    expect(registry.get('call-race', 'parent-1')?.status).toBe('completed');
    expect(board.get('call-race').state).toBe('completed');
  });

  test('before 一直不来：barrier 超时写 uncertain + pending_event（BARRIER_TIMEOUT）', async () => {
    const registry = new TaskRegistry();
    const board = await boardFixture();
    const logs: string[] = [];
    const observer = createTaskObserver({
      registry,
      board,
      barrierTimeoutMs: 60,
      logger: (m) => logs.push(m),
    });

    await observer['execute.before']({
      tool: 'task', sessionID: 'parent-1', id: 'call-other', input: { taskId: 't-other' },
    });
    // 只发 after，before 永远不来
    observer['execute.after']({
      tool: 'task',
      sessionID: 'parent-1',
      id: 'call-lost',
      status: 'completed',
      result: { output: { childSessionId: 'child-x', text: 'done' } },
    });
    await sleep(250);
    expect(logs.some((m) => m.includes('BARRIER_TIMEOUT'))).toBe(true);
    const t = board.get('call-lost');
    expect(t.state).toBe('uncertain');
    expect(t.pending_event).toMatchObject({ eventId: 'call-lost:after:1', kind: 'completed' });
  });

  test('late before 到达后收敛：pending_event 被应用为最终终态', async () => {
    const registry = new TaskRegistry();
    const board = await boardFixture();
    const observer = createTaskObserver({ registry, board, barrierTimeoutMs: 60 });

    observer['execute.after']({
      tool: 'task',
      sessionID: 'parent-1',
      id: 'call-late',
      status: 'completed',
      result: { output: { childSessionId: 'child-l', text: 'ok' } },
    });
    await sleep(250);
    expect(board.get('call-late').state).toBe('uncertain');
    // late before 收敛
    await observer['execute.before']({
      tool: 'task', sessionID: 'parent-1', id: 'call-late', input: { taskId: 'call-late' },
    });
    await sleep(150);
    expect(board.get('call-late').state).toBe('completed');
    expect(board.get('call-late').pending_event).toBeUndefined();
  });

  test('回归：同 task 两个并发 call 不互相放行（barrier 按 callId 隔离）', async () => {
    const registry = new TaskRegistry();
    const board = await boardFixture();
    const observer = createTaskObserver({ registry, board, barrierTimeoutMs: 400 });

    // call-a 的 before 已建立；call-b 的 before 从未发生
    await observer['execute.before']({
      tool: 'task', sessionID: 'parent-1', id: 'call-a', input: { taskId: 't-conc' },
    });
    // call-b 的 after 携带同 taskId：不得借用 call-a 的 barrier 立即落终态
    observer['execute.after']({
      tool: 'task', sessionID: 'parent-1', id: 'call-b',
      input: { taskId: 't-conc' },
      status: 'error',
      result: { output: { childSessionId: 'child-b', text: 'boom' } },
    });
    await sleep(80);
    // call-b 无自己的 before：不得把任务写成 failed
    expect(board.get('t-conc').state).not.toBe('failed');
    // call-a 正常完成
    await observer['execute.after']({
      tool: 'task', sessionID: 'parent-1', id: 'call-a',
      status: 'completed',
      result: { output: { childSessionId: 'child-a', text: 'ok' } },
    });
    await sleep(80);
    expect(board.get('t-conc').state).toBe('completed');
    // call-b 的 after 最终只能 uncertain（pending），不得覆盖 call-a 的终态
    await sleep(450);
    expect(board.get('t-conc').state).toBe('completed');
  });

  test('回归：revive 后迟到旧 after 不覆盖新 generation（STALE_EVENT）', async () => {
    const registry = new TaskRegistry();
    const board = await boardFixture();
    const observer = createTaskObserver({ registry, board, barrierTimeoutMs: 400 });

    await observer['execute.before']({
      tool: 'task', sessionID: 'parent-1', id: 'call-old', input: { taskId: 't-rev' },
    });
    const t1 = board.get('t-rev');
    expect(t1.generation).toBe(1);
    // 置为 uncertain 后 revive → generation 2
    await board.replace(
      { ...t1, state: 'uncertain' },
      { expectedRevision: board.revision, operationId: 'to-uncertain' },
    );
    const t2 = board.get('t-rev');
    await board.revive('t-rev', {
      brief: 'resume',
      expectedRevision: board.revision,
      expectedTaskVersion: t2.task_version,
      expectedGeneration: t2.generation,
      operationId: 'revive-1',
    });
    expect(board.get('t-rev').generation).toBe(2);
    expect(board.get('t-rev').state).toBe('starting');

    // 迟到的旧 call after（barrier 记录 generation 1）：不得把新 generation 写成 completed
    await observer['execute.after']({
      tool: 'task', sessionID: 'parent-1', id: 'call-old',
      status: 'completed',
      result: { output: { childSessionId: 'child-old', text: 'late' } },
    });
    await sleep(120);
    expect(board.get('t-rev').state).toBe('starting');
    expect(board.get('t-rev').generation).toBe(2);
  });

  test('回归：after 缺 before 映射时不猜测终态，最终 uncertain + pending_event', async () => {
    const registry = new TaskRegistry();
    const board = await boardFixture();
    const logs: string[] = [];
    const observer = createTaskObserver({
      registry, board, barrierTimeoutMs: 60,
      logger: (m) => logs.push(m),
    });
    // 任务已由其它 call 创建并 running
    await board.replace(
      { task_id: 't-map', parent_session_id: 'parent-1', state: 'running', ownership: { parent_session_id: 'parent-1' } },
      { expectedRevision: 0, operationId: 'seed-map' },
    );
    // 未知 callId 的 after 到达：不得直接用当前 board generation 落 completed
    observer['execute.after']({
      tool: 'task', sessionID: 'parent-1', id: 'call-unknown',
      input: { taskId: 't-map' },
      status: 'completed',
      result: { output: { childSessionId: 'child-u', text: 'done' } },
    });
    await sleep(40);
    expect(board.get('t-map').state).not.toBe('completed');
    await sleep(120);
    const t = board.get('t-map');
    expect(t.state).toBe('uncertain');
    expect(t.pending_event).toMatchObject({ eventId: 'call-unknown:after:1', kind: 'completed' });
    expect(logs.some((m) => m.includes('BARRIER_TIMEOUT'))).toBe(true);
  });

  test('重放同 eventId 幂等：revision 不增加', async () => {
    const board = await boardFixture();
    await board.replace(
      { task_id: 't-1', parent_session_id: 'parent-1', state: 'running', ownership: { parent_session_id: 'parent-1' } },
      { expectedRevision: 0, operationId: 'seed' },
    );
    const ev = { eventId: 'c:after:1', taskId: 't-1', parentSessionId: 'parent-1', generation: 1, kind: 'completed', at: 1 };
    await board.applyObservedEvent(ev);
    const rev = board.revision;
    await board.applyObservedEvent(ev);
    expect(board.revision).toBe(rev);
    expect(board.get('t-1').state).toBe('completed');
  });
});
