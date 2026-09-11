import { describe, expect, test } from 'bun:test';
import {
  discoverServiceAuth,
  hasNativePluginUpdate,
  hostPluginVersion,
  serviceRegistryPath,
  serviceRegistryPaths,
  updateViaHost,
  waitForHostVersion,
} from './host-update';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('host-update 桥接层', () => {
  test('注册文件候选：首选 server.json（当前宿主 daemon），兼容 service.json（历史版本）', () => {
    expect(serviceRegistryPath({ XDG_STATE_HOME: '/tmp/state' } as NodeJS.ProcessEnv)).toBe('/tmp/state/opencode/server.json');
    expect(serviceRegistryPaths({ XDG_STATE_HOME: '/tmp/state' } as NodeJS.ProcessEnv)).toEqual([
      '/tmp/state/opencode/server.json',
      '/tmp/state/opencode/service.json',
    ]);
    expect(serviceRegistryPath({} as NodeJS.ProcessEnv)).toContain(joinSep(['.local', 'state', 'opencode', 'server.json']));
  });

  test('discoverServiceAuth：当前宿主协议（server.json + 同目录 password 文件）优先', () => {
    const fs: Record<string, string> = {
      '/x/opencode/server.json': '{"url":"http://127.0.0.1:1","pid":123}',
      '/x/opencode/password': '  base64url-secret\n',
    };
    const read = (p: string) => {
      if (p in fs) return fs[p]!;
      throw new Error('ENOENT');
    };
    const info = discoverServiceAuth({ XDG_STATE_HOME: '/x' } as NodeJS.ProcessEnv, read);
    expect(info).toEqual({ url: 'http://127.0.0.1:1', password: 'base64url-secret' });
  });

  test('discoverServiceAuth：server.json 缺失时回退 service.json（旧协议 password 内联）', () => {
    const fs: Record<string, string> = {
      '/x/opencode/service.json': '{"url":"http://127.0.0.1:2","password":"inline-pw"}',
    };
    const read = (p: string) => {
      if (p in fs) return fs[p]!;
      throw new Error('ENOENT');
    };
    const info = discoverServiceAuth({ XDG_STATE_HOME: '/x' } as NodeJS.ProcessEnv, read);
    expect(info).toEqual({ url: 'http://127.0.0.1:2', password: 'inline-pw' });
  });

  test('discoverServiceAuth：无 password 文件时返回无密码注册（Basic 头省略）；非法与缺失返回 null', () => {
    const read = (p: string) => {
      if (p.endsWith('server.json')) return '{"url":"http://127.0.0.1:3"}';
      throw new Error('ENOENT');
    };
    expect(discoverServiceAuth({} as NodeJS.ProcessEnv, read)).toEqual({ url: 'http://127.0.0.1:3' });
    const ok = discoverServiceAuth({} as NodeJS.ProcessEnv, () => '{"url":"http://127.0.0.1:1","password":"pw"}');
    expect(ok).toEqual({ url: 'http://127.0.0.1:1', password: 'pw' });
    expect(discoverServiceAuth({} as NodeJS.ProcessEnv, () => 'not json')).toBe(null);
    expect(discoverServiceAuth({} as NodeJS.ProcessEnv, () => '{"password":"pw"}')).toBe(null);
    expect(discoverServiceAuth({} as NodeJS.ProcessEnv, () => { throw new Error('ENOENT') })).toBe(null);
  });

  test('hasNativePluginUpdate：仅当 ctx.plugin.update 为函数时为真', () => {
    expect(hasNativePluginUpdate({ plugin: { update: async () => {} } })).toBe(true);
    expect(hasNativePluginUpdate({ plugin: { list: async () => [] } })).toBe(false);
    expect(hasNativePluginUpdate({})).toBe(false);
    expect(hasNativePluginUpdate(undefined)).toBe(false);
  });

  test('updateViaHost：POST /api/plugin/update 携带 Basic 认证与 location 头；204 成功、400 失败、异常失败、无注册失败', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = (async (url: string | URL, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const auth = { url: 'http://127.0.0.1:49374/', password: 'pw' };
    await expect(updateViaHost('opencode-oceanus', '/work', { auth, fetcher })).resolves.toBe(true);
    expect(seen[0]!.url).toBe('http://127.0.0.1:49374/api/plugin/update');
    expect(seen[0]!.init.method).toBe('POST');
    const header = seen[0]!.init.headers as Record<string, string>;
    expect(header['x-opencode-directory']).toBe('/work');
    expect(header.authorization).toBe(`Basic ${Buffer.from('opencode:pw').toString('base64')}`);
    expect(String(seen[0]!.init.body)).toContain('"targets":["opencode-oceanus"]');

    const bad = (async () => json({ message: 'nope' }, 400)) as typeof fetch;
    await expect(updateViaHost('opencode-oceanus', '/work', { auth, fetcher: bad })).resolves.toBe(false);
    const throwing = (async () => { throw new Error('ECONNREFUSED') }) as typeof fetch;
    await expect(updateViaHost('opencode-oceanus', '/work', { auth, fetcher: throwing })).resolves.toBe(false);
    await expect(updateViaHost('opencode-oceanus', '/work', { auth: null, fetcher })).resolves.toBe(false);
  });

  test('hostPluginVersion：从 inventory 提取目标版本；未命中/失败返回 null', async () => {
    const fetcher = (async () => json({ data: [
      { id: 'other', source: { type: 'builtin' } },
      { id: 'opencode-oceanus', source: { type: 'package', target: 'opencode-oceanus', version: '0.37.0' } },
    ] })) as typeof fetch;
    await expect(hostPluginVersion('opencode-oceanus', '/work', { auth: { url: 'http://x' }, fetcher })).resolves.toBe('0.37.0');
    await expect(hostPluginVersion('opencode-oceanus@1.0.0', '/work', { auth: { url: 'http://x' }, fetcher })).resolves.toBe(null);
    await expect(hostPluginVersion('opencode-oceanus', '/work', { auth: null, fetcher })).resolves.toBe(null);
  });

  test('waitForHostVersion：版本追平返回 true；超时返回 false（时间注入，不真实等待）', async () => {
    let version = '0.36.0';
    const fetcher = (async () => json({ data: [{ source: { type: 'package', target: 'opencode-oceanus', version } }] })) as typeof fetch;
    const promise = waitForHostVersion('opencode-oceanus', '/work', '0.37.0', {
      auth: { url: 'http://x' }, fetcher, pollMs: 0, timeoutMs: 5,
      now: (() => { let t = 0; return () => (t += 1) })(),
    });
    setTimeout(() => { version = '0.37.0' }, 5);
    await expect(promise).resolves.toBe(true);

    const stale = (async () => json({ data: [{ source: { type: 'package', target: 'opencode-oceanus', version: '0.36.0' } }] })) as typeof fetch;
    await expect(waitForHostVersion('opencode-oceanus', '/work', '0.37.0', {
      auth: { url: 'http://x' }, fetcher: stale, pollMs: 0, timeoutMs: 5,
      now: (() => { let t = 0; return () => (t += 3) })(),
    })).resolves.toBe(false);
  });
});

function joinSep(parts: string[]): string { return parts.join('/') }
