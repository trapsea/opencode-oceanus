import { describe, expect, test } from 'bun:test';
import { runSetup } from '../index';

/** 只提供 setup 所需的最小宿主面；测试不触碰真实网络、安装或宿主进程。 */
function host(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const domain = (name: string) => ({
    transform: async (fn: (draft: any) => void) => {
      calls.push(`${name}.transform`);
      fn({
        add: () => {},
        get: () => undefined,
        remove: () => {},
        set: () => {},
        update: (_name: string, fn: (value: any) => void) => fn({ request: { settings: {} } }),
        default: () => {},
      });
      return { dispose: async () => { calls.push(`${name}.dispose`); } };
    },
    reload: async () => { calls.push(`${name}.reload`); },
  });
  return {
    calls,
    agent: domain('agent'),
    skill: domain('skill'),
    command: domain('command'),
    mcp: domain('mcp'),
    session: {
      sessionID: 'smoke-session',
      get: async () => ({ id: 'smoke-session', location: { directory: process.cwd() } }),
    },
    ...overrides,
  } as any;
}

const config = () => ({ agents: {}, tools: {}, hooks: {}, codebaseMemory: { enabled: false } }) as any;
const cbm = (logger?: (message: string, meta?: Record<string, unknown>) => void) => ({
  logger,
  createIndexer: () => ({
    ensureIndexed: async () => ({ kind: 'degraded', reason: 'smoke', message: 'smoke' }),
    isIndexed: () => false,
    isIndexing: () => false,
    getLastOutcome: () => undefined,
    reset: () => {},
  }),
  startBackgroundInstall: async () => null,
  ensureInstalled: async () => null,
  repair: async () => null,
});

describe('setup 入口阶段化韧性（RED）', () => {
  test('配置加载硬失败：不启动任何可选阶段', async () => {
    const ctx = host();
    await expect(runSetup(ctx, {
      loadConfig: () => { throw new Error('invalid config'); },
      cbm: cbm(),
    })).rejects.toThrow('invalid config');
    expect(ctx.calls).toEqual([]);
  });

  test('agent 域缺失或 transform 失败，不阻断 skill/command 独立阶段', async () => {
    const ctx = host({
      agent: { transform: async () => { throw new Error('agent transform'); } },
    });
    await expect(runSetup(ctx, { loadConfig: config, cbm: cbm() })).resolves.toBeDefined();
    expect(ctx.calls).toContain('skill.transform');
    expect(ctx.calls).toContain('command.transform');
  });

  test('MCP Promise pending 不阻塞返回，rejection 通过 mcp.async 报告', async () => {
    const messages: string[] = [];
    const ctx = host();
    let rejectPending!: (error: Error) => void;
    const pending = new Promise<never>((_, reject) => { rejectPending = reject; });
    await runSetup(ctx, {
      loadConfig: () => ({ ...config(), codebaseMemory: { enabled: true, autoDownload: true, binaryPath: '/definitely-missing' } }),
      cbm: { ...cbm((message) => messages.push(message)), ensureInstalled: async () => pending },
    });
    expect(ctx.calls).toContain('mcp.transform');
    rejectPending(new Error('mcp registration failed'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(messages.some((message) => message.includes('mcp.async'))).toBe(true);
  });

  test('host-facing cleanup 会触发 agent dispose 与 reload 重试语义（preset reload 已迁移 TUI 侧）', async () => {
    let reloads = 0;
    const ctx = host({
      event: {},
      agent: {
        transform: async () => ({ dispose: async () => {} }),
        reload: async () => { reloads += 1; if (reloads === 1) throw new Error('reload once'); },
      },
    });
    const cleanup = await runSetup(ctx, { loadConfig: config, cbm: cbm() });
    expect(typeof cleanup).toBe('function');
    cleanup?.();
    expect(reloads).toBeGreaterThan(0);
  });
});
