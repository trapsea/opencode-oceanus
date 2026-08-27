import { describe, expect, test } from 'bun:test';
import { bridgeJobBoardToLedger } from './ledger-bridge';

const board = (state = 'running', generation = 2) => ({ task_id: 't1', state, generation, agent: 'fixer', child_session_id: 's1', runtime_summary: 'ok', verification_evidence: ['bun test'], blocker: undefined });

describe('Job Board → progress ledger bridge', () => {
  test('只写运行态摘要，不覆盖计划字段', () => {
    const result = bridgeJobBoardToLedger({ tasks: [{ taskId: 't1', state: 'completed', files: ['a.ts'] }] }, [board()]);
    expect(result.ledger.tasks[0]).toMatchObject({ taskId: 't1', state: 'completed', files: ['a.ts'], runtime: { state: 'running', worker: 'fixer', session: 's1' } });
  });
  test('缺失与旧 generation 返回明确诊断且不写入', () => {
    const result = bridgeJobBoardToLedger({ tasks: [{ taskId: 't1', state: 'pending' }, { taskId: 't2', state: 'pending' }] }, [board('running', 2)], { t1: 1 });
    expect(result.diagnostics.map(x => x.code)).toEqual(expect.arrayContaining(['stale_generation', 'missing_job_board_task']));
    expect(result.ledger.tasks[0]).not.toHaveProperty('runtime');
  });
});
