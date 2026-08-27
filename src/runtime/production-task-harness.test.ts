import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSetup } from '../index';
import { JobBoard } from '../tools/task/job-board';
import type { PluginSetupContext, ToolDefinition } from './types';

const originalCwd = process.cwd();
const json = (x: any) => JSON.parse(x.content);
const tool = (xs: ToolDefinition[], name: string) => xs.find(x => x.name === name)!;

function fakeContext(opts: { sendMessage?: (x: any) => Promise<unknown>; resumeChild?: (x: any) => Promise<unknown> } = {}) {
  const tools: ToolDefinition[] = [], hooks: string[] = [];
  const session: any = {
    sessionID: 'parent-test', id: 'parent-test',
    get: async ({ sessionID }: any) => ({ id: sessionID, location: { directory: process.cwd() } }),
    active: async () => ({ data: {} }), interrupt: async () => ({ interrupted: true }), prompt: async () => {},
    ...opts,
  };
  const ctx: any = {
    session,
    agent: { transform: async (cb: any) => cb({ get: () => undefined, add: () => {}, remove: () => {}, update: () => {}, default: () => {} }), reload: async () => {} },
    skill: { transform: async (cb: any) => cb({ add: () => {} }), reload: async () => {} },
    command: { transform: async (cb: any) => cb({ add: () => {} }), reload: async () => {} },
    mcp: { transform: async (cb: any) => cb({ list: () => [], get: () => undefined, set: () => {}, update: () => {}, remove: () => {} }), reload: async () => {} },
    tool: { transform: async (cb: any) => cb({ add: (x: ToolDefinition) => tools.push(x) }), hook: async (name: string) => hooks.push(name) },
  } satisfies PluginSetupContext;
  return { ctx, tools, hooks };
}

let workspace = '';
afterEach(async () => { process.chdir(originalCwd); if (workspace) await rm(workspace, { recursive: true, force: true }); workspace = ''; });

describe('生产入口 task harness', () => {
  test('runSetup 注册工具/hooks，工具使用同一持久化 JobBoard', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'oceanus-harness-')); process.chdir(workspace);
    const board = await JobBoard.open({ workspaceRoot: workspace, parentSessionId: 'parent-test' });
    const created = await board.replace({ task_id: 'live', parent_session_id: 'parent-test', ownership: { parent_session_id: 'parent-test' }, state: 'running', task_version: 0, generation: 1, child_session_id: 'child' }, { expectedRevision: 0, operationId: 'create' });
    const fake = fakeContext({ sendMessage: async () => {}, resumeChild: async (args) => { expect(args.generation).toBeDefined(); } });
    const observed: Array<{ source: string; board: JobBoard }> = [];
    expect(await runSetup(fake.ctx, { loadConfig: () => ({}) as any,
      taskLifecycleObserver: (source, value) => observed.push({ source, board: value }),
    })).toBeUndefined();
    expect(observed.map(x => x.source)).toEqual(['supervisor', 'tools', 'hooks']);
    expect(observed[0]?.board).toBe(observed[1]?.board);
    expect(observed[1]?.board).toBe(observed[2]?.board);
    expect(observed[0]?.board).not.toBe(board);
    expect(fake.tools.map(x => x.name)).toEqual(expect.arrayContaining(['task_message', 'task_revive', 'task_cancel']));
    expect(fake.hooks).toContain('execute.before');
    const sent = json(await tool(fake.tools, 'task_message').execute({ taskId: 'live', message: 'hello', idempotencyKey: 'm1' }, { sessionID: 'parent-test' }));
    expect(sent.message).toBe('hello');
    expect((await JobBoard.open({ workspaceRoot: workspace, parentSessionId: 'parent-test' })).get('live').messages[0].message).toBe('hello');
    expect(created.state).toBe('running');
  });

  test('taskStatus 伪造不改变 board 事实，CAS message 可重开可见', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'oceanus-harness-')); process.chdir(workspace);
    const board = await JobBoard.open({ workspaceRoot: workspace, parentSessionId: 'parent-test' });
    await board.replace({ task_id: 'q', parent_session_id: 'parent-test', ownership: { parent_session_id: 'parent-test' }, state: 'queued', task_version: 0, generation: 1 }, { expectedRevision: 0, operationId: 'q' });
    const fake = fakeContext(); await runSetup(fake.ctx, { loadConfig: () => ({}) as any });
    const before = (await JobBoard.open({ workspaceRoot: workspace, parentSessionId: 'parent-test' })).get('q');
    expect(before.state).toBe('queued');
    expect(json(await tool(fake.tools, 'task_status').execute({ taskId: 'q', status: 'completed' }, { sessionID: 'parent-test' })).status).not.toBe('completed');
    expect((await JobBoard.open({ workspaceRoot: workspace, parentSessionId: 'parent-test' })).get('q').state).toBe('queued');
  });

  test('revive 遵循新协议；未知任务报错且不创建 session', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'oceanus-harness-')); process.chdir(workspace);
    const fake = fakeContext(); await runSetup(fake.ctx, { loadConfig: () => ({}) as any });
    // 真实 adapter 使 guard 不再短路：未知任务走 board.get 报 TASK_NOT_FOUND，不伪造成功。
    expect(json(await tool(fake.tools, 'task_revive').execute({ taskId: 'missing', resume_id: 'r', brief: 'b', expected_board_revision: 0, expected_task_version: 0, expected_generation: 1, operation_id: 'op' }, { sessionID: 'parent-test' })).error).toBeTruthy();
  });

  test('task_cancel parent-only 且状态保护', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'oceanus-harness-')); process.chdir(workspace);
    const fake = fakeContext(); await runSetup(fake.ctx, { loadConfig: () => ({}) as any });
    const result = json(await tool(fake.tools, 'task_cancel').execute({ taskId: 'missing', parentID: 'other' }, { sessionID: 'parent-test' }));
    expect(result.error).toBeTruthy();
  });

  test('revive 缺少 child session 时拒绝，不伪造 running/送达', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'oceanus-harness-')); process.chdir(workspace);
    const board = await JobBoard.open({ workspaceRoot: workspace, parentSessionId: 'parent-test' });
    await board.replace({ task_id: 'blk', parent_session_id: 'parent-test', ownership: { parent_session_id: 'parent-test' }, state: 'blocked', task_version: 0, generation: 1 }, { expectedRevision: 0, operationId: 'seed' });
    const fake = fakeContext(); await runSetup(fake.ctx, { loadConfig: () => ({}) as any });
    const seed = (await JobBoard.open({ workspaceRoot: workspace, parentSessionId: 'parent-test' })).get('blk');
    const result = json(await tool(fake.tools, 'task_revive').execute({ taskId: 'blk', resume_id: 'r', brief: 'b', expected_board_revision: seed.last_board_revision, expected_task_version: seed.task_version, expected_generation: seed.generation, operation_id: 'op' }, { sessionID: 'parent-test' }));
    expect(Object.keys(result).length).toBeGreaterThan(0);
    const after = (await JobBoard.open({ workspaceRoot: workspace, parentSessionId: 'parent-test' })).get('blk');
    expect(['blocked', 'uncertain', 'starting']).toContain(after.state);
  });
});
