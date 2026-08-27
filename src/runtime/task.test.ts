import { describe, expect, test } from 'bun:test';
import { getTaskRegistry, resetTaskRegistry } from './task';

describe('getTaskRegistry 单例', () => {
  test('进程级单例，resetTaskRegistry 后重建', () => {
    const a = getTaskRegistry();
    const b = getTaskRegistry();
    expect(b).toBe(a);
    resetTaskRegistry();
    const c = getTaskRegistry();
    expect(c).not.toBe(a);
  });

  test('registry 任务记录默认 generation=1', () => {
    resetTaskRegistry();
    const registry = getTaskRegistry();
    registry.create({ id: 't-gen', parentSessionId: 'parent-1' });
    const rec = registry.get('t-gen', 'parent-1');
    expect(rec?.generation).toBe(1);
    registry.clear();
  });
});
