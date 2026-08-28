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
  test('before/after：结构化 lane_key 优先，宿主真实形状（content 文本含 sessionID）即登记，完成后 reconcile 终态', async () => {
    const { coordinator, bridge } = await setup();
    await bridge['execute.before']({
      tool: 'subagent', sessionID: 'ses_parent', id: 'call-1',
      input: { agent: 'explorer', lane_key: 'search-api', description: 'desc lane:decoy', prompt: 'find api entry' },
    });
    // 宿主 V2 Tool.Result 无 sessionID 字段：真实形状为 content 文本内嵌 sessionID。
    await bridge['execute.after']({
      tool: 'subagent', sessionID: 'ses_parent', id: 'call-1', status: 'completed',
      result: { content: 'The subagent is working in the background (sessionID: ses_child_1). You will be notified automatically when it finishes.' },
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

  test('提取链①：result.sessionID 直传（向后兼容）仍可登记', async () => {
    const { bridge, coordinator } = await setup();
    await bridge['execute.before']({
      tool: 'subagent', sessionID: 'ses_parent', id: 'call-direct',
      input: { agent: 'librarian', lane_key: 'direct-lane', description: 'direct sessionID' },
    });
    await bridge['execute.after']({
      tool: 'subagent', sessionID: 'ses_parent', id: 'call-direct', status: 'completed',
      result: { sessionID: 'ses_child_direct', content: 'done' },
    });
    expect(coordinator.formatBoard('ses_parent')).toContain('ses_child_direct');
  });

  test('提取链②：result.metadata.sessionID 提取', async () => {
    const { bridge, coordinator } = await setup();
    await bridge['execute.before']({
      tool: 'subagent', sessionID: 'ses_parent', id: 'call-meta',
      input: { agent: 'fixer', lane_key: 'meta-lane', description: 'metadata id' },
    });
    await bridge['execute.after']({
      tool: 'subagent', sessionID: 'ses_parent', id: 'call-meta', status: 'completed',
      result: { metadata: { sessionID: 'ses_child_meta' }, content: 'ok' },
    });
    expect(coordinator.formatBoard('ses_parent')).toContain('ses_child_meta');
  });

  test('提取链③：task_id: 文本标记（宿主文档格式）', async () => {
    const { bridge, coordinator } = await setup();
    await bridge['execute.before']({
      tool: 'subagent', sessionID: 'ses_parent', id: 'call-tid',
      input: { agent: 'oracle', lane_key: 'tid-lane', description: 'task_id marker' },
    });
    await bridge['execute.after']({
      tool: 'subagent', sessionID: 'ses_parent', id: 'call-tid', status: 'completed',
      result: { content: 'task_id: ses_child_tid (for polling this task with task_status)\nstate: running' },
    });
    expect(coordinator.formatBoard('ses_parent')).toContain('ses_child_tid');
  });

  test('提取链③：前台 XML 形态 sessionID="ses_x" 与 Content[] 数组文本', async () => {
    const { bridge, coordinator } = await setup();
    await bridge['execute.before']({
      tool: 'subagent', sessionID: 'ses_parent', id: 'call-xml',
      input: { agent: 'observer', lane_key: 'xml-lane', description: 'xml/array shapes' },
    });
    await bridge['execute.after']({
      tool: 'subagent', sessionID: 'ses_parent', id: 'call-xml', status: 'completed',
      result: { content: [{ type: 'text', text: '<subagent sessionID="ses_child_xml" state="completed">' }, { type: 'text', text: 'report body' }] },
    });
    expect(coordinator.formatBoard('ses_parent')).toContain('ses_child_xml');
  });

  test('无法提取：无任何 session ID 线索 → 不登记、不抛错', async () => {
    const { bridge, coordinator } = await setup();
    await bridge['execute.before']({
      tool: 'subagent', sessionID: 'ses_parent', id: 'call-none',
      input: { agent: 'explorer', description: 'no id' },
    });
    await bridge['execute.after']({
      tool: 'subagent', sessionID: 'ses_parent', id: 'call-none', status: 'completed',
      result: { content: 'plain result without any id' },
    });
    expect(coordinator.formatBoard('ses_parent')).toBeUndefined();
  });

  test('防御：文本中仅出现 parent 自身 ID → 不登记', async () => {
    const { bridge, coordinator } = await setup();
    await bridge['execute.before']({
      tool: 'subagent', sessionID: 'ses_parent', id: 'call-self',
      input: { agent: 'explorer', description: 'self id only' },
    });
    await bridge['execute.after']({
      tool: 'subagent', sessionID: 'ses_parent', id: 'call-self', status: 'completed',
      result: { content: 'echo from session ses_parent itself' },
    });
    expect(coordinator.formatBoard('ses_parent')).toBeUndefined();
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
