import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSetup } from '../index';
import { createTaskCoordinator } from './task-coordinator';
import { TaskIndex } from './task-index';
import type { PluginSetupContext, ToolDefinition } from './types';

const originalCwd = process.cwd();
const json = (x: any) => JSON.parse(x.content);
const tool = (xs: ToolDefinition[], name: string) => xs.find(x => x.name === name)!;

function fakeContext(opts: { sendMessage?: (x: any) => Promise<unknown>; resumeChild?: (x: any) => Promise<unknown> } = {}) {
  const tools: ToolDefinition[] = [], hooks: string[] = [];
  const session: any = {
    sessionID: 'parent-test', id: 'parent-test',
    get: async ({ sessionID }: any) => ({ id: sessionID, location: { directory: process.cwd() }, outcome: sessionID === 'ses_live' ? 'succeeded' : undefined }),
    active: async () => ({ data: {} }), interrupt: async () => ({ interrupted: true }), prompt: async () => {},
    wait: async () => {},
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

describe('生产入口 task harness（coordinator 接线）', () => {
  test('runSetup 注册工具/hooks，工具使用同一 TaskCoordinator', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'oceanus-harness-')); process.chdir(workspace);
    const fake = fakeContext();
    const observed: Array<{ source: string; coordinator: unknown }> = [];
    expect(await runSetup(fake.ctx, { loadConfig: () => ({}) as any,
      taskLifecycleObserver: (source, coordinator) => observed.push({ source, coordinator }),
    })).toBeUndefined();
    expect(observed.map(x => x.source)).toEqual(['supervisor', 'tools', 'hooks']);
    expect(observed[0]?.coordinator).toBe(observed[1]?.coordinator);
    expect(observed[1]?.coordinator).toBe(observed[2]?.coordinator);
    expect(fake.tools.map(x => x.name)).toEqual(expect.arrayContaining(['task_message', 'task_revive', 'task_cancel', 'task_status', 'task_result']));
    expect(fake.tools.map(x => x.name)).not.toContain('task_reuse');
    expect(fake.hooks).toContain('execute.before');
  });

  test('task_status/task_result 经 coordinator 工作：登记→查询→消费', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'oceanus-harness-')); process.chdir(workspace);
    const fake = fakeContext();
    let coordinator: any;
    await runSetup(fake.ctx, { loadConfig: () => ({}) as any,
      taskLifecycleObserver: (_s, c) => { coordinator ??= c; },
    });
    await coordinator.registerLaunch({ taskID: 'ses_live', parentSessionID: 'parent-test', agent: 'explorer', laneKey: 'l1', objective: 'job' });
    await coordinator.markTerminal('ses_live', 'parent-test', 'completed', 'done text');
    const st = json(await tool(fake.tools, 'task_status').execute({ taskId: 'ses_live' }, { sessionID: 'parent-test' }));
    expect(st.status).toBe('completed');
    const rr = json(await tool(fake.tools, 'task_result').execute({ taskId: 'ses_live' }, { sessionID: 'parent-test' }));
    expect(rr.verified).toBe(true);
    // 读取即消费：磁盘上 resultConsumedAt 已写
    const fresh = await TaskIndex.open({ workspaceRoot: workspace });
    expect(fresh.get('ses_live', 'parent-test')?.resultConsumedAt).toBeGreaterThan(0);
  });

  test('task_revive：未消费前拒绝，消费后续用 generation+1', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'oceanus-harness-')); process.chdir(workspace);
    const fake = fakeContext();
    let coordinator: any;
    await runSetup(fake.ctx, { loadConfig: () => ({}) as any,
      taskLifecycleObserver: (_s, c) => { coordinator ??= c; },
    });
    await coordinator.registerLaunch({ taskID: 'ses_live', parentSessionID: 'parent-test', agent: 'explorer', laneKey: 'l1', objective: 'job' });
    await coordinator.markTerminal('ses_live', 'parent-test', 'completed');
    const denied = json(await tool(fake.tools, 'task_revive').execute({ task_id: 'ses_live', prompt: 'next' }, { sessionID: 'parent-test' }));
    expect(denied.error).toBe('RESULT_NOT_CONSUMED');
    await coordinator.markResultConsumed('ses_live', 'parent-test');
    const ok = json(await tool(fake.tools, 'task_revive').execute({ task_id: 'ses_live', prompt: 'next' }, { sessionID: 'parent-test' }));
    expect(ok.ok).toBe(true);
    expect(ok.generation).toBe(2);
  });

  test('task_cancel parent-only：未知任务报错且不创建 session', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'oceanus-harness-')); process.chdir(workspace);
    const fake = fakeContext();
    await runSetup(fake.ctx, { loadConfig: () => ({}) as any });
    const result = json(await tool(fake.tools, 'task_cancel').execute({ taskId: 'missing' }, { sessionID: 'parent-test' }));
    expect(result.error).toBeTruthy();
  });
});
