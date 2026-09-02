import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { compareVersions } from './checker';

/**
 * 宿主原生 plugin.update 桥接层。
 *
 * 实测事实（宿主 beta-18866，openapi + HTTP 实证）：
 * - `POST /api/plugin/update {targets: string[]}` → 204 即收；宿主从 npm 拉最新、
 *   写入新时间戳缓存目录、并在其实例上原地热重载；配置不改写；旧目录保留。
 * - `targets` 必须匹配当前实例 inventory 的 target 原串（裸名），否则 400。
 * - pinned 入口宿主不跟踪（无 outdated）、也不能升级（update no-op）——只能自管。
 * - 插件上下文 `ctx.plugin` 只暴露 `list`，check/update 未对插件开放；
 *   因此当前走 HTTP 回环（service.json 发现 + Basic 认证），并对未来宿主
 *   开放 ctx.plugin.update 做探测式兼容（开放后自动优先走原生通道）。
 */

/** 宿主后台服务注册信息（~/.local/state/opencode/service.json），只读发现，不修改。 */
export interface HostServiceInfo { url: string; password?: string }

export interface HostUpdateDeps {
  auth?: HostServiceInfo | null;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  pollMs?: number;
}

export function serviceRegistryPath(env: NodeJS.ProcessEnv = process.env): string {
  const xdgState = env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  return join(xdgState, 'opencode', 'service.json');
}

/** 发现宿主后台服务（url + password）。读不到或结构非法返回 null，绝不抛错。 */
export function discoverServiceAuth(
  env: NodeJS.ProcessEnv = process.env,
  read: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): HostServiceInfo | null {
  try {
    const raw = JSON.parse(read(serviceRegistryPath(env)));
    if (typeof raw?.url !== 'string' || raw.url.length === 0) return null;
    if (raw.password !== undefined && typeof raw.password !== 'string') return null;
    return { url: raw.url, password: raw.password };
  } catch { return null }
}

/** ctx.plugin 是否直接暴露原生 update（未来宿主开放即自动启用）。 */
export function hasNativePluginUpdate(ctx: unknown): boolean {
  const plugin = (ctx as { plugin?: { update?: unknown } } | undefined)?.plugin;
  return typeof plugin?.update === 'function';
}

function authHeaders(auth: HostServiceInfo): Record<string, string> {
  if (!auth.password) return {};
  // 与 @opencode-ai/client 的服务发现一致：Basic opencode:<password>。
  return { authorization: `Basic ${Buffer.from(`opencode:${auth.password}`).toString('base64')}` };
}

function endpoint(auth: HostServiceInfo, path: string): string {
  return `${auth.url.replace(/\/+$/, '')}${path}`;
}

/**
 * 通过宿主 HTTP API 原地更新插件（仅裸名 target；pinned 由调用方走自管安装）。
 * 任何失败（无服务注册/网络/非 2xx/超时）返回 false 且不抛错，由调用方回退。
 * deps.auth 显式传 null 表示"禁止服务发现"（测试隔离用），undefined 才走默认发现。
 */
export async function updateViaHost(target: string, directory: string, deps: HostUpdateDeps = {}): Promise<boolean> {
  const auth = deps.auth === undefined ? discoverServiceAuth() : deps.auth;
  if (!auth) return false;
  try {
    const response = await (deps.fetcher ?? fetch)(endpoint(auth, '/api/plugin/update'), {
      method: 'POST',
      signal: AbortSignal.timeout(deps.timeoutMs ?? 30_000),
      headers: { 'content-type': 'application/json', 'x-opencode-directory': directory, ...authHeaders(auth) },
      body: JSON.stringify({ targets: [target] }),
    });
    return response.ok;
  } catch { return false }
}

interface HostPluginInfo { source?: { type?: string; target?: string; version?: string } }

/** 读取宿主 inventory 中目标插件的当前版本（带 location 头）；失败返回 null。 */
export async function hostPluginVersion(target: string, directory: string, deps: HostUpdateDeps = {}): Promise<string | null> {
  const auth = deps.auth === undefined ? discoverServiceAuth() : deps.auth;
  if (!auth) return null;
  try {
    const response = await (deps.fetcher ?? fetch)(endpoint(auth, '/api/plugin'), {
      signal: AbortSignal.timeout(deps.timeoutMs ?? 8_000),
      headers: { 'x-opencode-directory': directory, ...authHeaders(auth) },
    });
    if (!response.ok) return null;
    const payload = await response.json() as { data?: HostPluginInfo[] };
    const hit = payload?.data?.find((p) => p?.source?.type === 'package' && p.source.target === target);
    return typeof hit?.source?.version === 'string' ? hit.source.version : null;
  } catch { return null }
}

/**
 * 204 即收后轮询宿主 inventory，确认热重载是否已把版本推进到 expectAtLeast。
 * 注意：若 service.json 指向的就是本插件所在实例，热重载会中断本函数所在的上层
 * 调用链（状态文件可能停留在 checking，无害）；因此调用方不得依赖本函数的返回
 * 做关键路径动作，仅用于决定日志提示语。
 */
export async function waitForHostVersion(
  target: string,
  directory: string,
  expectAtLeast: string,
  deps: HostUpdateDeps = {},
): Promise<boolean> {
  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.timeoutMs ?? 20_000);
  const pollMs = deps.pollMs ?? 2_000;
  for (;;) {
    const version = await hostPluginVersion(target, directory, deps);
    if (version && compareVersions(version, expectAtLeast) >= 0) return true;
    if (now() + pollMs > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
