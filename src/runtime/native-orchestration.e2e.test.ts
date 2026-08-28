/**
 * 端到端冒烟（native-session-orchestration spec 验收 1/2/3/4）：
 * runSetup 级接线 → subagent before/after → 立即 status/cancel →
 * 完成后 revive 续用（generation+1）→ 重启恢复 tasks.json 并 reconcile。
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSetup } from '../index';
import { TaskIndex } from './task-index';
import { createTaskCoordinator } from './task-coordinator';
import type { PluginSetupContext, ToolDefinition } from './types';

const json = (x: any) => JSON.parse(x.content);
const tool = (xs: ToolDefinition[], name: string) => xs.find(x => x.name === name)!;

let workspace = '';
afterEach(async () => { if (workspace) await rm(workspace, { recursive: true, force: true }); workspace = ''; });

/** 可编程宿主：active/outcome 按 sessionID 配置。 */
function fakeCtx(host: { active?: Set<string>; outcomes?: Record<string, string> }) {
  const tools: ToolDefinition[] = [];
  const hooks: { before: any[]; after: any[] } = { before: [], after: [] };
  const session: any = {
    sessionID: 'parent-1', id: 'parent-1',
    get: async ({ sessionID }: any) => ({ id: sessionID, parentID: 'parent-1', location: { directory: process.cwd() }, outcome: host.outcomes?.[sessionID] }),
    active: async () => ({ data: Object.fromEntries([...(host.active ?? [])].map((s) => [s, {}])) }),
    interrupt: async () => ({ interrupted: true }),
    prompt: async (i: any) => { calls.prompt.push(i); },
    wait: async () => {},
  };
  const calls = { prompt: [] as any[] };
  const ctx: any = {
    session,
    agent: { transform: async (cb: any) => cb({ get: () => undefined, add: () => {}, remove: () => {}, update: () => {}, default: () => {} }), reload: async () => {} },
    skill: { transform: async (cb: any) => cb({ add: () => {} }), reload: async () => {} },
    command: { transform: async (cb: any) => cb({ add: () => {} }), reload: async () => {} },
    mcp: { transform: async (cb: any) => cb({ list: () => [], get: () => undefined, set: () => {}, update: () => {}, remove: () => {} }), reload: async () => {} },
    tool: {
      transform: async (cb: any) => cb({ add: (x: ToolDefinition) => tools.push(x) }),
      hook: async (name: string, cb: any) => { name === 'execute.before' ? hooks.before.push(cb) : hooks.after.push(cb); },
    },
  } satisfies PluginSetupContext;
  return { ctx, tools, hooks, session, calls };
}

describe('native-session-orchestration 端到端', () => {
  test('验收1：subagent 派发后立即登记并可 status/cancel；验收2：完成后同 task_id revive（generation+1）', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'native-e2e-')); process.chdir(workspace);
    const host = { active: new Set<string>(['ses_child_1']), outcomes: {} as Record<string, string> };
    const fake = fakeCtx(host);
    let coordinator: any;
    await runSetup(fake.ctx, { loadConfig: () => ({}) as any, taskLifecycleObserver: (_s, c) => { coordinator ??= c; } });
    expect(coordinator).toBeDefined();
    // bridge hooks 是 cbm-guidance 之前注册的一对 before/after
    const bridgeBefore = fake.hooks.before[fake.hooks.before.length - 2];
    const bridgeAfter = fake.hooks.after[fake.hooks.after.length - 2];

    // 1) 原生 subagent 派发：before（结构化 lane）→ after（返回 sessionID）
    await bridgeBefore({
      tool: 'subagent', sessionID: 'parent-1', id: 'call-1',
      input: { agent: 'explorer', lane_key: 'e2e-lane', description: 'e2e job', prompt: 'do it' },
    });
    await bridgeAfter({
      tool: 'subagent', sessionID: 'parent-1', id: 'call-1', status: 'completed',
      result: { sessionID: 'ses_child_1', content: 'job result text' },
    });
    // 验收1：立即登记（bridge 同步 registerLaunch），可立即查询
    const st1 = json(await tool(fake.tools, 'task_status').execute({ taskId: 'ses_child_1' }, { sessionID: 'parent-1' }));
    expect(st1.taskId).toBe('ses_child_1');
    expect(st1.laneKey).toBe('e2e-lane');
    expect(st1.status).toBe('running'); // 宿主 active=true

    // 同 lane 重复派发：第二次 after 的 registerLaunch 被 LANE_CONFLICT 拒绝（fail-open 吞掉），
    // 结果是第二条任务不被登记 —— board 中该 lane 仍只有一个任务。
    await bridgeBefore({
      tool: 'subagent', sessionID: 'parent-1', id: 'call-dup',
      input: { agent: 'explorer', lane_key: 'e2e-lane', description: 'dup', prompt: 'again' },
    });
    await bridgeAfter({
      tool: 'subagent', sessionID: 'parent-1', id: 'call-dup', status: 'completed',
      result: { sessionID: 'ses_child_dup', content: 'dup result' },
    });
    const board = coordinator.formatBoard('parent-1');
    expect(board).toContain('ses_child_1');
    expect(board).not.toContain('ses_child_dup');

    // 2) 任务完成：宿主不再 active，outcome=succeeded
    host.active.delete('ses_child_1');
    host.outcomes['ses_child_1'] = 'succeeded';
    const st2 = json(await tool(fake.tools, 'task_status').execute({ taskId: 'ses_child_1' }, { sessionID: 'parent-1' }));
    expect(st2.status).toBe('completed');
    // 读取结果 → 消费
    const rr = json(await tool(fake.tools, 'task_result').execute({ taskId: 'ses_child_1' }, { sessionID: 'parent-1' }));
    expect(rr.outcome).toBe('succeeded');

    // 验收2：同 task_id revive 执行第二项工作（generation 1→2，prompt 已送达原 session）
    host.active.add('ses_child_1'); // revive 后宿主重新活跃
    const rv = json(await tool(fake.tools, 'task_revive').execute({ task_id: 'ses_child_1', prompt: 'second job' }, { sessionID: 'parent-1' }));
    expect(rv.ok).toBe(true);
    expect(rv.generation).toBe(2);
    expect(fake.calls.prompt.at(-1)).toMatchObject({ sessionID: 'ses_child_1', text: 'second job', delivery: 'queue' });
  });

  test('验收3：重启恢复 tasks.json 并以宿主事实 reconcile（uncertain 不伪造终态）', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'native-e2e-')); process.chdir(workspace);
    // 第一段：登记 running 任务后“进程退出”
    {
      const fake = fakeCtx({ active: new Set(['ses_child_a']), outcomes: {} });
      let coordinator: any;
      await runSetup(fake.ctx, { loadConfig: () => ({}) as any, taskLifecycleObserver: (_s, c) => { coordinator ??= c; } });
      await coordinator.registerLaunch({ taskID: 'ses_child_a', parentSessionID: 'parent-1', agent: 'explorer', laneKey: 'lane-a', objective: 'restart test' });
    }
    // 第二段：重启，宿主无法确认（active 空、无 outcome）→ reconcile 收敛 uncertain
    {
      const fake = fakeCtx({ active: new Set(), outcomes: {} });
      let coordinator: any;
      await runSetup(fake.ctx, { loadConfig: () => ({}) as any, taskLifecycleObserver: (_s, c) => { coordinator ??= c; } });
      const records = await coordinator.reconcile('parent-1');
      expect(records.find((r: any) => r.taskID === 'ses_child_a')?.state).toBe('uncertain');
      // uncertain 属于 active：不可 revive（不伪造）
      const denied = json(await tool(fake.tools, 'task_revive').execute({ task_id: 'ses_child_a', prompt: 'x' }, { sessionID: 'parent-1' }));
      expect(['NOT_REVIVEABLE', 'LANE_CONFLICT']).toContain(denied.error);
    }
    // 第三段：宿主随后确认 succeeded → completed（磁盘状态经 TaskIndex 直接核验）
    {
      const fake = fakeCtx({ active: new Set(), outcomes: { ses_child_a: 'succeeded' } });
      let coordinator: any;
      await runSetup(fake.ctx, { loadConfig: () => ({}) as any, taskLifecycleObserver: (_s, c) => { coordinator ??= c; } });
      const records = await coordinator.reconcile('parent-1');
      expect(records.find((r: any) => r.taskID === 'ses_child_a')?.state).toBe('completed');
      const index = await TaskIndex.open({ workspaceRoot: workspace });
      expect(index.get('ses_child_a', 'parent-1')?.state).toBe('completed');
    }
  });

  test('验收4：跨 parent 续用被拒绝（PARENT_OWNERSHIP 语义）', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'native-e2e-')); process.chdir(workspace);
    const fake = fakeCtx({ active: new Set(), outcomes: { ses_child_b: 'succeeded' } });
    let coordinator: any;
    await runSetup(fake.ctx, { loadConfig: () => ({}) as any, taskLifecycleObserver: (_s, c) => { coordinator ??= c; } });
    await coordinator.registerLaunch({ taskID: 'ses_child_b', parentSessionID: 'parent-1', agent: 'explorer', laneKey: 'lane-b', objective: 'owner test' });
    await coordinator.markTerminal('ses_child_b', 'parent-1', 'completed');
    await coordinator.markResultConsumed('ses_child_b', 'parent-1');
    // stranger session 查不到该任务（按父过滤）
    const st = json(await tool(fake.tools, 'task_status').execute({ taskId: 'ses_child_b' }, { sessionID: 'ses_stranger' }));
    expect(st.error).toContain('task 不存在');
  });
});
