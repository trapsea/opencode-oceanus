import { describe, expect, test } from 'bun:test';
import {
  DuplicateTaskError,
  TaskAccessDeniedError,
  TaskNotFoundError,
  TaskRegistry,
  TaskRegistryCapacityError,
} from './registry';
import { isTerminalStatus, TERMINAL_STATUSES } from './types';

function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('TaskRegistry 注册与解析', () => {
  test('创建任务并返回完整记录', () => {
    const clock = makeClock();
    const registry = new TaskRegistry({ now: clock.now });
    const task = registry.create({
      id: 't1',
      parentSessionId: 'parent',
      childSessionId: 'child',
    });

    expect(task).toMatchObject({
      id: 't1',
      parentSessionId: 'parent',
      childSessionId: 'child',
      status: 'running',
    });
    expect(task.createdAt).toBe(1_000_000);
    expect(task.lastActivityAt).toBe(1_000_000);
    expect(registry.count()).toBe(1);
  });

  test('默认状态为 running，创建时间可显式指定', () => {
    const registry = new TaskRegistry();
    const task = registry.create({
      id: 't1',
      parentSessionId: 'parent',
      createdAt: 42,
    });
    expect(task.status).toBe('running');
    expect(task.createdAt).toBe(42);
    expect(task.lastActivityAt).toBe(42);
  });

  test('重复 id 抛 DuplicateTaskError', () => {
    const registry = new TaskRegistry();
    registry.create({ id: 't1', parentSessionId: 'parent' });
    expect(() =>
      registry.create({ id: 't1', parentSessionId: 'parent' }),
    ).toThrow(DuplicateTaskError);
  });

  test('空 id 或空 parentSessionId 被拒绝', () => {
    const registry = new TaskRegistry();
    // @ts-expect-error 空 id
    expect(() => registry.create({ id: '', parentSessionId: 'p' })).toThrow(
      'task id 不能为空',
    );
    // @ts-expect-error 空 parent
    expect(() => registry.create({ id: 't1', parentSessionId: '' })).toThrow(
      'parentSessionId 不能为空',
    );
  });
});

describe('TaskRegistry ownership 与跨 session 访问拒绝', () => {
  function setup() {
    const registry = new TaskRegistry();
    const task = registry.create({
      id: 't1',
      parentSessionId: 'parent',
      childSessionId: 'child',
    });
    return { registry, task };
  }

  test('父 session 可读取任务', () => {
    const { registry } = setup();
    expect(registry.get('t1', 'parent')?.id).toBe('t1');
  });

  test('子 session 可读取任务', () => {
    const { registry } = setup();
    expect(registry.get('t1', 'child')?.id).toBe('t1');
  });

  test('无关 session 读取任务被拒绝', () => {
    const { registry } = setup();
    expect(() => registry.get('t1', 'stranger')).toThrow(
      TaskAccessDeniedError,
    );
  });

  test('更新状态：父/子 session 可写，无关 session 被拒绝', () => {
    const { registry } = setup();
    expect(registry.updateStatus('t1', 'child', 'completed').status).toBe(
      'completed',
    );
    expect(() => registry.updateStatus('t1', 'stranger', 'failed')).toThrow(
      TaskAccessDeniedError,
    );
  });

  test('touch 刷新最后活动时间并校验 ownership', () => {
    const clock = makeClock();
    const registry = new TaskRegistry({ now: clock.now });
    registry.create({
      id: 't1',
      parentSessionId: 'parent',
      childSessionId: 'child',
    });
    clock.advance(500);
    const touched = registry.touch('t1', 'parent');
    expect(touched.lastActivityAt).toBe(1_000_500);
    expect(() => registry.touch('t1', 'stranger')).toThrow(
      TaskAccessDeniedError,
    );
  });

  test('未知任务抛 TaskNotFoundError', () => {
    const registry = new TaskRegistry();
    expect(() => registry.updateStatus('nope', 'parent', 'failed')).toThrow(
      TaskNotFoundError,
    );
    expect(registry.get('nope', 'parent')).toBeUndefined();
  });

  test('listBySession 只返回该 session 参与的任务', () => {
    const registry = new TaskRegistry();
    registry.create({ id: 't1', parentSessionId: 'parent', childSessionId: 'c1' });
    registry.create({ id: 't2', parentSessionId: 'parent', childSessionId: 'c2' });
    registry.create({ id: 't3', parentSessionId: 'other' });

    expect(registry.listBySession('parent').map((t) => t.id).sort()).toEqual([
      't1',
      't2',
    ]);
    expect(registry.listBySession('c1').map((t) => t.id)).toEqual(['t1']);
    expect(registry.listBySession('stranger')).toEqual([]);
  });

  test('get/listBySession 返回副本，外部修改不影响内部索引', () => {
    const registry = new TaskRegistry();
    const task = registry.create({
      id: 't1',
      parentSessionId: 'parent',
      childSessionId: 'child',
    });
    task.status = 'completed';
    task.parentSessionId = 'hacked';

    expect(registry.get('t1', 'parent')?.status).toBe('running');
    expect(registry.get('t1', 'parent')?.parentSessionId).toBe('parent');
    const listed = registry.listBySession('parent')[0];
    listed.parentSessionId = 'hacked';
    expect(registry.get('t1', 'parent')?.parentSessionId).toBe('parent');
  });
});

describe('TaskRegistry 状态索引', () => {
  test('idsByStatus 反映状态更新', () => {
    const registry = new TaskRegistry();
    registry.create({ id: 't1', parentSessionId: 'p' });
    registry.create({ id: 't2', parentSessionId: 'p' });
    registry.updateStatus('t1', 'p', 'completed');

    expect(registry.idsByStatus('running').sort()).toEqual(['t2']);
    expect(registry.idsByStatus('completed')).toEqual(['t1']);
  });

  test('idsByStatus 返回副本', () => {
    const registry = new TaskRegistry();
    registry.create({ id: 't1', parentSessionId: 'p' });
    const ids = registry.idsByStatus('running');
    ids.push('t2');
    expect(registry.idsByStatus('running')).toEqual(['t1']);
  });

  test('状态索引在清理后保持一致', () => {
    const registry = new TaskRegistry();
    registry.create({ id: 't1', parentSessionId: 'p' });
    registry.updateStatus('t1', 'p', 'failed');
    registry.pruneTerminal();
    expect(registry.idsByStatus('failed')).toEqual([]);
    expect(registry.idsBySession('p')).toEqual([]);
    expect(registry.count()).toBe(0);
  });
});

describe('TaskRegistry 终态清理', () => {
  test('非终态任务（running/unknown）不会被清理', () => {
    const clock = makeClock();
    const registry = new TaskRegistry({ now: clock.now, terminalTtlMs: 0 });
    registry.create({ id: 't1', parentSessionId: 'p', status: 'running' });
    registry.create({ id: 't2', parentSessionId: 'p', status: 'unknown' });
    clock.advance(10_000);
    expect(registry.cleanup()).toBe(0);
    expect(registry.count()).toBe(2);
  });

  test('超过 TTL 的终态任务被清理，未超过的被保留', () => {
    const clock = makeClock();
    const registry = new TaskRegistry({ now: clock.now, terminalTtlMs: 1000 });
    registry.create({ id: 't1', parentSessionId: 'p' });
    registry.create({ id: 't2', parentSessionId: 'p' });
    registry.updateStatus('t1', 'p', 'completed'); // lastActivityAt = now
    clock.advance(500);
    registry.updateStatus('t2', 'p', 'failed'); // lastActivityAt = now+500

    clock.advance(600); // t1 已 1100ms 过期，t2 仅 600ms
    expect(registry.cleanup()).toBe(1);
    expect(registry.get('t1', 'p')).toBeUndefined();
    expect(registry.get('t2', 'p')?.status).toBe('failed');

    clock.advance(500); // t2 已 1100ms 过期
    expect(registry.cleanup()).toBe(1);
    expect(registry.count()).toBe(0);
  });

  test('pruneTerminal 立即清理全部终态任务', () => {
    const registry = new TaskRegistry({ terminalTtlMs: 10_000 });
    registry.create({ id: 't1', parentSessionId: 'p', status: 'running' });
    registry.create({ id: 't2', parentSessionId: 'p' });
    registry.updateStatus('t2', 'p', 'cancelled');
    registry.create({ id: 't3', parentSessionId: 'p' });
    registry.updateStatus('t3', 'p', 'completed');

    expect(registry.pruneTerminal()).toBe(2);
    expect(registry.count()).toBe(1);
    expect(registry.get('t1', 'p')?.status).toBe('running');
  });

  test('清理只移除终态，不误删父 session 下其它任务', () => {
    const registry = new TaskRegistry({ terminalTtlMs: 0 });
    registry.create({ id: 't1', parentSessionId: 'p' });
    registry.create({ id: 't2', parentSessionId: 'p' });
    registry.updateStatus('t1', 'p', 'completed');
    registry.cleanup();
    expect(registry.get('t2', 'p')?.id).toBe('t2');
  });
});

describe('TaskRegistry 容量上限', () => {
  test('达到上限时拒绝新增，抛出容量错误', () => {
    const registry = new TaskRegistry({ maxTasks: 2 });
    registry.create({ id: 't1', parentSessionId: 'p' });
    registry.create({ id: 't2', parentSessionId: 'p' });
    expect(() =>
      registry.create({ id: 't3', parentSessionId: 'p' }),
    ).toThrow(TaskRegistryCapacityError);
  });

  test('新增时自动清理已过期终态任务以腾出容量', () => {
    const clock = makeClock();
    const registry = new TaskRegistry({
      maxTasks: 2,
      terminalTtlMs: 100,
      now: clock.now,
    });
    registry.create({ id: 't1', parentSessionId: 'p' });
    registry.create({ id: 't2', parentSessionId: 'p' });
    registry.updateStatus('t1', 'p', 'completed');

    clock.advance(200);
    const task = registry.create({ id: 't3', parentSessionId: 'p' });
    expect(task.id).toBe('t3');
    expect(registry.count()).toBe(2);
  });

  test('过期终态任务腾不出容量时仍拒绝新增', () => {
    const clock = makeClock();
    const registry = new TaskRegistry({
      maxTasks: 2,
      terminalTtlMs: 100,
      now: clock.now,
    });
    registry.create({ id: 't1', parentSessionId: 'p' });
    registry.create({ id: 't2', parentSessionId: 'p', status: 'running' });
    // 两个都是非终态/未过期，无可清理
    expect(() =>
      registry.create({ id: 't3', parentSessionId: 'p' }),
    ).toThrow(TaskRegistryCapacityError);
  });

  test('默认容量为 512', () => {
    const registry = new TaskRegistry();
    for (let i = 0; i < 512; i += 1) {
      registry.create({ id: `t${i}`, parentSessionId: 'p' });
    }
    expect(() =>
      registry.create({ id: 'overflow', parentSessionId: 'p' }),
    ).toThrow(TaskRegistryCapacityError);
  });

  test('非法配置被拒绝', () => {
    expect(() => new TaskRegistry({ maxTasks: 0 })).toThrow('正整数');
    expect(() => new TaskRegistry({ maxTasks: -1 })).toThrow('正整数');
    expect(() => new TaskRegistry({ terminalTtlMs: -5 })).toThrow('非负数');
  });
});

describe('TaskRegistry 观察辅助（attachChildSession / setObservation）', () => {
  test('attachChildSession 绑定子 session 并维护 session 索引', () => {
    const registry = new TaskRegistry();
    registry.create({ id: 't1', parentSessionId: 'parent' });
    const rec = registry.attachChildSession('t1', 'parent', 'child');
    expect(rec.childSessionId).toBe('child');
    expect(registry.get('t1', 'child')?.id).toBe('t1'); // 子 session 可访问
    // 换绑：旧子 session 不再是父/子，访问被拒（越权）
    registry.attachChildSession('t1', 'parent', 'child2');
    expect(() => registry.get('t1', 'child')).toThrow(TaskAccessDeniedError);
    expect(registry.get('t1', 'child2')?.id).toBe('t1');
  });

  test('attachChildSession 仅父 session 可调用（越权抛错）', () => {
    const registry = new TaskRegistry();
    registry.create({ id: 't1', parentSessionId: 'parent' });
    expect(() => registry.attachChildSession('t1', 'stranger', 'child')).toThrow(
      TaskAccessDeniedError,
    );
    expect(() => registry.attachChildSession('nope', 'parent', 'child')).toThrow(
      TaskNotFoundError,
    );
  });

  test('setObservation 存储受限结果、绑定 child、同步终态并返回副本', () => {
    const clock = makeClock();
    const registry = new TaskRegistry({ now: clock.now });
    registry.create({ id: 't1', parentSessionId: 'parent' });
    const obs = {
      source: 'host-after',
      childSessionId: 'child',
      text: 'x'.repeat(10_000),
      status: 'completed',
      at: clock.now(),
    };
    const rec = registry.setObservation('t1', 'parent', obs);
    // 文本被截断到上限
    expect(rec.observation?.text?.length).toBe(2000);
    expect(rec.observation?.status).toBe('completed');
    expect(rec.childSessionId).toBe('child');
    // 记录状态被同步为终态
    expect(registry.get('t1', 'parent')?.status).toBe('completed');
    expect(registry.get('t1', 'child')?.id).toBe('t1');
  });

  test('setObservation 非终态不伪造终态，越权抛错', () => {
    const registry = new TaskRegistry();
    registry.create({ id: 't1', parentSessionId: 'parent' });
    registry.setObservation('t1', 'parent', {
      source: 'host-after',
      status: 'running',
      at: 1,
    });
    expect(registry.get('t1', 'parent')?.status).toBe('running');
    expect(() =>
      registry.setObservation('t1', 'stranger', { source: 'x', at: 1 }),
    ).toThrow(TaskAccessDeniedError);
  });

  test('setObservation/attachChildSession 返回副本，外部修改不影响内部', () => {
    const registry = new TaskRegistry();
    registry.create({ id: 't1', parentSessionId: 'parent' });
    const rec = registry.setObservation('t1', 'parent', {
      source: 'host-after',
      text: 'hello',
      at: 1,
    });
    rec.observation!.text = 'hacked';
    expect(registry.get('t1', 'parent')?.observation?.text).toBe('hello');
  });
});

describe('类型辅助函数', () => {
  test('isTerminalStatus 判断正确', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(isTerminalStatus(status)).toBe(true);
    }
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus('unknown')).toBe(false);
  });
});
