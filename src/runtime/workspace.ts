/**
 * 工作区根目录解析与会话状态探测（tooling-9-v2-wiring）。
 *
 * 全部返回 null/undefined 表示"无法确认"，绝不在缺失信息时伪造宿主行为。
 * - 工作区根目录：`session.get({sessionID}) → location.directory`（绝对路径），
 *   作为 AST 工具的路径校验 workspace root。
 * - 会话活跃度：优先运行时探测 `session.active()`，缺省回退（返回 undefined）。
 * - 会话结果：`session.get({sessionID}) → outcome`。
 * - 中断：`session.interrupt({sessionID})`，返回是否成功置为中断。
 */
import type { SessionInfoLike, SessionLike } from './types';

/** 读取会话信息；失败或缺失一律返回 undefined。 */
export async function getSessionInfo(
  session: SessionLike,
  sessionID: string,
): Promise<SessionInfoLike | undefined> {
  try {
    if (typeof session.get !== 'function') return undefined;
    const info = await session.get({ sessionID });
    return info as SessionInfoLike | undefined;
  } catch {
    return undefined;
  }
}

/**
 * 解析 v2 sessionID 对应的工作区根目录。
 * 无法解析（get 失败、location.directory 缺失）返回 null；需要回退时由调用方使用
 * resolveWorkspaceRootOrCwd，避免改变既有路径校验语义。
 */
export async function resolveWorkspaceRoot(
  session: SessionLike,
  sessionID: string,
): Promise<string | null> {
  const info = await getSessionInfo(session, sessionID);
  const directory = info?.location?.directory;
  return typeof directory === 'string' && directory.length > 0 ? directory : null;
}

/** 仅供需要继续运行的入口显式使用 cwd 回退。 */
export async function resolveWorkspaceRootOrCwd(
  session: SessionLike,
  sessionID: string,
  fallback = process.cwd(),
): Promise<string> {
  return (await resolveWorkspaceRoot(session, sessionID)) ?? fallback;
}

/**
 * 会话是否正在运行。
 * 仅当宿主暴露 `active()` 且明确存在该 session 时才返回 true/false；
 * 能力不可用或调用失败返回 undefined。
 */
export async function sessionActive(
  session: SessionLike,
  sessionID: string,
): Promise<boolean | undefined> {
  if (typeof session.active !== 'function') return undefined;
  try {
    const output = await session.active();
    const map: Record<string, unknown> | undefined =
      (output as { data?: Record<string, unknown> })?.data ??
      (output as Record<string, unknown> | undefined) ??
      undefined;
    return map ? map[sessionID] != null : undefined;
  } catch {
    return undefined;
  }
}

/** 会话最后一次执行的结果（succeeded / failed / interrupted）。 */
export async function sessionOutcome(
  session: SessionLike,
  sessionID: string,
): Promise<SessionInfoLike['outcome'] | undefined> {
  const info = await getSessionInfo(session, sessionID);
  return info?.outcome;
}

/**
 * 中断会话。仅当宿主暴露 `interrupt()` 时执行，并传入 `continue: false`。
 * - 正常返回（void 或 `{ interrupted: true | undefined }`）视为成功；
 * - 显式 `{ interrupted: false }` 视为失败；
 * - 异常或宿主未暴露 `interrupt()` 视为失败。
 */
export async function interruptSession(
  session: SessionLike,
  sessionID: string,
): Promise<boolean> {
  if (typeof session.interrupt !== 'function') return false;
  try {
    const res = await session.interrupt({ sessionID, continue: false });
    // void（官方契约）或无显式对象：成功；仅当显式 interrupted === false 才失败。
    if (res === undefined || res === null) return true;
    return res.interrupted !== false;
  } catch {
    return false;
  }
}
