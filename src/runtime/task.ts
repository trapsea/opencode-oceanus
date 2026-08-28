/**
 * task 工具的 v2 session 宿主状态助手（native-session-orchestration）。
 *
 * - 执行事实源是 OpenCode V2 原生 session：active/get.outcome。
 * - 无法确认时返回 uncertain，绝不把未知状态伪装成完成。
 */
import { isTerminalStatus, type TaskStatus } from '../tools/task/types';
import {
  getSessionInfo,
  interruptSession,
  sessionActive,
  sessionOutcome,
} from './workspace';
import type { SessionLike } from './types';

/** 结合宿主事实解析后的任务状态视图。 */
export interface TaskHostStatus {
  status: TaskStatus;
  /** 'host' 表示来自 session.active/get.outcome；'local' 表示仅本地元数据。 */
  source: 'host' | 'local';
  /** 是否经过宿主确认。 */
  verified: boolean;
}

/**
 * 状态解析优先级：
 *   1. session.active() 存在该子 session → running（host）。
 *   2. session.get().outcome → succeeded/failed/interrupted（host）。
 *   3. 宿主无法确认 → 回退本地状态，verified:false，不伪装终态。
 */
export async function resolveTaskHostStatus(
  session: SessionLike,
  rec: { childSessionId?: string; status: TaskStatus },
): Promise<TaskHostStatus> {
  const childId = rec.childSessionId;
  if (!childId) return { status: rec.status, source: 'local', verified: false };

  const active = await sessionActive(session, childId);
  if (active === true) return { status: 'running', source: 'host', verified: true };

  const outcome = await sessionOutcome(session, childId);
  if (outcome === 'succeeded') return { status: 'completed', source: 'host', verified: true };
  if (outcome === 'failed') return { status: 'failed', source: 'host', verified: true };
  if (outcome === 'interrupted') return { status: 'cancelled', source: 'host', verified: true };

  return { status: rec.status, source: 'local', verified: false };
}

/** 取消后的宿主验证视图。 */
export interface TaskCancelVerification {
  interrupted: boolean;
  outcome?: 'succeeded' | 'failed' | 'interrupted' | undefined;
  activeNow?: boolean | undefined;
}

/** 取消任务：interrupt 子 session 后通过 get.outcome / active 验证。 */
export async function cancelChildSession(
  session: SessionLike,
  childSessionId: string,
): Promise<TaskCancelVerification> {
  const interrupted = await interruptSession(session, childSessionId);
  const outcome = await sessionOutcome(session, childSessionId);
  const activeNow = await sessionActive(session, childSessionId);
  return { interrupted, outcome, activeNow };
}

/** 读取会话 outcome（供 task_result 附加上下文）。 */
export async function readSessionOutcome(
  session: SessionLike,
  sessionId: string | undefined,
): Promise<string | undefined> {
  if (!sessionId) return undefined;
  const info = await getSessionInfo(session, sessionId);
  return info?.outcome;
}

export { isTerminalStatus };
