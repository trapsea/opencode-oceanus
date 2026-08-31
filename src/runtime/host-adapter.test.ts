/**
 * host-adapter 测试：宿主运行时表面契约锁定（Wave 1，测试先行）。
 *
 * 锁定的运行时契约（不依赖 `@opencode-ai/plugin` beta-18230 未声明的字段）：
 * - 插件实例目录解析 `resolvePluginDirectory`：
 *   1. `ctx.location.directory` 非空字符串优先（新宿主多项目 scope 注入）；
 *   2. 旧 `ctx.directory` 非空字符串兜底兼容（omo-slim 参考实现）；
 *   3. 两者均缺失/为空时回退 `process.cwd()`（或显式 fallback）。
 * - `SessionLike.get` 使用对象参数 `{ sessionID }`（v2 持久 API 契约）；
 * - `sessionActive` 在宿主未暴露 `active()` 或调用失败时 fail-open（undefined，
 *   绝不伪造布尔值）；
 * - `resolveWorkspaceRoot` 仅返回 session `location.directory` 或 null，
 *   绝不回退 cwd；cwd 回退只属于 `resolveWorkspaceRootOrCwd`。
 */
import { describe, expect, test } from 'bun:test';
import { resolvePluginDirectory } from './host-adapter';
import {
  getSessionInfo,
  resolveWorkspaceRoot,
  resolveWorkspaceRootOrCwd,
  sessionActive,
} from './workspace';
import type { SessionLike } from './types';

// ─────────────────────────── 插件实例目录解析 ───────────────────────────

describe('resolvePluginDirectory：ctx.location.directory 非空优先', () => {
  test('新宿主 location.directory 优先于旧 ctx.directory', () => {
    expect(
      resolvePluginDirectory({
        location: { directory: '/host/project-a' },
        directory: '/legacy/project-b',
      }),
    ).toBe('/host/project-a');
  });

  test('location.directory 为空字符串时不生效，回退旧 ctx.directory', () => {
    expect(
      resolvePluginDirectory({
        location: { directory: '' },
        directory: '/legacy/project-b',
      }),
    ).toBe('/legacy/project-b');
  });

  test('location 存在但 directory 缺失时回退旧 ctx.directory', () => {
    expect(
      resolvePluginDirectory({
        location: {},
        directory: '/legacy/project-b',
      }),
    ).toBe('/legacy/project-b');
  });
});

describe('resolvePluginDirectory：旧 ctx.directory 兼容', () => {
  test('仅提供旧 ctx.directory 时正常解析', () => {
    expect(resolvePluginDirectory({ directory: '/legacy/project-b' })).toBe(
      '/legacy/project-b',
    );
  });

  test('旧 ctx.directory 为空字符串时不生效，回退 cwd', () => {
    expect(resolvePluginDirectory({ directory: '' })).toBe(process.cwd());
  });
});

describe('resolvePluginDirectory：空值回退 process.cwd', () => {
  test('location 与 directory 均缺失时回退 process.cwd()', () => {
    expect(resolvePluginDirectory({})).toBe(process.cwd());
  });

  test('两者均为空字符串时回退 process.cwd()', () => {
    expect(
      resolvePluginDirectory({ location: { directory: '' }, directory: '' }),
    ).toBe(process.cwd());
  });

  test('调用方可显式指定 fallback', () => {
    expect(resolvePluginDirectory({}, '/explicit/fallback')).toBe(
      '/explicit/fallback',
    );
  });

  test('非字符串值不生效，回退显式 fallback', () => {
    expect(
      resolvePluginDirectory({
        location: { directory: 42 as unknown as string },
        directory: null as unknown as string,
      }, '/explicit/fallback'),
    ).toBe('/explicit/fallback');
  });
});

// ─────────────────────────── 宿主 session API 契约 ───────────────────────────

describe('宿主 session API 契约锁定', () => {
  test('session.get 以对象参数 { sessionID } 调用（v2 持久 API）', async () => {
    const calls: unknown[] = [];
    const session: SessionLike = {
      get: async (input) => {
        calls.push(input);
        return { id: input.sessionID, location: { directory: '/repo/app' } };
      },
    };
    expect(await resolveWorkspaceRoot(session, 'ses_obj_1')).toBe('/repo/app');
    expect(calls).toEqual([{ sessionID: 'ses_obj_1' }]);
  });

  test('getSessionInfo：get 缺失或抛错一律返回 undefined（fail-open）', async () => {
    expect(await getSessionInfo({} as SessionLike, 's1')).toBeUndefined();
    expect(
      await getSessionInfo(
        { get: async () => { throw new Error('host down'); } },
        's1',
      ),
    ).toBeUndefined();
  });

  test('resolveWorkspaceRoot：location.directory 缺失/为空时返回 null（绝不回退 cwd）', async () => {
    const noLocation: SessionLike = { get: async () => ({ id: 's1' }) };
    expect(await resolveWorkspaceRoot(noLocation, 's1')).toBeNull();
    const emptyDirectory: SessionLike = {
      get: async () => ({ id: 's1', location: { directory: '' } }),
    };
    expect(await resolveWorkspaceRoot(emptyDirectory, 's1')).toBeNull();
  });

  test('resolveWorkspaceRootOrCwd：仅此入口回退 cwd / 显式 fallback', async () => {
    const session: SessionLike = { get: async () => undefined };
    expect(await resolveWorkspaceRootOrCwd(session, 's1')).toBe(process.cwd());
    expect(await resolveWorkspaceRootOrCwd(session, 's1', '/custom/fallback')).toBe(
      '/custom/fallback',
    );
  });

  test('sessionActive：宿主未暴露 active() 时返回 undefined（fail-open）', async () => {
    const session: SessionLike = { get: async () => undefined };
    expect(await sessionActive(session, 's1')).toBeUndefined();
  });

  test('sessionActive：active() 抛错时返回 undefined（fail-open）', async () => {
    const session: SessionLike = {
      get: async () => undefined,
      active: async () => {
        throw new Error('active unavailable');
      },
    };
    expect(await sessionActive(session, 's1')).toBeUndefined();
  });
});
