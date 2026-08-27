/** v2 能力适配器：只暴露宿主 v2 已定义的 session API。 */
import type { SessionLike } from './types';

export type CapabilityOutcome = 'delivered' | 'unsupported' | 'queued_not_delivered' | 'malformed' | 'timeout' | 'uncertain';

export async function interruptV2(session: SessionLike, sessionID: string): Promise<CapabilityOutcome> {
  if (typeof session.interrupt !== 'function') return 'unsupported';
  try {
    const result = await session.interrupt({ sessionID, continue: false });
    return result === undefined || result.interrupted !== false ? 'delivered' : 'uncertain';
  } catch (e: any) {
    const text = String(e?.message ?? e).toLowerCase();
    return text.includes('timeout') ? 'timeout' : 'uncertain';
  }
}

export async function inspectV2(session: SessionLike, sessionID: string) {
  if (typeof session.get !== 'function') return { outcome: 'unsupported' as CapabilityOutcome };
  try { return { outcome: 'delivered' as CapabilityOutcome, info: await session.get({ sessionID }) }; }
  catch { return { outcome: 'uncertain' as CapabilityOutcome }; }
}

export function isUncertain(outcome: CapabilityOutcome): boolean {
  return ['unsupported', 'queued_not_delivered', 'malformed', 'timeout', 'uncertain'].includes(outcome);
}

/**
 * 会话续用/投递能力适配器（`task_revive` / `task_message` 的真实 v2 后端）。
 *
 * 不依赖不存在的 `session.resumeChild` / `session.sendMessage`，而是用 v2 文档化的
 * `session.prompt`（向既有会话追加用户输入）+ `session.wait`（等待会话结束）实现续用。
 *
 * 语义边界（诚实 fail-open，不把"请求被宿主接受"当成"续用成功"）：
 * - `resumeChild`：prompt 后 wait，再 `session.get` 读取 outcome 验证；无法验证时
 *   只报 `ok:true, status:'delivered'`（已投递/已入队），不伪造终态。
 * - `sendMessage`：仅入队投递，返回 `queued`，不声称子 agent 已收到/已执行。
 * - 宿主缺 `prompt` / `wait`，或调用失败/超时，返回 `{ ok:false, reason }`。
 */
export interface SessionResumeAdapter {
  resumeChild(input: {
    childSessionId: string;
    brief: string;
    generation: number;
  }): Promise<
    | { ok: true; status: 'succeeded' | 'failed' | 'interrupted' | 'delivered' | 'unknown' }
    | { ok: false; reason: string }
  >;
  sendMessage(input: {
    childSessionId: string;
    message: string;
  }): Promise<{ ok: true; status: 'queued' } | { ok: false; reason: string }>;
}

/** 把异常分类为稳定的 reason。 */
function classifyReason(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const text = raw.toLowerCase();
  return text.includes('timeout') || text.includes('timed out') ? 'timeout' : raw;
}

export function createV2SessionAdapter(session: SessionLike): SessionResumeAdapter {
  const hasPrompt = typeof session.prompt === 'function';
  const hasWait = typeof session.wait === 'function';
  return {
    async resumeChild({ childSessionId, brief }) {
      if (!childSessionId) return { ok: false, reason: 'missing_child_session' };
      if (!hasPrompt || !hasWait) return { ok: false, reason: 'unsupported' };
      try {
        await session.prompt!({ sessionID: childSessionId, text: brief, delivery: 'queue' });
        await session.wait!({ sessionID: childSessionId });
        // 续用是否真正到达终态只能通过 session.get 验证；拿不到 outcome 时不伪造。
        try {
          const info = await session.get({ sessionID: childSessionId });
          const outcome = (info as { outcome?: 'succeeded' | 'failed' | 'interrupted' } | undefined)?.outcome;
          return outcome
            ? { ok: true, status: outcome }
            : { ok: true, status: 'delivered' };
        } catch {
          return { ok: true, status: 'delivered' };
        }
      } catch (e) {
        return { ok: false, reason: classifyReason(e) };
      }
    },
    async sendMessage({ childSessionId, message }) {
      if (!childSessionId) return { ok: false, reason: 'missing_child_session' };
      if (!hasPrompt) return { ok: false, reason: 'unsupported' };
      try {
        await session.prompt!({ sessionID: childSessionId, text: message, delivery: 'queue' });
        return { ok: true, status: 'queued' };
      } catch (e) {
        return { ok: false, reason: classifyReason(e) };
      }
    },
  };
}
