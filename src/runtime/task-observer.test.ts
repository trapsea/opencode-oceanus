import { afterEach, describe, expect, test } from 'bun:test';
import {
  createTaskObserver,
  extractChildSessionId,
  extractResultText,
  inferObservationStatus,
} from './task-observer';
import { TaskRegistry } from '../tools/task/registry';
import { resetTaskRegistry } from './task';

describe('task-observer 结果解析', () => {
  test('extractChildSessionId 优先级 childSessionId > sessionID，并排除父 session', () => {
    expect(
      extractChildSessionId(
        { output: { sessionID: 'other', childSessionId: 'child-1' } },
        'parent-1',
      ),
    ).toBe('child-1');
    expect(extractChildSessionId({ sessionID: 'child-1' }, 'parent-1')).toBe(
      'child-1',
    );
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
