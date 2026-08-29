import { describe, expect, test } from 'bun:test';
import {
  createCleanupRunner,
  createHostCleanup,
  runOptionalStages,
} from './setup-stages';

describe('runOptionalStages', () => {
  test('同步错误会被报告，并继续执行后续阶段', async () => {
    const completed: string[] = [];
    const reports: Array<{ stage: string; error: unknown }> = [];

    const outcomes = await runOptionalStages(
      [
        { name: 'agents', run: () => { throw new Error('agents failed'); } },
        { name: 'skills', run: () => { completed.push('skills'); } },
      ],
      (stage, error) => reports.push({ stage, error }),
    );

    expect(completed).toEqual(['skills']);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.stage).toBe('agents');
    expect(reports[0]?.error).toBeInstanceOf(Error);
    expect((reports[0]?.error as Error).message).toBe('agents failed');
    expect(outcomes).toEqual([
      { name: 'agents', status: 'failed', error: reports[0]?.error },
      { name: 'skills', status: 'succeeded' },
    ]);
  });

  test('异步错误同样会被报告，且保留原始错误对象', async () => {
    const original = { reason: 'async failure' };
    const reports: Array<{ stage: string; error: unknown }> = [];
    const completed: string[] = [];

    await runOptionalStages(
      [
        { name: 'commands', run: async () => { throw original; } },
        { name: 'tools', run: async () => { completed.push('tools'); } },
      ],
      (stage, error) => reports.push({ stage, error }),
    );

    expect(completed).toEqual(['tools']);
    expect(reports).toEqual([{ stage: 'commands', error: original }]);
  });

  test('reporter 抛错时仍返回失败 outcome，并继续执行后续阶段', async () => {
    const original = new Error('agents failed');
    const completed: string[] = [];

    const outcomes = await runOptionalStages(
      [
        { name: 'agents', run: () => { throw original; } },
        { name: 'skills', run: () => { completed.push('skills'); } },
      ],
      () => { throw new Error('reporter failed'); },
    );

    expect(outcomes[0]).toEqual({ name: 'agents', status: 'failed', error: original });
    expect(completed).toEqual(['skills']);
  });
});

describe('cleanup runners', () => {
  test('按逆序等待 cleanup，并隔离单个 cleanup 错误', async () => {
    const calls: string[] = [];
    const reports: Array<{ stage: string; error: unknown }> = [];
    const runner = createCleanupRunner((stage, error) => reports.push({ stage, error }));

    runner.add('agents', async () => { calls.push('agents'); });
    runner.add('auto-update', async () => {
      calls.push('auto-update');
      throw new Error('update cleanup failed');
    });
    runner.add('hooks', () => { calls.push('hooks'); });

    await runner.run();

    expect(calls).toEqual(['hooks', 'auto-update', 'agents']);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.stage).toBe('auto-update');
    expect((reports[0]?.error as Error).message).toBe('update cleanup failed');
  });

  test('host-facing wrapper 保持同步签名，同时触发异步 cleanup', async () => {
    const calls: string[] = [];
    const runner = createCleanupRunner();
    runner.add('registration', async () => { calls.push('registration'); });
    const cleanup: () => void = createHostCleanup(runner);

    expect(cleanup()).toBeUndefined();
    await runner.done;
    expect(calls).toEqual(['registration']);
  });

  test('cleanup reporter 抛错时仍按逆序完成，run 与 done 均成功', async () => {
    const calls: string[] = [];
    const runner = createCleanupRunner(() => { throw new Error('reporter failed'); });

    const addCleanups = () => {
      runner.add('agents', async () => { calls.push('agents'); });
      runner.add('auto-update', async () => {
        calls.push('auto-update');
        throw new Error('update cleanup failed');
      });
      runner.add('hooks', () => { calls.push('hooks'); });
    };

    addCleanups();
    await runner.run();

    addCleanups();
    const cleanup: () => void = createHostCleanup(runner);
    cleanup();
    await runner.done;

    expect(calls).toEqual(['hooks', 'auto-update', 'agents', 'hooks', 'auto-update', 'agents']);
  });
});
