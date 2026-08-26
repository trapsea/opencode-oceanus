/**
 * v2 host smoke test（tooling-11-regression）。
 *
 * 目的：
 * - 探测环境是否具备“真正可用”的 ast-grep 二进制与 OpenCode v2 host 运行时。
 * - 若环境缺失任一项，相关测试必须**明确 skip + 给出诊断**，绝不把环境缺失
 *   误报为产品失败；也不修改核心检测逻辑来掩盖问题。
 * - 在无真实 host 时，用最小 mock ctx 做“注册契约 smoke”：验证插件 wiring 能
 *   把全部 Tool/Hook 注册进 v2 形状的 ctx，且注册计数符合预期。
 *
 * 运行：
 *   bun test src/smoke/host-smoke.test.ts
 *   AST_GREP_BIN=/path/to/ast-grep bun test src/smoke/host-smoke.test.ts
 */
import { describe, expect, test } from 'bun:test';
import { registerOceanusTools } from '../tools';
import { registerOceanusHooks } from '../hooks';
import type { ToolDefinition, ToolingContext } from '../runtime/types';
import { probeAstGrep } from './ast-grep-probe';

// ─────────────────────────── 环境探测（每个进程执行一次） ───────────────────────────

/** ast-grep 可用性（含误报排除）。 */
const astgrep = probeAstGrep();

/**
 * OpenCode host 可用性。
 *
 * 真实 host 只在 opencode 会话/插件运行时内存在；当前处于 bun test 运行器，
 * 没有真实 host 上下文。此处探测是否设置了可被识别的宿主运行标记，否则视为
 * “无真实 host”。该判定仅用于 skip/diagnostic，不伪造任何 host 行为。
 */
function probeHost(): { available: boolean; diagnostic: string } {
  const marker = process.env.OPENCODE_OCEANUS_HOST_SMOKE;
  if (marker && marker !== '0' && marker.toLowerCase() !== 'false') {
    return { available: true, diagnostic: '检测到 OpenCode host smoke 运行标记' };
  }
  return {
    available: false,
    diagnostic:
      '未检测到 OpenCode v2 host 运行时（当前在 bun test 下执行）。真实 host smoke 需在 opencode ' +
      '会话内运行插件；此处改用 mock ctx 验证注册契约，宿主能力（session.active/interrupt）不在本环境验证。',
  };
}

const host = probeHost();

// 在测试文件顶部打印环境报告，便于 CI 日志审阅。
// eslint-disable-next-line no-console
console.log('[oceanus-smoke] ast-grep:', astgrep.diagnostic);
// eslint-disable-next-line no-console
console.log('[oceanus-smoke] opencode host:', host.diagnostic);

// ─────────────────────────── 最小 mock ctx（注册契约） ───────────────────────────

function createMockCtx(): {
  ctx: ToolingContext;
  addedTools: ToolDefinition[];
  beforeHooks: Array<(e: any) => Promise<void> | void>;
  afterHooks: Array<(e: any) => Promise<void> | void>;
} {
  const addedTools: ToolDefinition[] = [];
  const beforeHooks: Array<(e: any) => Promise<void> | void> = [];
  const afterHooks: Array<(e: any) => Promise<void> | void> = [];
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
    session: {
      get: async ({ sessionID }) => ({ id: sessionID, location: { directory: '/ws' } }),
    },
  };
  return { ctx, addedTools, beforeHooks, afterHooks };
}

// ─────────────────────────── 环境报告（始终运行） ───────────────────────────

describe('v2 host smoke：环境探测', () => {
  test('ast-grep 可用性被记录（含误报候选检测）', () => {
    expect(typeof astgrep.available).toBe('boolean');
    expect(astgrep.diagnostic.length).toBeGreaterThan(0);
  });

  test('OpenCode host 可用性被记录', () => {
    expect(typeof host.available).toBe('boolean');
    expect(host.diagnostic.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────── 注册契约 smoke（无真实 host 也运行） ───────────────────────────

describe('v2 host smoke：注册契约（mock ctx）', () => {
  test('默认注册 6 个工具 + 6 个 hooks（3 before + 4 after）', async () => {
    const mock = createMockCtx();
    await registerOceanusTools(mock.ctx, {});
    await registerOceanusHooks(mock.ctx, {});
    const toolNames = mock.addedTools.map((t) => t.name).sort();
    expect(toolNames).toEqual(
      [
        'ast_grep_replace',
        'ast_grep_search',
        'hashline_edit',
        'task_cancel',
        'task_result',
        'task_status',
      ].sort(),
    );
    expect(mock.beforeHooks).toHaveLength(3);
    expect(mock.afterHooks).toHaveLength(4);
  });

  test('禁用矩阵：disabled_tools / disabled_hooks 全部生效后为 0', async () => {
    const mock = createMockCtx();
    const config = {
      disabled_tools: [
        'ast_grep_search',
        'ast_grep_replace',
        'hashline_edit',
        'task_status',
        'task_result',
        'task_cancel',
      ],
      disabled_hooks: [
        'apply_patch',
        'tool_loop_guard',
        'json_error_recovery',
        'tool_output_truncator',
        'task_registry_observer',
      ],
    };
    await registerOceanusTools(mock.ctx, config as any);
    await registerOceanusHooks(mock.ctx, config as any);
    expect(mock.addedTools).toHaveLength(0);
    expect(mock.beforeHooks).toHaveLength(0);
    expect(mock.afterHooks).toHaveLength(0);
  });
});

// ─────────────────────────── 真实 ast-grep CLI 集成（仅在确认可用时运行） ───────────────────────────

describe.skipIf(!astgrep.available)('v2 host smoke：真实 ast-grep CLI', () => {
  test('探针确认 ast-grep 可用', () => {
    expect(astgrep.available).toBe(true);
    expect(astgrep.path).toBeTruthy();
  });

  test('ast_grep_search 经注册工具返回匹配', async () => {
    const mock = createMockCtx();
    await registerOceanusTools(mock.ctx, {});
    const tool = mock.addedTools.find((t) => t.name === 'ast_grep_search')!;
    const res = await tool.execute(
      { pattern: 'console.log($MSG)', lang: 'typescript' },
      { sessionID: 's1' },
    );
    const parsed = JSON.parse(res.content as string);
    expect(parsed.error).toBeUndefined();
    expect(parsed.matches.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────── 真实 host 专用 smoke（仅在确认 host 时运行） ───────────────────────────

describe.skipIf(!host.available)('v2 host smoke：真实 OpenCode host', () => {
  test('host 能力探测已就绪（占位：在真实 opencode 会话内执行插件 smoke）', () => {
    expect(host.available).toBe(true);
  });
});
