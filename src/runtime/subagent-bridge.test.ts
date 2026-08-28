import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSubagentBridge } from './subagent-bridge';
import { createTaskCoordinator } from './task-coordinator';
import type { SessionLike } from './types';

let dir = '';
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ''; });

const session = {
  get: async ({ sessionID }: any) => ({ id: sessionID, parentID: 'ses_parent', outcome: sessionID === 'ses_child_1' ? 'succeeded' : undefined }),
} as unknown as SessionLike;

const setup = async () => {
  dir = await mkdtemp(join(tmpdir(), 'bridge-'));
  const coordinator = createTaskCoordinator({ workspaceRoot: dir, session });
  await coordinator.ready();
  return { coordinator, bridge: createSubagentBridge({ coordinator }) };
};

describe('subagent-bridge 契约', () => {
  test('before/after：结构化 lane_key 优先，sessionID 返回即登记，完成后 reconcile 终态', async () => {
    const { coordinator, bridge } = await setup();
    await bridge['execute.before']({
      tool: 'subagent', sessionID: 'ses_parent', id: 'call-1',
      input: { agent: 'explorer', lane_key: 'search-api', description: 'desc lane:decoy', prompt: 'find api entry' },
    });
    await bridge['execute.after']({
      tool: 'subagent', sessionID: 'ses_parent', id: 'call-1', status: 'completed',
      result: { sessionID: 'ses_child_1', content: 'api entry at src/api.ts' },
    });
    // 登记立即可见（同步路径）
    const rec = coordinator.formatBoard('ses_parent');
    expect(rec).toContain('search-api');
    expect(rec).toContain('ses_child_1');
    // after 完成事件 → 宿主 reconcile → completed + resultSummary
    await new Promise((r) => setTimeout(r, 20));
    const [t] = await coordinator.reconcile('ses_parent');
    expect(t.state).toBe('completed');
  });

  test('lane 回退：无结构化字段时从 description 正则提取唯一 lane 标记', async () => {
    const { bridge, coordinator } = await setup();
    await bridge['execute.before']({
      tool: 'subagent', sessionID: 'ses_parent', id: 'call-2',
      input: { agent: 'librarian', description: 'research docs lane:docs-research' },
    });
    await bridge['execute.after']({
      tool: 'subagent', sessionID: 'ses_parent', id: 'call-2', status: 'error',
      result: { sessionID: 'ses_child_2' },
    });
    expect(coordinator.formatBoard('ses_parent')).toContain('docs-research');
  });

  test('fail-open：before/after 任何异常不抛出，未知工具忽略', async () => {
    const { bridge } = await setup();
    await expect(bridge['execute.before']({ tool: 'read', sessionID: 's', id: 'x', input: {} })).resolves.toBeUndefined();
    await expect(bridge['execute.after']({ tool: 'subagent', sessionID: 's', id: 'nope', status: 'completed', result: {} })).resolves.toBeUndefined();
    await expect(bridge['execute.after']({ tool: 'subagent', sessionID: 's', id: 'nope', status: 'completed', result: null as any })).resolves.toBeUndefined();
  });

  test('after 先到（before 未触发）：不登记，不崩溃', async () => {
    const { bridge } = await setup();
    await expect(bridge['execute.after']({
      tool: 'subagent', sessionID: 'ses_parent', id: 'orphan', status: 'completed', result: { sessionID: 'ses_child_9' },
    })).resolves.toBeUndefined();
  });
});
