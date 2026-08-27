/**
 * task 三件套的 v2 session 集成（tooling-9-v2-wiring）。
 *
 * - registry 只作受插件管理子任务的本地索引（id / 父子 ownership / 状态 / 时间）。
 * - 状态读取优先取宿主事实（`active` / `get.outcome`），无法确认时回退 registry，
 *   但绝不把未知状态伪装成完成。
 * - task_result 只读已完成任务；task_cancel 用 `session.interrupt` 后验证结果，
 *   并校验 parentID/childID ownership（由 registry 自身 + 入参交叉校验）。
 */
import { TaskRegistry } from '../tools/task/registry';
import type { TaskRecord, TaskStatus } from '../tools/task/types';
import {
  getSessionInfo,
  interruptSession,
  sessionActive,
  sessionOutcome,
} from './workspace';
import type { SessionLike } from './types';

/** 进程级共享的 task registry 单例。 */
let singleton: TaskRegistry | undefined;

export function getTaskRegistry(): TaskRegistry {
  if (!singleton) singleton = new TaskRegistry();
  return singleton;
}

/** 测试缝隙：重置单例（不影响其它模块）。 */
export function resetTaskRegistry(): void {
  singleton = undefined;
}

/** 结合宿主事实解析后的任务状态视图。 */
export interface TaskHostStatus {
  status: TaskStatus;
  /** 'host' 表示来自 session.active/get.outcome；'registry' 表示仅本地索引。 */
  source: 'host' | 'registry';
  /** 是否经过宿主确认。 */
  verified: boolean;
  /** T5：宿主确认 → authoritative；无法确认 → uncertain，绝不伪装终态。 */
  certainty: 'authoritative' | 'uncertain';
}

/**
 * 任务状态解析优先级：
 *   1. session.active() 存在该子 session → running（host）。
 *   2. session.get().outcome → succeeded/failed/interrupted（host）。
 *   3. 宿主无法确认 → 回退 registry 状态，`verified:false`，绝不伪装完成。
 */
export async function resolveTaskHostStatus(
  session: SessionLike,
  rec: TaskRecord,
): Promise<TaskHostStatus> {
  const childId = rec.childSessionId;
  if (!childId) return { status: rec.status, source: 'registry', verified: false, certainty: 'uncertain' };

  const active = await sessionActive(session, childId);
  if (active === true) return { status: 'running', source: 'host', verified: true, certainty: 'authoritative' };

  const outcome = await sessionOutcome(session, childId);
  if (outcome === 'succeeded') return { status: 'completed', source: 'host', verified: true, certainty: 'authoritative' };
  if (outcome === 'failed') return { status: 'failed', source: 'host', verified: true, certainty: 'authoritative' };
  if (outcome === 'interrupted') return { status: 'cancelled', source: 'host', verified: true, certainty: 'authoritative' };

  return { status: rec.status, source: 'registry', verified: false, certainty: 'uncertain' };
}

/** 取消后的宿主验证视图。 */
export interface TaskCancelVerification {
  interrupted: boolean;
  outcome?: 'succeeded' | 'failed' | 'interrupted' | undefined;
  activeNow?: boolean | undefined;
}

/**
 * 取消任务：interrupt 子 session 后通过 get.outcome / active 验证。
 * 返回 null 表示没有可中断的子 session。
 */
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
