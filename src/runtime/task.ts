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
  // 宿主 interrupted：本地已显式 cancelled（用户 task_cancel）→ 保持 cancelled；
  // 否则为宿主被动中断（重启/模型失败）→ uncertain（未决可恢复），供 task_status/revive 识别续用。
  if (outcome === 'interrupted') {
    if (rec.status === 'cancelled') return { status: 'cancelled', source: 'host', verified: true };
    return { status: 'uncertain', source: 'host', verified: true };
  }

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

/**
 * 从单条消息记录中宽松提取文本（兼容 v2 宿主消息的多形态：
 * 顶层 text / parts:[{type:'text',text}] / content:[{text}]）。
 */
function pickMessageText(rec: Record<string, unknown>): string | undefined {
  if (typeof rec.text === 'string' && rec.text.trim().length > 0) return rec.text;
  for (const key of ['parts', 'content']) {
    const v = rec[key];
    if (!Array.isArray(v)) continue;
    const joined = v
      .map((seg) =>
        typeof seg === 'object' && seg !== null && typeof (seg as Record<string, unknown>).text === 'string'
          ? ((seg as Record<string, unknown>).text as string)
          : '',
      )
      .filter((s) => s.length > 0)
      .join('\n');
    if (joined.trim().length > 0) return joined;
  }
  return undefined;
}

/** 从消息数组倒序提取最后一条 assistant 消息文本（role 兼容顶层与 info.role）。 */
function extractLastAssistantText(messages: unknown): string | undefined {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (typeof m !== 'object' || m === null) continue;
    const rec = m as Record<string, unknown>;
    const role =
      typeof rec.role === 'string'
        ? rec.role
        : typeof rec.info === 'object' && rec.info !== null && typeof (rec.info as Record<string, unknown>).role === 'string'
          ? ((rec.info as Record<string, unknown>).role as string)
          : undefined;
    if (role !== 'assistant') continue;
    const text = pickMessageText(rec) ?? (typeof rec.info === 'object' && rec.info !== null ? pickMessageText(rec.info as Record<string, unknown>) : undefined);
    if (text) return text;
  }
  return undefined;
}

/**
 * 读取子会话最后一条 assistant 输出文本（task_revive / task_result 内容通道）。
 * 依赖宿主 `session.context`；未暴露或读取失败一律 fail-open 返回 undefined，
 * 绝不影响状态机语义。
 */
export async function readSessionLastAssistantText(
  session: SessionLike,
  sessionId: string | undefined,
  maxChars = 8000,
): Promise<string | undefined> {
  if (!sessionId) return undefined;
  if (typeof session.context !== 'function') return undefined;
  try {
    const messages = await session.context({ sessionID: sessionId });
    const text = extractLastAssistantText(messages);
    if (!text) return undefined;
    return text.length > maxChars ? text.slice(0, maxChars) : text;
  } catch {
    return undefined;
  }
}

export { isTerminalStatus };
