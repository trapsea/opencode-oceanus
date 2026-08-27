import type { ToolDefinition, ToolContextLike } from '../../runtime/types';
import type { JobBoard } from './job-board';
import { JobBoardAccessError, JobBoardCasError } from './job-board';

const MAX_BYTES = 8192, LIMIT = 32, MAX_ATTEMPTS = 3, TTL = 24 * 60 * 60 * 1000;
const bytes = (s: string) => new TextEncoder().encode(s).byteLength;
const result = (x: unknown) => ({ content: JSON.stringify(x) });

/** T4 消息契约：outbox 记录（写入 JobBoard task.messages，跨重启保留）。 */
export interface TaskMessageRecord {
  sequence: number; key: string; message: string;
  parentSessionId: string; childSessionId: string; generation: number;
  state: 'pending' | 'delivered' | 'uncertain'; attempts: number;
  error?: string; createdAt: number; updatedAt: number;
}

type SendCapability = {
  sendMessage?(input: { childSessionId: string; message: string; generation?: number }): Promise<{ ok: boolean; reason?: string; status?: string }>;
};

/** 内存 fallback（无 board 宿主），结构与持久化记录一致。 */
const store = new Map<string, TaskMessageRecord[]>();

function sendOnce(session: SendCapability | undefined, input: { childSessionId: string; message: string; generation?: number }): Promise<{ ok: boolean; reason?: string }> {
  if (!session || typeof session.sendMessage !== 'function') return Promise.resolve({ ok: false, reason: 'no_delivery_capability' });
  return session.sendMessage(input).then(
    (r) => (r && (r as any).ok === false ? { ok: false, reason: r.reason ?? 'send_failed' } : { ok: true }),
    (e: unknown) => ({ ok: false, reason: String((e as any)?.message ?? e) }),
  );
}

export function buildTaskMessageTool(board?: JobBoard, session?: SendCapability): ToolDefinition {
  return {
    name: 'task_message',
    description: '向运行中的子任务发送或读取消息（写入 taskId+message+idempotencyKey；读取只需 taskId；retryKey 显式重试 pending/uncertain）',
    input: { type: 'object' },
    async execute(input: any, ctx: ToolContextLike) {
      const id = String(input?.taskId ?? '');
      if (!id) return result({ error: 'taskId 必填' });
      if (board) return boardMode(board, session, input, id, ctx);
      return memoryMode(session, input, id, ctx);
    },
  };
}

async function boardMode(board: JobBoard, session: SendCapability | undefined, input: any, id: string, ctx: ToolContextLike) {
  const now = Date.now();
  try {
    let task: any = board.get(id);
    if (task.parent_session_id !== ctx.sessionID) return result({ error: 'PARENT_OWNERSHIP' });

    // 读取模式：只需 taskId
    if (input?.message === undefined && !input?.retryKey) {
      const list = (task.messages ?? []).filter((m: any) => now - (m.createdAt ?? m.at ?? 0) < TTL);
      return result({ messages: list.slice(-(input?.limit ?? LIMIT)) });
    }

    // 显式重试模式：只处理 pending/uncertain
    if (input?.retryKey !== undefined) {
      const key = String(input.retryKey);
      const existing = (task.messages ?? []).find((m: any) => m.key === key);
      if (!existing) return result({ error: 'MESSAGE_NOT_FOUND' });
      if (existing.state === 'delivered') return result(existing);
      if (existing.attempts >= MAX_ATTEMPTS) return result({ ...existing, error: 'RETRY_LIMIT' });
      return result(await attemptDelivery(board, session, id, key, existing.message, task));
    }

    // 写入模式：taskId + message + idempotencyKey
    const key = input?.idempotencyKey;
    if (!key || typeof key !== 'string') return result({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
    const message = input?.message;
    if (!message || typeof message !== 'string' || bytes(message) > MAX_BYTES) return result({ error: 'MESSAGE_SIZE' });

    // 幂等：同 key 直接返回既有记录，不重复发送
    const existing = (task.messages ?? []).find((m: any) => m.key === key);
    if (existing) return result(existing);

    // 写 outbox 前的边界拒绝
    if (input?.expectedGeneration !== undefined && input.expectedGeneration !== task.generation) return result({ error: 'GENERATION_CONFLICT' });
    if (task.state !== 'running') return result({ error: 'TASK_NOT_LIVE' });
    if (!task.child_session_id) return result({ error: 'TASK_NOT_LIVE' });
    if ((task.messages ?? []).length >= LIMIT) return result({ error: 'MESSAGE_LIMIT' });

    // sequence：task 内 CAS 分配（对 CAS 冲突重读重试）
    for (let i = 0; i < 3; i++) {
      task = board.get(id);
      if (task.parent_session_id !== ctx.sessionID) return result({ error: 'PARENT_OWNERSHIP' });
      if (input?.expectedGeneration !== undefined && input.expectedGeneration !== task.generation) return result({ error: 'GENERATION_CONFLICT' });
      if (task.state !== 'running' || !task.child_session_id) return result({ error: 'TASK_NOT_LIVE' });
      if ((task.messages ?? []).find((m: any) => m.key === key)) return result((task.messages ?? []).find((m: any) => m.key === key));
      if ((task.messages ?? []).length >= LIMIT) return result({ error: 'MESSAGE_LIMIT' });
      const seq = (task.messages ?? []).reduce((max: number, m: any) => Math.max(max, typeof m.sequence === 'number' ? m.sequence : 0), 0) + 1;
      const record: TaskMessageRecord = {
        sequence: seq, key, message,
        parentSessionId: task.parent_session_id, childSessionId: task.child_session_id, generation: task.generation,
        state: 'pending', attempts: 0, createdAt: now, updatedAt: now,
      };
      try {
        const updated = await board.appendMessage(id, record, { expectedRevision: task.last_board_revision, expectedTaskVersion: task.task_version, generation: task.generation });
        return result(await attemptDelivery(board, session, id, key, message, updated));
      } catch (e) {
        if (e instanceof JobBoardCasError && i < 2) continue;
        throw e;
      }
    }
    return result({ error: 'CAS_CONFLICT' });
  } catch (e: any) {
    if (e instanceof JobBoardAccessError) return result({ error: 'PARENT_OWNERSHIP' });
    return result({ error: String(e?.message ?? e) });
  }
}

/** attempts 在每次实际 send 前加 1；resolve=delivered，抛错/无能力/ok:false=uncertain。重启不自动调用。 */
async function attemptDelivery(board: JobBoard, session: SendCapability | undefined, id: string, key: string, message: string, taskAfterAppend: any): Promise<any> {
  await casUpdate(board, id, key, taskAfterAppend, { attempts: (taskAfterAppend.messages?.find((m: any) => m.key === key)?.attempts ?? 0) + 1 });
  const outcome = await sendOnce(session, { childSessionId: taskAfterAppend.child_session_id, message, generation: taskAfterAppend.generation });
  const fresh = board.get(id);
  const patch: Partial<TaskMessageRecord> = outcome.ok ? { state: 'delivered' } : { state: 'uncertain', error: outcome.reason };
  await casUpdate(board, id, key, fresh, patch);
  if (!outcome.ok) return { ...board.get(id).messages.find((m: any) => m.key === key), error: outcome.reason };
  return board.get(id).messages.find((m: any) => m.key === key);
}

/** CAS 更新消息状态（冲突时重读重试，最多 3 次）。 */
async function casUpdate(board: JobBoard, id: string, key: string, task: any, patch: Partial<TaskMessageRecord>) {
  for (let i = 0; i < 3; i++) {
    const t = i === 0 ? task : board.get(id);
    try {
      await board.updateMessage(id, key, patch, { expectedRevision: t.last_board_revision, expectedTaskVersion: t.task_version, generation: t.generation });
      return;
    } catch (e) {
      if (e instanceof JobBoardCasError && i < 2) continue;
      throw e;
    }
  }
}

async function memoryMode(session: SendCapability | undefined, input: any, id: string, ctx: ToolContextLike) {
  const now = Date.now();
  const list = (store.get(id) ?? []).filter((m) => now - m.createdAt < TTL);
  if (input?.message === undefined && !input?.retryKey) { store.set(id, list); return result({ messages: list.slice(-(input?.limit ?? LIMIT)) }); }

  if (input?.retryKey !== undefined) {
    const existing = list.find((m) => m.key === String(input.retryKey));
    if (!existing) return result({ error: 'MESSAGE_NOT_FOUND' });
    if (existing.state === 'delivered') return result(existing);
    if (existing.attempts >= MAX_ATTEMPTS) return result({ ...existing, error: 'RETRY_LIMIT' });
    return result(await deliverMemory(session, list, existing));
  }

  const key = input?.idempotencyKey;
  if (!key || typeof key !== 'string') return result({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
  const message = input?.message;
  if (!message || typeof message !== 'string' || bytes(message) > MAX_BYTES) return result({ error: 'MESSAGE_SIZE' });
  const existing = list.find((m) => m.key === key);
  if (existing) return result(existing);
  if (input?.taskStatus !== 'running') return result({ error: 'TASK_NOT_LIVE' });
  if (list.length >= LIMIT) return result({ error: 'MESSAGE_LIMIT' });
  const record: TaskMessageRecord = {
    sequence: list.reduce((max, m) => Math.max(max, m.sequence), 0) + 1, key, message,
    parentSessionId: ctx.sessionID, childSessionId: '', generation: 1,
    state: 'pending', attempts: 0, createdAt: now, updatedAt: now,
  };
  list.push(record); store.set(id, list);
  return result(await deliverMemory(session, list, record));
}

async function deliverMemory(session: SendCapability | undefined, _list: TaskMessageRecord[], record: TaskMessageRecord) {
  record.attempts += 1; record.updatedAt = Date.now();
  const outcome = await sendOnce(session, { childSessionId: record.childSessionId, message: record.message, generation: record.generation });
  record.state = outcome.ok ? 'delivered' : 'uncertain';
  if (!outcome.ok) record.error = outcome.reason;
  record.updatedAt = Date.now();
  return outcome.ok ? { ...record } : { ...record, error: outcome.reason };
}

export function resetTaskMessages(): void { store.clear(); }
