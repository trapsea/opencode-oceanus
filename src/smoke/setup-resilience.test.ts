import { describe, expect, test } from 'bun:test';
import { runSetup } from '../index';

/** 只提供 setup 所需的最小宿主面；测试不触碰真实网络、安装或宿主进程。 */
function host(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const registeredSkills: Array<Record<string, unknown>> = [];
  // 陷阱记录：SessionDomain 无 sessionID/id 属性；setup 读取即违约。
  const sessionIdentityReads: string[] = [];
  const getCalls: Array<{ sessionID: string }> = [];
  const domain = (name: string) => ({
    transform: async (fn: (draft: any) => void) => {
      calls.push(`${name}.transform`);
      fn({
        add: (value: Record<string, unknown>) => {
          if (name === 'skill') registeredSkills.push(value);
        },
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
    registeredSkills,
    sessionIdentityReads,
    getCalls,
    agent: domain('agent'),
    skill: domain('skill'),
    command: domain('command'),
    mcp: domain('mcp'),
    session: {
      get sessionID() { sessionIdentityReads.push('sessionID'); return ''; },
      get id() { sessionIdentityReads.push('id'); return ''; },
      get: async (input: { sessionID: string }) => {
        getCalls.push(input);
        return { id: input.sessionID, location: { directory: process.cwd() } };
      },
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
  test('skill 注册使用 OpenCode 2.0.5 要求的 path 字段', async () => {
    const ctx = host();
    await runSetup(ctx, { loadConfig: config, cbm: cbm() });

    expect(ctx.registeredSkills.length).toBeGreaterThan(0);
    for (const skill of ctx.registeredSkills) {
      expect(skill.path).toMatch(/^\/builtin\/opencode-oceanus\/.*\/SKILL\.md$/);
      expect(skill).not.toHaveProperty('location');
    }
  });

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

describe('setup 会话身份契约（Wave 2A）', () => {
  test('setup 不读取 SessionDomain 的 sessionID/id，也不以空 sessionID 调用宿主 get', async () => {
    const ctx = host();
    await runSetup(ctx, { loadConfig: config, cbm: cbm() });
    // 宿主 ctx.session 是 SessionDomain API 对象，没有会话身份字段；
    // setup 期不存在真实会话，伪造 parentSessionID 属于违约。
    expect(ctx.sessionIdentityReads).toEqual([]);
    // eager reconcile 的前置步骤会以空 sessionID 调 session.get；setup 期
    // 对宿主 get 的调用应为零（含空串）。
    expect(ctx.getCalls).toEqual([]);
  });

  test('session.get 缺失（旧宿主最小面）时 setup 仍 fail-open 完成全部注册', async () => {
    const ctx = host({ session: {} });
    await expect(runSetup(ctx, { loadConfig: config, cbm: cbm() })).resolves.toBeDefined();
    // session.get 缺失不得阻断与 session 无关的注册阶段。
    expect(ctx.calls).toContain('agent.transform');
    expect(ctx.calls).toContain('skill.transform');
    expect(ctx.calls).toContain('command.transform');
    expect(ctx.calls).toContain('mcp.transform');
  });
});
