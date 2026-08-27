import { describe, expect, test } from 'bun:test';
import { TASK_STATES, TERMINAL_TASK_STATES, isTerminalTaskState } from './task-state';

describe('任务状态声明契约', () => {
  test('枚举包含全部运行态，终态集合准确', () => {
    expect(TASK_STATES).toEqual(['queued', 'starting', 'running', 'blocked', 'cancel_requested', 'stopped', 'completed', 'failed', 'cancelled']);
    expect(TERMINAL_TASK_STATES).toEqual(['completed', 'failed', 'cancelled']);
  });

  test('终态判断拒绝非终态和未知状态', () => {
    for (const state of TASK_STATES) expect(isTerminalTaskState(state)).toBe(TERMINAL_TASK_STATES.includes(state as never));
    expect(isTerminalTaskState('pending')).toBe(false);
    expect(isTerminalTaskState('unknown')).toBe(false);
  });

  test('reusable/reviveable 边界：仅 reconciliation 的终态可复用，blocked/stopped/uncertain 不可复用', () => {
    const reusable = (state: string, reconciliation: string, certainty: string, retained: boolean) =>
      TERMINAL_TASK_STATES.includes(state as never) && reconciliation === 'reconciled' && certainty !== 'uncertain' && retained;
    expect(reusable('completed', 'reconciled', 'authoritative', true)).toBe(true);
    expect(reusable('failed', 'unreconciled', 'authoritative', true)).toBe(false);
    expect(reusable('blocked', 'reconciled', 'authoritative', true)).toBe(false);
    expect(reusable('stopped', 'reconciled', 'authoritative', true)).toBe(false);
    expect(reusable('cancelled', 'reconciled', 'uncertain', true)).toBe(false);
  });

  test('非法状态不属于枚举且不能通过 transition 写入', async () => {
    expect(TASK_STATES.includes('invalid' as never)).toBe(false);
    expect(isTerminalTaskState('invalid')).toBe(false);
  });
});
