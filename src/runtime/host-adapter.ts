/**
 * 宿主运行时表面适配（Wave 1：插件实例目录解析集中化）。
 *
 * 背景：`@opencode-ai/plugin`（beta-18230）的 `Context` 类型尚未声明
 * `location` / `directory` 字段，但宿主运行时存在两种注入形态：
 * - 新宿主（service 多项目模式，按项目 scope 实例化插件）：`ctx.location.directory`，
 *   与 `Session.Info.location.directory` 同源的绝对路径；
 * - 旧宿主/参考实现（omo-slim）：`ctx.directory`。
 *
 * 契约（由 host-adapter.test.ts 锁定）：
 * 1. `ctx.location.directory` 非空字符串优先；
 * 2. 旧 `ctx.directory` 非空字符串兜底兼容；
 * 3. 两者均缺失或为空时回退 `process.cwd()`（或调用方显式 fallback）。
 *
 * 本函数是同步纯函数，不做任何宿主调用、不抛异常，绝不伪造宿主行为。
 */
import type { PluginSetupContext } from './types';

/**
 * 解析当前插件实例绑定的项目目录。
 * 无法从 ctx 解析出非空目录时返回 fallback（默认 `process.cwd()`）。
 */
export function resolvePluginDirectory(
  ctx: Pick<PluginSetupContext, 'location' | 'directory'>,
  fallback: string = process.cwd(),
): string {
  const fromLocation = ctx.location?.directory;
  if (typeof fromLocation === 'string' && fromLocation.length > 0) {
    return fromLocation;
  }
  const legacy = ctx.directory;
  if (typeof legacy === 'string' && legacy.length > 0) {
    return legacy;
  }
  return fallback;
}
