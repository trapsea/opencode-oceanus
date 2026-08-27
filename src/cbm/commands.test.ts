import { describe, expect, test } from 'bun:test';
import { createCbmCommand, type CbmCommandHandlers } from './commands';
import type { CommandDefinition, CommandInvocation } from '../commands/types';
import type { UiStatus } from './ui';
import type { IndexerOutcome } from './indexer';

/**
 * /cbm 命令族契约测试（CBM-10 · TDD 红→绿）。
 *
 * 契约：
 * - `createCbmCommand(handlers)` 返回一个名为 `cbm` 的 `CommandDefinition`
 *   （description 非空、execute 为函数）。
 * - 子命令：空/status / install / repair / index / ui / ui stop / uninstall；
 *   未知子命令 → 失败回写。
 * - 依赖全部通过 handlers 注入：provision（startBackgroundInstall / repair /
 *   ensureInstalled）、MCP（registerMcp / removeMcp）、indexer、UI
 *   （startUi / stopUi / getUiStatus）、getInstallStatus / getCacheRoot /
 *   getWorkspaceRoot、reply。
 * - 语义：
 *   - install 后台启动**不阻塞**：execute 在安装 Promise 完成前即返回并回写；
 *     安装成功后（fire-and-forget）触发 registerMcp。
 *   - repair / index / ui 等待对应 handler 完成；任一 handler 抛错或缺失依赖
 *     → 仅回写失败消息，绝不向 execute 抛异常（fail-open）。
 *   - uninstall 只移除 Oceanus 管理资源（stopUi + removeMcp），不删除源码/用户索引。
 */
const idleStatus: UiStatus = {
  running: false,
  pid: null,
  host: '127.0.0.1',
  port: 9749,
  url: null,
  startedAt: null,
  owner: null,
};

function invocation(text: string): CommandInvocation {
  return { sessionID: 'session-cbm', prompt: { text }, delivery: 'steer' };
}

/** 让 fire-and-forget 的异步续延跑完（install 成功后再触发 registerMcp）。 */
async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** 由 CbmCommandHandlers 的部分覆盖构造 spy 化命令，便于断言 reply。 */
function makeCbmDeps(overrides: Partial<CbmCommandHandlers> = {}) {
  const replies: string[] = [];
  const handlers: CbmCommandHandlers = {
    reply: async (text) => {
      replies.push(text);
    },
    ...overrides,
  };
  const command = createCbmCommand(handlers);
  return { command, handlers, replies };
}

function findCbm(commands: CommandDefinition[]): CommandDefinition {
  const command = commands.find((c) => c.name === 'cbm');
  expect(command).toBeDefined();
  return command as CommandDefinition;
}

describe('createCbmCommand 聚合契约', () => {
  test('返回名为 cbm 且带 description/execute 的定义', () => {
    const { command } = makeCbmDeps();
    expect(command.name).toBe('cbm');
    expect(typeof command.description).toBe('string');
    expect(command.description!.length).toBeGreaterThan(0);
    expect(typeof command.execute).toBe('function');
  });
});

describe('/cbm status（空子命令默认 status）', () => {
  const uiRunning: UiStatus = {
    running: true,
    pid: 42,
    host: '127.0.0.1',
    port: 9749,
    url: 'http://127.0.0.1:9749',
    startedAt: 1,
    owner: 'opencode-oceanus',
  };

  test('空子命令默认执行 status，报告安装与 UI 状态', async () => {
    const { command, replies } = makeCbmDeps({
      getInstallStatus: () => ({
        installed: true,
        binaryPath: '/cache/bin',
        version: '0.10.8',
        platform: 'linux-x64',
      }),
      getUiStatus: () => uiRunning,
    });
    await command.execute(invocation(''));
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatch(/installed|安装/i);
    expect(replies[0]).toMatch(/0\.10\.8/);
    expect(replies[0]).toMatch(/http:\/\/127\.0\.0\.1:9749/);
  });

  test('status 不安装任何依赖，也未注入 UI 时仍能回写', async () => {
    const { command, replies } = makeCbmDeps({
      getInstallStatus: () => ({ installed: false }),
    });
    await command.execute(invocation('status'));
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatch(/installed|no/i);
  });
});

describe('/cbm install（后台非阻塞）', () => {
  test('install 传入冲突 cacheRoot 时由共享入口保持同一 root', async () => {
    const seen: string[] = [];
    const { command } = makeCbmDeps({
      getCacheRoot: () => '/shared/cbm',
      startBackgroundInstall: async (opts) => { seen.push(opts?.cacheRoot ?? ''); return null; },
    });
    await command.execute(invocation('install'));
    expect(seen).toEqual(['/shared/cbm']);
  });
  test('立即回写"后台启动"，安装完成前不触发 registerMcp', async () => {
    let resolveInstall!: (bin: string | null) => void;
    const installPromise = new Promise<string | null>((resolve) => {
      resolveInstall = resolve;
    });
    let installCalls = 0;
    let registerCalls = 0;

    const { command, replies } = makeCbmDeps({
      startBackgroundInstall: () => {
        installCalls += 1;
        return installPromise;
      },
      registerMcp: async () => {
        registerCalls += 1;
        return {} as never;
      },
    });

    const done = command.execute(invocation('install'));
    expect(installCalls).toBe(1);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatch(/后台/);
    // 非阻塞：此时安装尚未完成，registerMcp 不应被调用，execute 应可 resolve。
    await done;
    expect(registerCalls).toBe(0);

    // 安装完成后，fire-and-forget 续延触发 registerMcp。
    resolveInstall('/cache/bin');
    await flushAsync();
    expect(registerCalls).toBe(1);
  });

  test('缺少 startBackgroundInstall 依赖时 fail-open 回写，不抛异常', async () => {
    const { command, replies } = makeCbmDeps({});
    await expect(command.execute(invocation('install'))).resolves.toBeUndefined();
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatch(/不可用|失败/i);
  });
});

describe('/cbm repair', () => {
  test('等待 repair 完成并回写二进制路径，成功后触发 registerMcp', async () => {
    let registerCalls = 0;
    const { command, replies } = makeCbmDeps({
      repair: async () => '/cache/bin',
      registerMcp: async () => {
        registerCalls += 1;
        return {} as never;
      },
    });
    await command.execute(invocation('repair'));
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatch(/修复/i);
    expect(replies[0]).toMatch(/cache\/bin/);
    expect(registerCalls).toBe(1);
  });

  test('repair 返回 null 时回写失败消息，不抛异常', async () => {
    const { command, replies } = makeCbmDeps({ repair: async () => null });
    await expect(command.execute(invocation('repair'))).resolves.toBeUndefined();
    expect(replies[0]).toMatch(/失败/i);
  });

  test('repair 抛错时 fail-open 回写，不抛异常', async () => {
    const { command, replies } = makeCbmDeps({
      repair: async () => {
        throw new Error('repair boom');
      },
    });
    await expect(command.execute(invocation('repair'))).resolves.toBeUndefined();
    expect(replies[0]).toMatch(/failed|失败/i);
  });
});

describe('/cbm index', () => {
  test('调用 indexer.ensureIndexed 并回写索引结果', async () => {
    const { command, replies } = makeCbmDeps({
      indexer: {
        ensureIndexed: async (): Promise<IndexerOutcome> => ({ kind: 'indexed' }),
      } as never,
    });
    await command.execute(invocation('index'));
    expect(replies[0]).toMatch(/索引/i);
  });

  test('index_started 与 degraded 都被回写', async () => {
    const started = makeCbmDeps({
      indexer: {
        ensureIndexed: async (): Promise<IndexerOutcome> => ({ kind: 'index_started' }),
      } as never,
    });
    await started.command.execute(invocation('index'));
    expect(started.replies[0]).toMatch(/索引/i);

    const degraded = makeCbmDeps({
      indexer: {
        ensureIndexed: async (): Promise<IndexerOutcome> => ({
          kind: 'degraded',
          reason: 'index_failed',
          message: 'boom',
        }),
      } as never,
    });
    await degraded.command.execute(invocation('index'));
    expect(degraded.replies[0]).toMatch(/降级|失败/i);
  });

  test('缺少 indexer 依赖时 fail-open 回写', async () => {
    const { command, replies } = makeCbmDeps({});
    await expect(command.execute(invocation('index'))).resolves.toBeUndefined();
    expect(replies[0]).toMatch(/不可用|失败/i);
  });
});

describe('/cbm ui 与 ui stop', () => {
  const uiRunning: UiStatus = {
    running: true,
    pid: 7,
    host: '127.0.0.1',
    port: 9749,
    url: 'http://127.0.0.1:9749',
    startedAt: 2,
    owner: 'opencode-oceanus',
  };

  test('ui 启动并回写 URL', async () => {
    const { command, replies } = makeCbmDeps({
      startUi: async () => uiRunning,
    });
    await command.execute(invocation('ui'));
    expect(replies[0]).toMatch(/9749|running/i);
  });

  test('ui 启动抛错时 fail-open 回写', async () => {
    const { command, replies } = makeCbmDeps({
      startUi: async () => {
        throw new Error('port in use');
      },
    });
    await expect(command.execute(invocation('ui'))).resolves.toBeUndefined();
    expect(replies[0]).toMatch(/failed|失败/i);
  });

  test('ui stop 调用 stopUi 并回写已停止', async () => {
    const { command, replies } = makeCbmDeps({ stopUi: () => idleStatus });
    await command.execute(invocation('ui stop'));
    expect(replies[0]).toMatch(/停止/i);
  });
});

describe('/cbm uninstall', () => {
  test('只移除 Oceanus 管理资源：stopUi + removeMcp，不删除源码/用户索引', async () => {
    const stopped = { calls: 0 };
    const removed = { calls: 0 };
    const { command, replies } = makeCbmDeps({
      stopUi: () => {
        stopped.calls += 1;
        return idleStatus;
      },
      removeMcp: async () => {
        removed.calls += 1;
        return true;
      },
    });
    await command.execute(invocation('uninstall'));
    expect(stopped.calls).toBe(1);
    expect(removed.calls).toBe(1);
    expect(replies[0]).toMatch(/卸载|Oceanus/i);
  });

  test('无可移除资源时回写提示，且明确不删除用户索引', async () => {
    const { command, replies } = makeCbmDeps({
      removeMcp: async () => false,
    });
    await command.execute(invocation('uninstall'));
    expect(replies[0]).toMatch(/未删除|用户索引/i);
  });

  test('removeMcp 抛错时 fail-open 回写，不抛异常', async () => {
    const { command, replies } = makeCbmDeps({
      removeMcp: async () => {
        throw new Error('rm boom');
      },
    });
    await expect(command.execute(invocation('uninstall'))).resolves.toBeUndefined();
    expect(replies[0]).toMatch(/failed|失败/i);
  });
});

describe('/cbm 未知子命令与兜底 fail-open', () => {
  test('未知子命令回写错误，不抛异常', async () => {
    const { command, replies } = makeCbmDeps({});
    await expect(command.execute(invocation('bogus'))).resolves.toBeUndefined();
    expect(replies[0]).toMatch(/未知|bogus/i);
  });

  test('status 的同步 handler 抛错时 fail-open 回写', async () => {
    const { command, replies } = makeCbmDeps({
      getUiStatus: () => {
        throw new Error('ui boom');
      },
    });
    await expect(command.execute(invocation('status'))).resolves.toBeUndefined();
    expect(replies[0]).toMatch(/failed|失败/i);
  });
});
