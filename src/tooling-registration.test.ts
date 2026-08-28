import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerOceanusTools } from './tools';
import { registerOceanusHooks } from './hooks';
import type { PluginConfig } from './config/schema';
import {
  resolveWorkspaceRoot,
  sessionActive,
  interruptSession,
} from './runtime/workspace';
import { JSON_ERROR_REMINDER_MARKER } from './hooks/json-error-recovery';
import { TRUNCATION_MARKER_PREFIX } from './hooks/tool-output-truncator';
import type {
  SessionInfoLike,
  SessionLike,
  ToolDefinition,
  ToolingContext,
} from './runtime/types';
import type { IndexerHandle } from './cbm/indexer';
import { CBM_TOOLS } from './cbm/registry';

// ─────────────────────────── 测试辅助 ───────────────────────────

interface MockOverrides {
  root?: string;
  get?: SessionInfoLike;
  active?: Record<string, unknown>;
  /** interrupt 返回 {interrupted}；缺省 true。 */
  interrupt?: boolean;
  /** 使 interrupt 返回 void（undefined），模拟官方宿主。 */
  interruptVoid?: boolean;
  /** 使 interrupt 抛错。 */
  interruptThrows?: boolean;
  /** 使 get 抛错（模拟宿主不可用）。 */
  getThrows?: boolean;
}

function createMockCtx(overrides: MockOverrides = {}) {
  const root = overrides.root ?? '/ws';
  const getInfo: SessionInfoLike = overrides.get ?? {
    id: 's1',
    projectID: 'p1',
    location: { directory: root },
  };
  const activeMap: Record<string, unknown> = overrides.active ?? {};
  const addedTools: ToolDefinition[] = [];
  const beforeHooks: Array<(e: any) => Promise<void> | void> = [];
  const afterHooks: Array<(e: any) => Promise<void> | void> = [];
  const interruptCalls: Array<{ sessionID: string; continue?: boolean }> = [];

  const session: SessionLike = {
    get: async ({ sessionID }) => {
      if (overrides.getThrows) throw new Error('host get unavailable');
      return { ...getInfo, id: sessionID };
    },
    active: async () => ({ data: activeMap }),
    interrupt: async (input) => {
      interruptCalls.push(input);
      if (overrides.interruptThrows) throw new Error('host interrupt unavailable');
      if (overrides.interruptVoid) return undefined;
      return { interrupted: overrides.interrupt ?? true };
    },
  };

  const ctx: ToolingContext = {
    tool: {
      transform: async (cb) => {
        cb({ add: (t) => addedTools.push(t) });
      },
      hook: async (name, cb) => {
        if (name === 'execute.before') beforeHooks.push(cb as any);
        else if (name === 'execute.after') afterHooks.push(cb as any);
      },
    },
    session,
  };
  return { ctx, addedTools, beforeHooks, afterHooks, session, root, interruptCalls };
}

function findTool(added: ToolDefinition[], name: string): ToolDefinition {
  const t = added.find((x) => x.name === name);
  expect(t, `tool ${name} 已注册`).toBeDefined();
  return t!;
}

function parsed(result: { content?: unknown }): any {
  expect(typeof result.content).toBe('string');
  return JSON.parse(result.content as string);
}

afterEach(() => {
});

// ─────────────────────────── Tool 注册 ───────────────────────────

describe('Tool transform 注册', () => {
  test('registersOptionalFileOperationSchema：hashline 注册可选文件操作 schema', async () => {
    const { ctx, addedTools } = createMockCtx();
    await registerOceanusTools(ctx, {});
    const tool = findTool(addedTools, 'hashline_edit');
    const input = tool.input as any;
    expect(input.properties.delete).toMatchObject({ type: 'boolean' });
    expect(input.properties.rename).toMatchObject({ type: 'string' });
  });

  test('默认注册全部 15 个新增工具（8 常规 + 7 CBM 兜底）', async () => {
    const { ctx, addedTools } = createMockCtx();
    await registerOceanusTools(ctx, {});
    const names = addedTools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'ast_grep_replace',
        'ast_grep_search',
        'hashline_edit',
        'task_cancel',
        'task_result',
         'task_status',
         'task_message',
          'task_revive',
        ...CBM_TOOLS,
      ].sort(),
    );
  });

  test('disabled_tools 从注册中移除对应工具', async () => {
    const config: PluginConfig = { disabled_tools: ['task_status', 'ast_grep_search'] };
    const { ctx, addedTools } = createMockCtx();
    await registerOceanusTools(ctx, config);
    const names = addedTools.map((t) => t.name);
    expect(names).not.toContain('task_status');
    expect(names).not.toContain('ast_grep_search');
    expect(names).toContain('hashline_edit');
  });

  test('单项 enabled:false 等价于禁用', async () => {
    const config: PluginConfig = { tools: { hashline_edit: { enabled: false } } };
    const { ctx, addedTools } = createMockCtx();
    await registerOceanusTools(ctx, config);
    expect(addedTools.map((t) => t.name)).not.toContain('hashline_edit');
  });

  test('disabled_tools 优先于 item.enabled=true', async () => {
    const config: PluginConfig = {
      disabled_tools: ['task_cancel'],
      tools: { task_cancel: { enabled: true } },
    };
    const { ctx, addedTools } = createMockCtx();
    await registerOceanusTools(ctx, config);
    expect(addedTools.map((t) => t.name)).not.toContain('task_cancel');
  });

  test('T7 task_message/task_revive 已注册且可执行，错误 ID fail-open', async () => {
    const { ctx, addedTools } = createMockCtx();
    await registerOceanusTools(ctx, {});
    const message = findTool(addedTools, 'task_message');
    const revive = findTool(addedTools, 'task_revive');
    expect(message).toBeDefined();
    expect(revive).toBeDefined();
    expect(JSON.parse((await message!.execute({}, { sessionID: 'parent' })).content as string).errorCode).toBe('UNSUPPORTED');
    expect(JSON.parse((await revive!.execute({ taskId: 'missing' }, { sessionID: 'parent' })).content as string).errorCode).toBe('UNSUPPORTED');
  });
});

// ─────────────────────────── Hook 注册顺序 ───────────────────────────

describe('Hook 注册与固定顺序', () => {
  test('before 注册 apply-patch→loop-guard→observer→cbm-guidance；after 按 json→truncator→loop-guard→observer→cbm-guidance', async () => {
    const { ctx, beforeHooks, afterHooks } = createMockCtx();
    await registerOceanusHooks(ctx, {});
    expect(beforeHooks.length).toBe(3);
    expect(afterHooks.length).toBe(5);
  });

  test('disabled_hooks / enabled:false 跳过对应 Hook', async () => {
    const config: PluginConfig = {
      disabled_hooks: ['apply_patch', 'tool_output_truncator'],
      hooks: { json_error_recovery: { enabled: false } },
    };
    const { ctx, beforeHooks, afterHooks } = createMockCtx();
    await registerOceanusHooks(ctx, config);
    // apply_patch 被禁用 → before 只剩 loop-guard + cbm-guidance
    expect(beforeHooks.length).toBe(2);
    // json 被禁用 + truncator 被禁用 → after 只剩 enhancer + loop-guard + cbm-guidance
    expect(afterHooks.length).toBe(3);
  });

  test('cbm-guidance 尊重 codebaseMemory.guidance=false：不注册', async () => {
    const config: PluginConfig = { codebaseMemory: { guidance: false } };
    const { ctx, beforeHooks, afterHooks } = createMockCtx();
    await registerOceanusHooks(ctx, config);
    expect(beforeHooks.length).toBe(2); // apply_patch + loop-guard
    expect(afterHooks.length).toBe(4); // json + enhancer + truncator + loop-guard
  });

  test('cbm-guidance 可经 hooks.cbm_guidance.enabled=false 关闭', async () => {
    const config: PluginConfig = { hooks: { cbm_guidance: { enabled: false } } };
    const { ctx, beforeHooks, afterHooks } = createMockCtx();
    await registerOceanusHooks(ctx, config);
    expect(beforeHooks.length).toBe(2);
    expect(afterHooks.length).toBe(4);
  });

  test('cbm-guidance 注入 indexer 后生效：结构化查询前检查索引（fail-open）', async () => {
    const ensureIndexedCalls: string[] = [];
    const indexer: IndexerHandle = {
      ensureIndexed: async (projectPath, opts) => {
        ensureIndexedCalls.push(projectPath ?? String(opts.workspaceRoot));
        return { kind: 'indexed' };
      },
      isIndexed: () => true,
      isIndexing: () => false,
      getLastOutcome: () => undefined,
      reset: () => {},
    };
    const { ctx, beforeHooks, afterHooks } = createMockCtx({ root: '/ws' });
    await registerOceanusHooks(ctx, {}, { indexer });
    // cbm-guidance 是最后一个 before hook。
    const cbmBefore = beforeHooks[beforeHooks.length - 1];
    await cbmBefore!({ tool: 'cbm_search_graph', sessionID: 's1' });
    expect(ensureIndexedCalls).toEqual(['/ws']);
    expect(afterHooks.length).toBe(5);
  });
});

// ─────────────────────────── apply-patch（before，v2 event.input） ───────────────────────────

describe('apply-patch execute.before', () => {
  function validPatch(): string {
    return [
      '*** Begin Patch',
      '*** Update File: src/foo.ts',
      '@@',
      '-let a = 1;',
      '+let a = 2;',
      '*** End Patch',
    ].join('\r\n');
  }

  test('改写 event.input.patchText（CRLF→LF 保守规范化）', async () => {
    const { ctx, beforeHooks } = createMockCtx();
    await registerOceanusHooks(ctx, {});
    const input: Record<string, unknown> = { patchText: validPatch() };
    const event = { tool: 'apply_patch', sessionID: 's1', input };
    await beforeHooks[0]!(event);
    expect(typeof event.input.patchText).toBe('string');
    expect((event.input.patchText as string).includes('\r')).toBe(false);
    expect((event.input.patchText as string)).toContain('*** Begin Patch');
  });

  test('整体替换真实 event.input（新对象引用传播给宿主，而非仅原对象改写）', async () => {
    const { ctx, beforeHooks } = createMockCtx();
    await registerOceanusHooks(ctx, {});
    const input: Record<string, unknown> = { patchText: validPatch(), extra: 'keep-me' };
    const event = { tool: 'apply_patch', sessionID: 's1', input };
    await beforeHooks[0]!(event);
    // 修复前：Hook 拿到的是包装对象 `{ tool, input }`，writePatchInput 的 `event.input = next`
    // 只替换了包装对象，宿主 event.input 仍指向原对象；修复后真实 event.input 被整体替换。
    expect(event.input).not.toBe(input);
    const rewritten = event.input as { patchText: string; extra: string };
    expect(rewritten.extra).toBe('keep-me'); // 原属性经 spread 保留
    expect(rewritten.patchText.includes('\r')).toBe(false); // CRLF→LF 生效
    expect(rewritten.patchText).toContain('*** Begin Patch');
  });

  test('畸形输入 fail-closed：抛错（阻断工具）', async () => {
    const { ctx, beforeHooks } = createMockCtx();
    await registerOceanusHooks(ctx, {});
    const event = { tool: 'apply_patch', sessionID: 's1', input: { foo: 1 } };
    await expect(beforeHooks[0]!(event)).rejects.toThrow();
  });

  test('工作区外路径 fail-open：不抛错、不改写', async () => {
    const { ctx, beforeHooks } = createMockCtx();
    await registerOceanusHooks(ctx, {});
    const patch = [
      '*** Begin Patch',
      '*** Update File: /etc/passwd',
      '@@',
      '-x',
      '+y',
      '*** End Patch',
    ].join('\n');
    const input: Record<string, unknown> = { patchText: patch };
    const event = { tool: 'apply_patch', sessionID: 's1', input };
    await expect(beforeHooks[0]!(event)).resolves.toBeUndefined();
    expect(event.input.patchText).toBe(patch);
  });

  test('无法解析工作区根目录时 fail-open：不抛错', async () => {
    const { ctx, beforeHooks } = createMockCtx({ getThrows: true });
    await registerOceanusHooks(ctx, {});
    const input: Record<string, unknown> = { patchText: validPatch() };
    const event = { tool: 'apply_patch', sessionID: 's1', input };
    await expect(beforeHooks[0]!(event)).resolves.toBeUndefined();
    expect(event.input.patchText).toContain('\r'); // 未改写
  });
});

// ─────────────────────────── json-error-recovery（after，v2 event.result） ───────────────────────────

describe('json-error-recovery execute.after', () => {
  test('completed 结果命中 JSON 错误时改写 event.result.content', async () => {
    const { ctx, afterHooks } = createMockCtx();
    await registerOceanusHooks(ctx, {});
    const event = {
      tool: 'some_tool',
      sessionID: 's1',
      status: 'completed',
      result: { content: 'Error: invalid json: unexpected end' },
    };
    await afterHooks[0]!(event);
    expect(event.result.content).toContain(JSON_ERROR_REMINDER_MARKER);
  });

  test('error 分支改写 event.error.message', async () => {
    const { ctx, afterHooks } = createMockCtx();
    await registerOceanusHooks(ctx, {});
    const event = {
      tool: 'some_tool',
      sessionID: 's1',
      status: 'error',
      error: { message: 'json parse error: bad token' },
    };
    await afterHooks[0]!(event);
    expect(event.error.message).toContain(JSON_ERROR_REMINDER_MARKER);
  });

  test('排除工具不误报', async () => {
    const { ctx, afterHooks } = createMockCtx();
    await registerOceanusHooks(ctx, {});
    const event = {
      tool: 'bash',
      sessionID: 's1',
      status: 'completed',
      result: { content: 'json parse error' },
    };
    await afterHooks[0]!(event);
    expect(event.result.content).not.toContain(JSON_ERROR_REMINDER_MARKER);
  });

  test('非文本结果 fail-open：不抛错、不改写', async () => {
    const { ctx, afterHooks } = createMockCtx();
    await registerOceanusHooks(ctx, {});
    const event = {
      tool: 'some_tool',
      sessionID: 's1',
      status: 'completed',
      result: { output: { structured: true } },
    };
    await afterHooks[0]!(event);
    expect(event.result.output).toEqual({ structured: true });
  });
});

// ─────────────────────────── tool-output-truncator（after） ───────────────────────────

describe('tool-output-truncator execute.after', () => {
  test('超长 completed 结果被截断并保留 marker', async () => {
    const { ctx, afterHooks } = createMockCtx();
    await registerOceanusHooks(ctx, {});
    const event = {
      tool: 'some_tool',
      sessionID: 's1',
      status: 'completed',
      result: { content: 'a'.repeat(300_000) },
    };
    await afterHooks[2]!(event);
    expect(event.result.content.length).toBeLessThan(300_000);
    expect(event.result.content).toContain(TRUNCATION_MARKER_PREFIX);
  });

  test('error 分支不截断：错误文本原样保留', async () => {
    const { ctx, afterHooks } = createMockCtx();
    await registerOceanusHooks(ctx, {});
    const longError = 'e'.repeat(300_000);
    const event = {
      tool: 'some_tool',
      sessionID: 's1',
      status: 'error',
      error: { message: longError },
    };
    await afterHooks[3]!(event);
    expect(event.error.message.length).toBe(300_000);
  });
});

// ─────────────────────────── 工作区根目录解析 ───────────────────────────

describe('工作区根目录解析', () => {
  test('session.get().location.directory 作为 workspace root', async () => {
    const { ctx } = createMockCtx({ root: '/repo/app' });
    expect(await resolveWorkspaceRoot(ctx.session, 's1')).toBe('/repo/app');
  });

  test('location 缺失时返回 null', async () => {
    const { ctx } = createMockCtx({ get: { id: 's1', projectID: 'p1' } });
    expect(await resolveWorkspaceRoot(ctx.session, 's1')).toBeNull();
  });

  test('ast_grep_search 无法解析根目录时返回错误而非抛异常', async () => {
    const { ctx, addedTools } = createMockCtx({ getThrows: true });
    await registerOceanusTools(ctx, {});
    const tool = findTool(addedTools, 'ast_grep_search');
    const res = parsed(await tool.execute({ pattern: 'x', lang: 'ts' }, { sessionID: 's1' }));
    expect(res.error).toContain('无法解析');
  });

  test('hashline_edit 拒绝工作区外路径', async () => {
    const { ctx, addedTools } = createMockCtx({ root: '/ws' });
    await registerOceanusTools(ctx, {});
    const tool = findTool(addedTools, 'hashline_edit');
    const res = parsed(
      await tool.execute(
        { filePath: '/etc/passwd', edits: [{ op: 'append', lines: 'x' }] },
        { sessionID: 's1' },
      ),
    );
    expect(res.error).toContain('工作区之外');
  });

  test('hashline_edit 真实文件：append 并返回稳定 diff', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'oceanus-hl-'));
    const { ctx, addedTools } = createMockCtx({ root: dir });
    await registerOceanusTools(ctx, {});
    await writeFile(path.join(dir, 'notes.txt'), 'line1\nline2\n', 'utf-8');
    const tool = findTool(addedTools, 'hashline_edit');
    const res = parsed(
      await tool.execute(
        { filePath: 'notes.txt', edits: [{ op: 'append', lines: 'line3' }] },
        { sessionID: 's1' },
      ),
    );
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);
    expect(res.diff).toContain('line3');
    expect(res.additions).toBe(1);
  });
});

// ─────────────────────────── task 三件套 ───────────────────────────

describe('task_status / task_result / task_cancel（coordinator）', () => {
  function coordinatorWithTask(opts: { state?: string; taskID?: string } = {}) {
    const records: any[] = [{
      taskID: opts.taskID ?? 'child-1', parentSessionID: 'parent-1', agent: 'explorer',
      laneKey: 'l1', objective: 'subagent job', generation: 1,
      state: opts.state ?? 'running', createdAt: 1, updatedAt: 1,
    }];
    return {
      records,
      listTasks: (parent: string) => records.filter((r) => r.parentSessionID === parent).map((r) => ({ ...r })),
      listByParent: (parent: string) => records.filter((r) => r.parentSessionID === parent).map((r) => ({ ...r })),
      async markResultConsumed(id: string) {
        const r = records.find((x) => x.taskID === id);
        r.resultConsumedAt = Date.now();
        return { ...r };
      },
      async markTerminal(id: string, _p: string, state: string) {
        const r = records.find((x) => x.taskID === id);
        r.state = state;
        r.terminal = true;
        return { ...r };
      },
    };
  }

  test('task_status 优先宿主 active：running', async () => {
    const coordinator = coordinatorWithTask();
    const { ctx, addedTools } = createMockCtx({ active: { 'child-1': { type: 'running' } } });
    await registerOceanusTools(ctx, {}, { coordinator } as any);
    const tool = findTool(addedTools, 'task_status');
    const res = parsed(await tool.execute({ taskId: 'child-1' }, { sessionID: 'parent-1' }));
    expect(res.status).toBe('running');
    expect(res.source).toBe('host');
    expect(res.verified).toBe(true);
  });

  test('task_status 跨 session 查询返回不存在（coordinator 按父过滤）', async () => {
    const coordinator = coordinatorWithTask();
    const { ctx, addedTools } = createMockCtx();
    await registerOceanusTools(ctx, {}, { coordinator } as any);
    const tool = findTool(addedTools, 'task_status');
    const res = parsed(await tool.execute({ taskId: 'child-1' }, { sessionID: 'stranger' }));
    expect(res.error).toContain('task 不存在');
  });

  test('task_result 只读已完成任务：未完成返回错误', async () => {
    const coordinator = coordinatorWithTask({ state: 'running' });
    const { ctx, addedTools } = createMockCtx({ active: { 'child-1': { type: 'running' } } });
    await registerOceanusTools(ctx, {}, { coordinator } as any);
    const tool = findTool(addedTools, 'task_result');
    const res = parsed(await tool.execute({ taskId: 'child-1' }, { sessionID: 'parent-1' }));
    expect(res.error).toContain('尚未完成');
  });

  test('task_result 已完成（宿主 outcome=succeeded）返回结果并消费', async () => {
    const coordinator = coordinatorWithTask({ state: 'completed' });
    const { ctx, addedTools } = createMockCtx({
      active: {},
      get: { id: 'child-1', projectID: 'p1', location: { directory: '/ws' }, outcome: 'succeeded' },
    });
    await registerOceanusTools(ctx, {}, { coordinator } as any);
    const tool = findTool(addedTools, 'task_result');
    const res = parsed(await tool.execute({ taskId: 'child-1' }, { sessionID: 'parent-1' }));
    expect(res.status).toBe('completed');
    expect(res.outcome).toBe('succeeded');
    expect(coordinator.records[0].resultConsumedAt).toBeGreaterThan(0);
  });

  test('task_cancel interrupt 子 session 并验证，更新为 cancelled', async () => {
    const coordinator = coordinatorWithTask();
    const { ctx, addedTools } = createMockCtx({
      active: {},
      interrupt: true,
      get: { id: 'child-1', projectID: 'p1', location: { directory: '/ws' }, outcome: 'interrupted' },
    });
    await registerOceanusTools(ctx, {}, { coordinator } as any);
    const tool = findTool(addedTools, 'task_cancel');
    const res = parsed(await tool.execute({ taskId: 'child-1' }, { sessionID: 'parent-1' }));
    expect(res.status).toBe('cancelled');
    expect(res.interrupted).toBe(true);
    expect(res.outcome).toBe('interrupted');
    expect(coordinator.records[0].state).toBe('cancelled');
  });

  test('task_cancel：interrupt 显式 interrupted:false 失败时不更新为 cancelled', async () => {
    const coordinator = coordinatorWithTask();
    const { ctx, addedTools } = createMockCtx({
      active: {},
      interrupt: false,
      get: { id: 'child-1', projectID: 'p1', location: { directory: '/ws' } },
    });
    await registerOceanusTools(ctx, {}, { coordinator } as any);
    const tool = findTool(addedTools, 'task_cancel');
    const res = parsed(await tool.execute({ taskId: 'child-1' }, { sessionID: 'parent-1' }));
    expect(res.error).toBeTruthy();
    expect(coordinator.records[0].state).toBe('running');
  });

  test('task_cancel：interrupt 成功但仍 active 时不更新为 cancelled', async () => {
    const coordinator = coordinatorWithTask();
    const { ctx, addedTools } = createMockCtx({
      active: { 'child-1': { type: 'running' } },
      interruptVoid: true,
      get: { id: 'child-1', projectID: 'p1', location: { directory: '/ws' } },
    });
    await registerOceanusTools(ctx, {}, { coordinator } as any);
    const tool = findTool(addedTools, 'task_cancel');
    const res = parsed(await tool.execute({ taskId: 'child-1' }, { sessionID: 'parent-1' }));
    expect(res.error).toBeTruthy();
    expect(coordinator.records[0].state).toBe('running');
  });

  test('task_cancel：interrupt 抛异常时不更新为 cancelled', async () => {
    const coordinator = coordinatorWithTask();
    const { ctx, addedTools } = createMockCtx({
      active: {},
      interruptThrows: true,
      get: { id: 'child-1', projectID: 'p1', location: { directory: '/ws' } },
    });
    await registerOceanusTools(ctx, {}, { coordinator } as any);
    const tool = findTool(addedTools, 'task_cancel');
    const res = parsed(await tool.execute({ taskId: 'child-1' }, { sessionID: 'parent-1' }));
    expect(res.error).toBeTruthy();
    expect(coordinator.records[0].state).toBe('running');
  });
});

// ─────────────────────────── subagent-bridge 接线链路 ───────────────────────────

describe('subagent-bridge 宿主登记链路', () => {
  test('subagent before/after 登记任务，task_status/task_result 可查询', async () => {
    const mock = createMockCtx({
      active: {},
      get: { id: 'ses_child_9', projectID: 'p1', location: { directory: '/ws' }, outcome: 'succeeded' },
    });
    // coordinator 用临时目录的真实实现（含 listTasks 供工具查询）。
    const { mkdtempSync } = require('node:fs');
    const { tmpdir } = require('node:os');
    const { join } = require('node:path');
    const { createTaskCoordinator } = require('./runtime/task-coordinator');
    const root = mkdtempSync(join(tmpdir(), 'bridge-reg-'));
    const coordinator = createTaskCoordinator({ workspaceRoot: root, session: mock.ctx.session as any });
    await coordinator.ready();
    await registerOceanusTools(mock.ctx, {}, { coordinator } as any);
    await registerOceanusHooks(mock.ctx, {}, { coordinator } as any);
    // bridge 是 cbm-guidance 前一个注册的 before/after。
    const bridgeBefore = mock.beforeHooks[mock.beforeHooks.length - 2];
    const bridgeAfter = mock.afterHooks[mock.afterHooks.length - 2];

    await bridgeBefore!({
      tool: 'subagent',
      sessionID: 'parent-1',
      id: 'call-1',
      input: { agent: 'explorer', lane_key: 'search', description: 'do the thing', prompt: 'find it' },
    });
    await bridgeAfter!({
      tool: 'subagent',
      sessionID: 'parent-1',
      id: 'call-1',
      status: 'completed',
      // 宿主真实形状：Tool.Result 无 sessionID 字段，ID 内嵌于 content 文本。
      result: { content: 'The subagent is working in the background (sessionID: ses_child_9). done ok' },
    });

    const statusTool = findTool(mock.addedTools, 'task_status');
    const st = parsed(await statusTool.execute({ taskId: 'ses_child_9' }, { sessionID: 'parent-1' }));
    expect(st.status).toBe('completed');
    expect(st.verified).toBe(true);

    const resultTool = findTool(mock.addedTools, 'task_result');
    const rr = parsed(await resultTool.execute({ taskId: 'ses_child_9' }, { sessionID: 'parent-1' }));
    expect(rr.status).toBe('completed');
    expect(rr.outcome).toBe('succeeded');
  });

  test('未提供 coordinator 时不注册 bridge hooks', async () => {
    const mock = createMockCtx();
    await registerOceanusHooks(mock.ctx, {});
    expect(mock.beforeHooks).toHaveLength(3); // apply_patch + loop-guard + cbm-guidance
    expect(mock.afterHooks).toHaveLength(5); // json + enhancer + truncator + loop-guard + cbm-guidance
  });

  test('hook 禁用时不注册 bridge（task 不存在）', async () => {
    const mock = createMockCtx();
    await registerOceanusHooks(mock.ctx, { disabled_hooks: ['task_registry_observer'] });
    expect(mock.beforeHooks).toHaveLength(3); // apply_patch + loop-guard + cbm-guidance
    expect(mock.afterHooks).toHaveLength(5);
  });
});

// ─────────────────────────── 会话能力探测（无 active 时） ───────────────────────────

describe('会话能力特性探测', () => {
  test('session 无 active 时返回 undefined（不伪造）', async () => {
    const session: SessionLike = {
      get: async ({ sessionID }) => ({ id: sessionID, location: { directory: '/ws' } }),
    };
    expect(await sessionActive(session, 'child-1')).toBeUndefined();
  });

  test('interrupt 不存在时返回 false（不伪造成功）', async () => {
    const session: SessionLike = {
      get: async ({ sessionID }) => ({ id: sessionID, location: { directory: '/ws' } }),
    };
    expect(await interruptSession(session, 'child-1')).toBe(false);
  });

  test('interruptSession：void 返回视为成功', async () => {
    const session: SessionLike = {
      get: async ({ sessionID }) => ({ id: sessionID, location: { directory: '/ws' } }),
      interrupt: async () => undefined,
    };
    expect(await interruptSession(session, 'child-1')).toBe(true);
  });

  test('interruptSession：传入 continue:false', async () => {
    let called: { sessionID: string; continue?: boolean } | undefined;
    const session: SessionLike = {
      get: async ({ sessionID }) => ({ id: sessionID, location: { directory: '/ws' } }),
      interrupt: async (input) => {
        called = input;
        return undefined;
      },
    };
    await interruptSession(session, 'child-1');
    expect(called).toEqual({ sessionID: 'child-1', continue: false });
  });

  test('interruptSession：显式 interrupted:false 视为失败', async () => {
    const session: SessionLike = {
      get: async ({ sessionID }) => ({ id: sessionID, location: { directory: '/ws' } }),
      interrupt: async () => ({ interrupted: false }),
    };
    expect(await interruptSession(session, 'child-1')).toBe(false);
  });

  test('interruptSession：interrupt 抛错视为失败', async () => {
    const session: SessionLike = {
      get: async ({ sessionID }) => ({ id: sessionID, location: { directory: '/ws' } }),
      interrupt: async () => {
        throw new Error('host interrupt unavailable');
      },
    };
    expect(await interruptSession(session, 'child-1')).toBe(false);
  });
});
