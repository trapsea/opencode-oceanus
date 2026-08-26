/**
 * 跨模块集成测试（tooling-11-regression）。
 *
 * 覆盖 Wave 1~2 各核心模块通过 `registerOceanusTools` / `registerOceanusHooks`
 * 组装后的联动行为：
 * - hashline_edit：真实文件 → 结构化 diff → 磁盘写入；hash mismatch 拒绝改写。
 * - ast_grep_*：经注册工具执行 search / replace dry-run / replace apply；
 *   真实 CLI 不可用时明确 skip + 诊断，不把环境缺失误报为产品失败。
 * - task registry → task_status / task_result / task_cancel 全生命周期。
 * - Hook 顺序（json 先于 truncator、loop-guard 最后）、配置开关、失败隔离。
 * - task ownership（跨 session 越权拒绝）与 v2 void interrupt 语义。
 *
 * 约束：只复用公开 API 与最小 mock host，不修改任何核心实现。
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerOceanusTools } from './tools';
import { registerOceanusHooks } from './hooks';
import type { PluginConfig } from './config/schema';
import { TaskRegistry } from './tools/task/registry';
import { resetTaskRegistry } from './runtime/task';
import { computeLineHash } from './tools/hashline-edit';
import type {
  SessionInfoLike,
  SessionLike,
  ToolDefinition,
  ToolingContext,
} from './runtime/types';
import { JSON_ERROR_REMINDER_MARKER } from './hooks/json-error-recovery';
import { TRUNCATION_MARKER_PREFIX } from './hooks/tool-output-truncator';
import { LOOP_GUARD_MARKER } from './hooks/tool-loop-guard';
import { probeAstGrep } from './smoke/ast-grep-probe';

// 环境探测：真实 ast-grep 可用性（含误报候选排除）。仅在确认可用时运行真实 CLI 用例。
const astgrep = probeAstGrep();

const tempDirs: string[] = [];

afterEach(async () => {
  resetTaskRegistry();
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

// ─────────────────────────── 最小 mock host ───────────────────────────

interface MockOverrides {
  root?: string;
  get?: SessionInfoLike;
  active?: Record<string, unknown>;
  interrupt?: boolean;
  interruptVoid?: boolean;
  interruptThrows?: boolean;
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

function parsed(result: { content?: unknown }): any {
  expect(typeof result.content).toBe('string');
  return JSON.parse(result.content as string);
}

function findTool(added: ToolDefinition[], name: string): ToolDefinition {
  const t = added.find((x) => x.name === name);
  expect(t, `tool ${name} 已注册`).toBeDefined();
  return t!;
}

// ─────────────────────────── hashline → diff → 磁盘 ───────────────────────────

describe('hashline_edit 跨模块：真实文件 → diff → 磁盘', () => {
  test('replace 锚点：改写文件并返回包含新旧行的结构化 diff', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'oceanus-int-hl-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'data.txt');
    await writeFile(file, ['alpha', 'beta', 'gamma'].join('\n') + '\n', 'utf-8');

    const { ctx, addedTools } = createMockCtx({ root: dir });
    await registerOceanusTools(ctx, {});
    const tool = findTool(addedTools, 'hashline_edit');
    const anchor = `2#${computeLineHash(2, 'beta')}`;
    const res = parsed(
      await tool.execute(
        { filePath: 'data.txt', edits: [{ op: 'replace', pos: anchor, lines: 'beta-CHANGED' }] },
        { sessionID: 's1' },
      ),
    );

    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);
    expect(res.diff).toContain('beta-CHANGED');
    expect(res.diff).toContain('beta');
    expect(res.additions).toBe(1);
    expect(res.deletions).toBe(1);
    const after = await readFile(file, 'utf-8');
    expect(after).toContain('beta-CHANGED');
    expect(after).not.toContain('\nbeta\n');
  });

  test('append 返回结构化的 diff 且带增删统计', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'oceanus-int-hl3-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'data.txt');
    await writeFile(file, ['alpha', 'beta'].join('\n') + '\n', 'utf-8');

    const { ctx, addedTools } = createMockCtx({ root: dir });
    await registerOceanusTools(ctx, {});
    const tool = findTool(addedTools, 'hashline_edit');
    const res = parsed(
      await tool.execute(
        { filePath: 'data.txt', edits: [{ op: 'append', lines: 'omega' }] },
        { sessionID: 's1' },
      ),
    );
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);
    expect(res.diff).toContain('omega');
    expect(res.additions).toBe(1);
    expect(await readFile(file, 'utf-8')).toContain('omega');
  });

  test('文件被外部修改后 hash mismatch → 返回错误且不改写文件', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'oceanus-int-hl2-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'data.txt');
    await writeFile(file, ['alpha', 'beta', 'gamma'].join('\n') + '\n', 'utf-8');

    // 外部修改文件 → 已有锚点失效
    await writeFile(file, ['alpha', 'BETA-EXT', 'gamma'].join('\n') + '\n', 'utf-8');

    const { ctx, addedTools } = createMockCtx({ root: dir });
    await registerOceanusTools(ctx, {});
    const tool = findTool(addedTools, 'hashline_edit');
    const staleAnchor = `2#${computeLineHash(2, 'beta')}`;
    const res = parsed(
      await tool.execute(
        { filePath: 'data.txt', edits: [{ op: 'replace', pos: staleAnchor, lines: 'should-not-write' }] },
        { sessionID: 's1' },
      ),
    );
    expect(res.ok).toBe(false);
    expect(typeof res.error).toBe('string');
    expect((res.error as string).toLowerCase()).toContain('changed');
    const after = await readFile(file, 'utf-8');
    expect(after).toContain('BETA-EXT');
    expect(after).not.toContain('should-not-write');
  });
});

// ─────────────────────────── ast-grep 跨模块（真实 CLI 可用时） ───────────────────────────

describe.skipIf(!astgrep.available)('ast-grep 跨模块：经注册工具（真实 CLI）', () => {
  async function setup(): Promise<{ dir: string; file: string; addedTools: ToolDefinition[] }> {
    const dir = await mkdtemp(path.join(tmpdir(), 'oceanus-int-ast-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'a.ts');
    await writeFile(
      file,
      'function hello() {\n  console.log("hi");\n  console.log("yo");\n}\n',
    );
    const { ctx, addedTools } = createMockCtx({ root: dir });
    await registerOceanusTools(ctx, {});
    return { dir, file, addedTools };
  }

  test('ast_grep_search 经注册工具返回结构化匹配', async () => {
    const { addedTools } = await setup();
    const tool = findTool(addedTools, 'ast_grep_search');
    const res = parsed(
      await tool.execute({ pattern: 'console.log($MSG)', lang: 'typescript' }, { sessionID: 's1' }),
    );
    expect(res.error).toBeUndefined();
    expect(res.matches.length).toBeGreaterThanOrEqual(2);
    for (const m of res.matches) expect(m.file).toBe('a.ts');
  });

  test('ast_grep_replace dry-run（默认）预览 replacement 且不写盘', async () => {
    const { file, addedTools } = await setup();
    const tool = findTool(addedTools, 'ast_grep_replace');
    const before = await readFile(file, 'utf8');
    const res = parsed(
      await tool.execute(
        { pattern: 'console.log($MSG)', rewrite: 'logger.info($MSG)', lang: 'typescript' },
        { sessionID: 's1' },
      ),
    );
    expect(res.error).toBeUndefined();
    expect(res.matches[0].replacement).toMatch(/^logger\.info/);
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  test('ast_grep_replace dryRun:false 真正写盘', async () => {
    const { file, addedTools } = await setup();
    const tool = findTool(addedTools, 'ast_grep_replace');
    const res = parsed(
      await tool.execute(
        {
          pattern: 'console.log($MSG)',
          rewrite: 'logger.info($MSG)',
          lang: 'typescript',
          dryRun: false,
        },
        { sessionID: 's1' },
      ),
    );
    expect(res.error).toBeUndefined();
    const after = await readFile(file, 'utf8');
    expect(after).toContain('logger.info("hi")');
    expect(after).not.toContain('console.log("hi")');
  });

  test('配置级 ast_grep_replace.dryRun:false 覆盖默认 dry-run', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'oceanus-int-ast2-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'b.ts');
    await writeFile(file, 'console.log("x")\n');
    const config: PluginConfig = { tools: { ast_grep_replace: { dryRun: false } } };
    const { ctx, addedTools } = createMockCtx({ root: dir });
    await registerOceanusTools(ctx, config);
    const tool = findTool(addedTools, 'ast_grep_replace');
    const res = parsed(
      await tool.execute(
        { pattern: 'console.log($MSG)', rewrite: 'logger.info($MSG)', lang: 'typescript' },
        { sessionID: 's1' },
      ),
    );
    expect(res.error).toBeUndefined();
    expect(await readFile(file, 'utf8')).toContain('logger.info("x")');
  });

  test('工作区路径越界被拒绝', async () => {
    const { addedTools } = await setup();
    const tool = findTool(addedTools, 'ast_grep_search');
    const res = parsed(
      await tool.execute(
        { pattern: 'console.log($MSG)', lang: 'typescript', paths: ['../outside'] },
        { sessionID: 's1' },
      ),
    );
    expect(res.error).toMatch(/outside the workspace/i);
  });
});

// ─────────────────────────── task 生命周期 ───────────────────────────

describe('task registry → status → result → cancel 生命周期（经注册工具）', () => {
  test('create → status(running) → result(未完成) → cancel → status(cancelled)', async () => {
    const registry = new TaskRegistry();
    registry.create({
      id: 't-1',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      status: 'running',
      label: 'job',
    });

    // 运行中的 host：active 含 child-1
    const running = createMockCtx({ active: { 'child-1': { type: 'running' } } });
    await registerOceanusTools(running.ctx, {}, { registry });
    const statusTool = findTool(running.addedTools, 'task_status');
    const resultTool = findTool(running.addedTools, 'task_result');

    // 1) status → running（host active 优先）
    const st = parsed(await statusTool.execute({ taskId: 't-1' }, { sessionID: 'parent-1' }));
    expect(st.status).toBe('running');
    expect(st.source).toBe('host');

    // 2) result → 尚未完成错误
    const rr = parsed(await resultTool.execute({ taskId: 't-1' }, { sessionID: 'parent-1' }));
    expect(rr.error).toContain('尚未完成');

    // 3) 切换 host：child 已不再 active 且 outcome=interrupted，void interrupt
    const cancel = createMockCtx({
      active: {},
      interruptVoid: true,
      get: { id: 'child-1', projectID: 'p1', location: { directory: '/ws' }, outcome: 'interrupted' },
    });
    await registerOceanusTools(cancel.ctx, {}, { registry });
    const cancelTool = findTool(cancel.addedTools, 'task_cancel');
    const cr = parsed(await cancelTool.execute({ taskId: 't-1' }, { sessionID: 'parent-1' }));
    expect(cr.status).toBe('cancelled');
    expect(cancel.interruptCalls).toEqual([{ sessionID: 'child-1', continue: false }]);

    // 4) cancel 后再查 status（用 cancel 的 host 视图）→ cancelled
    const cancelStatus = findTool(cancel.addedTools, 'task_status');
    const st2 = parsed(await cancelStatus.execute({ taskId: 't-1' }, { sessionID: 'parent-1' }));
    expect(st2.status).toBe('cancelled');
  });
});

// ─────────────────────────── Hook 顺序 / 配置开关 / 失败隔离 ───────────────────────────

describe('Hook 顺序、配置开关与失败隔离', () => {
  test('默认注册计数：13 工具、4 before + 5 after hooks', async () => {
    const mock = createMockCtx();
    await registerOceanusTools(mock.ctx, {});
    await registerOceanusHooks(mock.ctx, {});
    expect(mock.addedTools).toHaveLength(13);
    expect(mock.beforeHooks).toHaveLength(4);
    expect(mock.afterHooks).toHaveLength(5);
  });

  test('全部禁用矩阵 → 0 工具、0 hooks', async () => {
    const config: PluginConfig = {
      disabled_tools: [
        'ast_grep_search',
        'ast_grep_replace',
        'hashline_edit',
        'task_status',
        'task_result',
        'task_cancel',
        'cbm_status',
        'cbm_index',
        'cbm_search_graph',
        'cbm_trace',
        'cbm_code',
        'cbm_query',
        'cbm_detect_changes',
      ],
      disabled_hooks: [
        'apply_patch',
        'tool_loop_guard',
        'json_error_recovery',
        'tool_output_truncator',
        'task_registry_observer',
        'cbm_guidance',
      ],
    };
    const mock = createMockCtx();
    await registerOceanusTools(mock.ctx, config);
    await registerOceanusHooks(mock.ctx, config);
    expect(mock.addedTools).toHaveLength(0);
    expect(mock.beforeHooks).toHaveLength(0);
    expect(mock.afterHooks).toHaveLength(0);
  });

  test('混合禁用：只禁用部分，其余照常注册', async () => {
    const config: PluginConfig = {
      disabled_tools: ['task_status', 'ast_grep_search'],
      disabled_hooks: ['json_error_recovery'],
    };
    const mock = createMockCtx();
    await registerOceanusTools(mock.ctx, config);
    await registerOceanusHooks(mock.ctx, config);
    const names = mock.addedTools.map((t) => t.name);
    expect(names).not.toContain('task_status');
    expect(names).not.toContain('ast_grep_search');
    expect(names).toContain('ast_grep_replace');
    expect(names).toContain('hashline_edit');
    expect(names).toContain('task_result');
    expect(names).toContain('task_cancel');
    // 未禁用 4 个常规工具 + 默认 7 个 CBM 工具
    expect(mock.addedTools).toHaveLength(11);
    // json 被禁用 → after 只剩 truncator + loop-guard + observer + cbm-guidance
    expect(mock.afterHooks).toHaveLength(4);
    expect(mock.beforeHooks).toHaveLength(4); // apply_patch + loop-guard + observer + cbm-guidance
  });

  test('after 顺序：json 先于 truncator（小上限下追加的 marker 被截掉）', async () => {
    const { ctx, afterHooks } = createMockCtx();
    const config: PluginConfig = {
      hooks: { tool_output_truncator: { maxOutputBytes: 200 } },
    };
    await registerOceanusHooks(ctx, config);
    // 内容以 json 错误开头 → json hook 命中并追加 reminder；随后 truncator 截断。
    const content = 'json parse error ' + 'a'.repeat(300_000);
    const event = { tool: 'some_tool', sessionID: 's1', status: 'completed', result: { content } };
    await afterHooks[0]!(event); // json-error-recovery（先）
    afterHooks[1]!(event as any); // tool-output-truncator（后）
    expect(event.result.content.length).toBeLessThan(300_000);
    expect(event.result.content).toContain(TRUNCATION_MARKER_PREFIX);
    // 由于 json 先追加、truncator 后截断，reminder 落在保留尾部之外被截掉。
    // 若顺序颠倒（truncator 先、json 后），reminder 会完整保留 → 该断言可区分顺序。
    expect(event.result.content).not.toContain(JSON_ERROR_REMINDER_MARKER);
  });

  test('after 顺序：loop-guard 最后（warning 追加在 truncation marker 之后）', async () => {
    const { ctx, beforeHooks, afterHooks } = createMockCtx();
    const config: PluginConfig = {
      hooks: { tool_output_truncator: { maxOutputBytes: 200 } },
    };
    await registerOceanusHooks(ctx, config);
    const input = { pattern: 'x' };
    let lastContent = '';
    // 3 次完全相同的调用（参数与结果一致）→ loop-guard 在第 3 次告警。
    for (let i = 0; i < 3; i++) {
      const content = 'a'.repeat(300_000); // 非 json 错误 → json 不动；超长 → truncator 截断
      const event = {
        tool: 'read',
        sessionID: 's1',
        id: 'call-1',
        input,
        status: 'completed',
        result: { content },
      };
      await beforeHooks[0]!(event); // apply_patch（非 apply_patch 工具，no-op）
      await beforeHooks[1]!(event); // loop-guard.before → 记录调用指纹
      await afterHooks[0]!(event); // json（no-op）
      afterHooks[1]!(event as any); // truncator → 截断到 200
      await afterHooks[2]!(event); // loop-guard.after → 第 3 次告警追加 warning
      lastContent = event.result.content as string;
    }
    expect(lastContent).toContain(TRUNCATION_MARKER_PREFIX);
    expect(lastContent).toContain(LOOP_GUARD_MARKER);
    // truncator 先于 loop-guard：truncation marker 出现在 loop-guard warning 之前。
    expect(lastContent.indexOf(TRUNCATION_MARKER_PREFIX)).toBeLessThan(
      lastContent.indexOf(LOOP_GUARD_MARKER),
    );
  });

  test('loop-guard 自定义 warnAt 经注册透传生效', async () => {
    const { ctx, beforeHooks, afterHooks } = createMockCtx();
    const config: PluginConfig = {
      hooks: { tool_loop_guard: { warnAt: 2 } },
    };
    await registerOceanusHooks(ctx, config);
    const input = { pattern: 'x' };
    let lastContent = '';
    // 2 次完全相同调用 → loop-guard 在第 2 次（自定义 warnAt=2）告警。
    for (let i = 0; i < 2; i++) {
      const event = {
        tool: 'read',
        sessionID: 's-warncfg',
        id: 'call-w',
        input,
        status: 'completed',
        result: { content: 'same' },
      };
      await beforeHooks[1]!(event); // loop-guard.before
      await afterHooks[2]!(event); // loop-guard.after
      lastContent = event.result.content as string;
    }
    expect(lastContent).toContain(LOOP_GUARD_MARKER);
    // 文案使用实际 warnAt=2。
    expect(lastContent).toContain('identical arguments 2 times');
  });

  test('单个 Hook 注册失败不阻断其它 Hook 注册（失败隔离）', async () => {
    const hookCalls: string[] = [];
    const beforeHooks: Array<(e: any) => Promise<void> | void> = [];
    const afterHooks: Array<(e: any) => Promise<void> | void> = [];
    const log: string[] = [];
    const ctx: ToolingContext = {
      tool: {
        transform: async () => {},
        hook: async (name, cb) => {
          hookCalls.push(name);
          // 模拟第 2 次注册（loop-guard.before）失败
          if (hookCalls.length === 2) throw new Error('simulated hook registration failure');
          if (name === 'execute.before') beforeHooks.push(cb as any);
          else if (name === 'execute.after') afterHooks.push(cb as any);
        },
      },
      session: {
        get: async ({ sessionID }) => ({ id: sessionID, location: { directory: '/ws' } }),
      },
    };
    await registerOceanusHooks(ctx, {}, { logger: (m) => log.push(m) });
    // apply_patch.before 仍注册；observer / cbm-guidance 独立注册不受影响 → before 3；
    // 所有 after（json / truncator / loop-guard / observer / cbm-guidance）仍注册 → after 5
    expect(beforeHooks).toHaveLength(3);
    expect(afterHooks).toHaveLength(5);
    expect(log.some((m) => m.includes('tool-loop-guard.before'))).toBe(true);
  });
});

// ─────────────────────────── task ownership 与 v2 void interrupt ───────────────────────────

describe('task ownership 与 v2 void interrupt 语义（经注册工具）', () => {
  test('stranger session 越权被拒，child session 允许读取', async () => {
    const registry = new TaskRegistry();
    registry.create({
      id: 't-2',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      status: 'running',
      label: 'job',
    });
    const { ctx, addedTools } = createMockCtx({ active: {} });
    await registerOceanusTools(ctx, {}, { registry });
    const statusTool = findTool(addedTools, 'task_status');

    const stranger = parsed(await statusTool.execute({ taskId: 't-2' }, { sessionID: 'stranger' }));
    expect(stranger.error).toBeTruthy();

    const child = parsed(await statusTool.execute({ taskId: 't-2' }, { sessionID: 'child-1' }));
    expect(child.status).toBeDefined();
    expect(child.error).toBeUndefined();
  });

  test('task_cancel：void interrupt（官方语义）视为成功并传 continue:false', async () => {
    const registry = new TaskRegistry();
    registry.create({
      id: 't-3',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      status: 'running',
      label: 'job',
    });
    const { ctx, addedTools, interruptCalls } = createMockCtx({
      active: {},
      interruptVoid: true,
      get: { id: 'child-1', projectID: 'p1', location: { directory: '/ws' }, outcome: 'interrupted' },
    });
    await registerOceanusTools(ctx, {}, { registry });
    const cancelTool = findTool(addedTools, 'task_cancel');
    const res = parsed(await cancelTool.execute({ taskId: 't-3' }, { sessionID: 'parent-1' }));
    expect(res.status).toBe('cancelled');
    expect(interruptCalls).toEqual([{ sessionID: 'child-1', continue: false }]);
    expect(registry.get('t-3', 'parent-1')!.status).toBe('cancelled');
  });

  test('task_cancel：显式 interrupted:false 不更新为 cancelled', async () => {
    const registry = new TaskRegistry();
    registry.create({
      id: 't-4',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      status: 'running',
      label: 'job',
    });
    const { ctx, addedTools } = createMockCtx({
      active: {},
      interrupt: false,
      get: { id: 'child-1', projectID: 'p1', location: { directory: '/ws' } },
    });
    await registerOceanusTools(ctx, {}, { registry });
    const cancelTool = findTool(addedTools, 'task_cancel');
    const res = parsed(await cancelTool.execute({ taskId: 't-4' }, { sessionID: 'parent-1' }));
    expect(res.error).toBeTruthy();
    expect(registry.get('t-4', 'parent-1')!.status).toBe('running');
  });
});
