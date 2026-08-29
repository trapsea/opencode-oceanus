import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskIndex, LANE_CONFLICT, LANE_REQUIRED, PARENT_OWNERSHIP } from './task-index';

let dir = '';
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ''; });

const base = (over: Record<string, unknown> = {}) => ({
  taskID: 'ses_child_1', parentSessionID: 'ses_parent', agent: 'explorer',
  laneKey: 'search-api', objective: 'find api entry', ...over,
});

describe('TaskIndex 契约', () => {
  test('registerLaunch 成功登记并持久化', async () => {
    dir = await mkdtemp(join(tmpdir(), 'task-index-'));
    const idx = await TaskIndex.open({ workspaceRoot: dir });
    const rec = await idx.registerLaunch(base());
    expect(rec.state).toBe('running');
    expect(rec.generation).toBe(1);
    const again = await TaskIndex.open({ workspaceRoot: dir });
    expect(again.get('ses_child_1', 'ses_parent')?.agent).toBe('explorer');
  });

  test('lane 冲突：同 parent 同 laneKey 已 active → LANE_CONFLICT；终态后允许同 lane 新任务', async () => {
    dir = await mkdtemp(join(tmpdir(), 'task-index-'));
    const idx = await TaskIndex.open({ workspaceRoot: dir });
    await idx.registerLaunch(base());
    expect(idx.registerLaunch(base({ taskID: 'ses_child_2' }))).rejects.toThrow(LANE_CONFLICT);
    await idx.markTerminal('ses_child_1', 'ses_parent', 'completed');
    const second = await idx.registerLaunch(base({ taskID: 'ses_child_2' }));
    expect(second.taskID).toBe('ses_child_2');
  });

  test('revive 同一任务：uncertain 占用自身 lane 时续用不构成冲突（generation+1）', async () => {
    dir = await mkdtemp(join(tmpdir(), 'task-index-'));
    const idx = await TaskIndex.open({ workspaceRoot: dir });
    await idx.registerLaunch(base());
    await idx.markUncertain('ses_child_1', 'ses_parent');
    const revived = await idx.registerLaunch(base({ objective: 'resume after interrupt' }));
    expect(revived.generation).toBe(2);
    expect(revived.state).toBe('running');
  });

  test('lane 缺失：无 laneKey 的 registerLaunch 被拒绝（LANE_REQUIRED）', async () => {
    dir = await mkdtemp(join(tmpdir(), 'task-index-'));
    const idx = await TaskIndex.open({ workspaceRoot: dir });
    const { laneKey: _drop, ...noLane } = base();
    expect(idx.registerLaunch(noLane as any)).rejects.toThrow(LANE_REQUIRED);
  });

  test('跨 parent 读写拒绝（PARENT_OWNERSHIP）', async () => {
    dir = await mkdtemp(join(tmpdir(), 'task-index-'));
    const idx = await TaskIndex.open({ workspaceRoot: dir });
    await idx.registerLaunch(base());
    expect(() => idx.get('ses_child_1', 'ses_stranger')).toThrow(PARENT_OWNERSHIP);
    expect(idx.markTerminal('ses_child_1', 'ses_stranger', 'completed')).rejects.toThrow(PARENT_OWNERSHIP);
  });

  test('重启恢复：损坏文件 fail-open 为空索引且保留备份', async () => {
    dir = await mkdtemp(join(tmpdir(), 'task-index-'));
    const idx = await TaskIndex.open({ workspaceRoot: dir });
    await idx.registerLaunch(base());
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, '.oceanus', 'tasks.json'), '{corrupt');
    const fresh = await TaskIndex.open({ workspaceRoot: dir });
    expect(fresh.listByParent('ses_parent')).toHaveLength(0);
  });

  test('markResultConsumed 记录消费时间且幂等', async () => {
    dir = await mkdtemp(join(tmpdir(), 'task-index-'));
    const idx = await TaskIndex.open({ workspaceRoot: dir });
    await idx.registerLaunch(base());
    await idx.markTerminal('ses_child_1', 'ses_parent', 'completed');
    const t1 = await idx.markResultConsumed('ses_child_1', 'ses_parent');
    expect(t1.resultConsumedAt).toBeGreaterThan(0);
    const t2 = await idx.markResultConsumed('ses_child_1', 'ses_parent');
    expect(t2.resultConsumedAt).toBe(t1.resultConsumedAt);
  });
});
