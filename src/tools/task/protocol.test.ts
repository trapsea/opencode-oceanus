import { describe, expect, test } from 'bun:test';
import { validateDelegationBrief, validateBlockedRequest, validateTaskProtocol } from './protocol';

describe('task protocol', () => {
  test('接受带版本、能力与结果契约的 delegation brief', () => {
    const brief = { board_revision: 3, task_version: 2, generation: 1, task_id: 't1', objective: 'build', capabilities: ['read'], result: { status: 'success', summary: 'ok' } };
    expect(validateDelegationBrief(brief)).toEqual([]);
  });

  test('拒绝缺少 capability/result 的 brief', () => {
    expect(validateDelegationBrief({ board_revision: 1, task_version: 1, generation: 0, task_id: 't1', objective: 'x' }).length).toBeGreaterThan(0);
  });

  test('校验 blocked request 与 certainty/reconciliation', () => {
    expect(validateBlockedRequest({ task_id: 't1', reason: 'needs input', requested_capabilities: ['write'] })).toEqual([]);
    expect(validateTaskProtocol({ state: 'blocked', certainty: 'uncertain', reconciliation: 'required' })).toEqual([]);
  });

  test('拒绝负版本、空能力和未知结果状态', () => {
    const errors = validateDelegationBrief({ board_revision: -1, task_version: 1, generation: 1, task_id: 't1', objective: 'x', capabilities: [''], result: { status: 'unknown', summary: '' } });
    expect(errors).toEqual(expect.arrayContaining(['board_revision', 'capabilities', 'result']));
    expect(validateBlockedRequest({ task_id: 't1', reason: '', requested_capabilities: ['write'] })).toEqual(['blocked_request']);
    expect(validateTaskProtocol({ state: 'done', certainty: 'certain', reconciliation: 'complete' })).toContain('state');
  });
});
