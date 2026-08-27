import type { SessionLike } from './types';

/** 终态通知父 session；宿主缺少 prompt 或通知失败时降级为静默。 */
export async function notifyTerminalTask(
  session: SessionLike,
  parentSessionId: string,
  taskId: string,
  status: string,
  text?: string,
): Promise<boolean> {
  try {
    const prompt = (session as SessionLike & { prompt?: (input: any) => Promise<unknown> }).prompt;
    if (typeof prompt !== 'function') return false;
    await prompt.call(session, {
      sessionID: parentSessionId,
      text: `[task ${taskId}] 已进入终态: ${status}${text ? `\n${text}` : ''}`,
      delivery: 'queue',
    });
    return true;
  } catch {
    return false;
  }
}
