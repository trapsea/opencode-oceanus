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

/**
 * fake SessionDomain：真实宿主的 ctx.session 是 API 域对象，不含
 * sessionID/id 属性。这里用陷阱 getter 模拟「属性不存在」：返回空串
 * （生产中 String(undefined ?? '') 的结果），任何读取都会被记录，
 * 供断言锁定 setup 绝不从 SessionDomain 读取伪造会话身份。
 */
function fakeContext(opts: {
  sendMessage?: (x: any) => Promise<unknown>;
  resumeChild?: (x: any) => Promise<unknown>;
  outcomes?: Record<string, string>;
} = {}) {
  const tools: ToolDefinition[] = [], hooks: string[] = [];
  const sessionIdentityReads: string[] = [];
  const getCalls: Array<{ sessionID: string }> = [];
  const session: any = {
    get sessionID() { sessionIdentityReads.push('sessionID'); return ''; },
    get id() { sessionIdentityReads.push('id'); return ''; },
    get: async ({ sessionID }: any) => {
      getCalls.push({ sessionID });
      return { id: sessionID, location: { directory: process.cwd() }, outcome: opts.outcomes?.[sessionID] ?? (sessionID === 'ses_live' ? 'succeeded' : undefined) };
    },
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
  return { ctx, tools, hooks, sessionIdentityReads, getCalls };
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
    // Wave 2A 契约：setup 不从 SessionDomain 读取 sessionID/id（伪造会话身份）。
    expect(fake.sessionIdentityReads).toEqual([]);
    expect(fake.tools.map(x => x.name)).toEqual(expect.arrayContaining(['task_message', 'task_revive', 'task_cancel', 'task_status', 'task_result']));
    expect(fake.tools.map(x => x.name)).not.toContain('task_reuse');
    expect(fake.hooks).toContain('execute.before');
  });

  test('setup 不以空/伪造 parentSessionID eager reconcile（磁盘遗留记录不被篡改）', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'oceanus-harness-')); process.chdir(workspace);
    // 预置历史遗留记录：parentSessionID 为空串（伪造 parent 的典型产物），状态 uncertain。
    const seed = await TaskIndex.open({ workspaceRoot: workspace });
    await seed.registerLaunch({ taskID: 'ses_ghost', parentSessionID: '', agent: 'explorer', laneKey: 'ghost-lane', objective: 'ghost task' });
    await seed.markUncertain('ses_ghost', '');
    // 宿主对该子会话可确认 succeeded：若 setup 仍以空 parentSessionID eager
    // reconcile，这条记录会被立即收敛为 completed（磁盘可观测）。
    const fake = fakeContext({ outcomes: { ses_ghost: 'succeeded' } });
    let coordinator: any;
    await runSetup(fake.ctx, {
      loadConfig: () => ({}) as any,
      taskLifecycleObserver: (_s, c) => { coordinator ??= c; },
    });
    expect(coordinator).toBeDefined();
    // coordinator 的 TaskIndex 根必须是插件目录（此处 chdir 后 = workspace）：
    // 能看到预置记录，证明与 seed 同一存储。
    expect(coordinator.listTasks('')).toHaveLength(1);
    // setup 全程不读取 SessionDomain 会话身份。
    expect(fake.sessionIdentityReads).toEqual([]);
    // 磁盘状态未被 setup 篡改：仍 uncertain，恢复收敛只能由真实 sessionID 驱动。
    const fresh = await TaskIndex.open({ workspaceRoot: workspace });
    expect(fresh.get('ses_ghost', '')?.state).toBe('uncertain');
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
    // 内容回传：bridge/revive 留存的 resultSummary 以 output 字段随 task_result 返回
    expect(rr.output).toBe('done text');
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

  test('task_revive 内容通道：宿主 session.context 的最后 assistant 输出随结果回传', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'oceanus-harness-')); process.chdir(workspace);
    const fake = fakeContext();
    // 宿主暴露 session.context（官方 SessionContext 标准 API）
    (fake.ctx.session as any).context = async () => [
      { role: 'user', parts: [{ type: 'text', text: '复核请求' }] },
      { role: 'assistant', parts: [{ type: 'text', text: '复核结论：OKAY' }] },
    ];
    let coordinator: any;
    await runSetup(fake.ctx, { loadConfig: () => ({}) as any,
      taskLifecycleObserver: (_s, c) => { coordinator ??= c; },
    });
    await coordinator.registerLaunch({ taskID: 'ses_live', parentSessionID: 'parent-test', agent: 'momus', laneKey: 'l1', objective: 'gate' });
    await coordinator.markTerminal('ses_live', 'parent-test', 'completed');
    await coordinator.markResultConsumed('ses_live', 'parent-test');
    const ok = json(await tool(fake.tools, 'task_revive').execute({ task_id: 'ses_live', prompt: '再复核' }, { sessionID: 'parent-test' }));
    expect(ok.ok).toBe(true);
    expect(ok.output).toBe('复核结论：OKAY');
    // summary 已留存：后续 task_result（消费前）也能回放同一内容
    const rr = json(await tool(fake.tools, 'task_result').execute({ taskId: 'ses_live' }, { sessionID: 'parent-test' }));
    expect(rr.output).toBe('复核结论：OKAY');
  });

  test('task_result 兜底内容：resultSummary 缺失时从 session.context 读取', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'oceanus-harness-')); process.chdir(workspace);
    const fake = fakeContext();
    (fake.ctx.session as any).context = async ({ sessionID }: any) =>
      sessionID === 'ses_nosum' ? [{ role: 'assistant', text: '兜底内容' }] : [];
    let coordinator: any;
    await runSetup(fake.ctx, { loadConfig: () => ({}) as any,
      taskLifecycleObserver: (_s, c) => { coordinator ??= c; },
    });
    // 模拟 bridge 未捕获内容的后台任务：终态但无 resultSummary
    await coordinator.registerLaunch({ taskID: 'ses_nosum', parentSessionID: 'parent-test', agent: 'explorer', laneKey: 'l1', objective: 'job' });
    await coordinator.markTerminal('ses_nosum', 'parent-test', 'completed');
    const rr = json(await tool(fake.tools, 'task_result').execute({ taskId: 'ses_nosum' }, { sessionID: 'parent-test' }));
    expect(rr.output).toBe('兜底内容');
    // 兜底内容已回写 summary，二次读取仍可回放
    const rr2 = json(await tool(fake.tools, 'task_result').execute({ taskId: 'ses_nosum' }, { sessionID: 'parent-test' }));
    expect(rr2.output).toBe('兜底内容');
  });

  test('task_cancel parent-only：未知任务报错且不创建 session', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'oceanus-harness-')); process.chdir(workspace);
    const fake = fakeContext();
    await runSetup(fake.ctx, { loadConfig: () => ({}) as any });
    const result = json(await tool(fake.tools, 'task_cancel').execute({ taskId: 'missing' }, { sessionID: 'parent-test' }));
    expect(result.error).toBeTruthy();
  });
});
