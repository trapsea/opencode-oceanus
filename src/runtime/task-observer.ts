/**
 * 内部 `task_registry_observer` 宿主观察链路（tooling-8-task-observer）。
 *
 * 插件不替代宿主 `task` / `subagent` 工具，而是通过 `execute.before` / `execute.after`
 * Hook 观察这些宿主工具的调用事件，把明确可识别的信息写入本地 task registry，
 * 使 task_status / task_result / task_cancel 不必恒定返回 "task 不存在"。
 *
 * 设计约束（全部 fail-open）：
 * - 不拦截、不抛错：observer 内部任何异常都只记录日志，绝不阻断宿主工具。
 * - 只观察宿主工具名 `task` 与 `subagent`，不观察自定义 task_status/result/cancel。
 * - 只有宿主 task 结果中明确的 taskId/task_id 才授予 controlled 能力；event.id 和 input
 *   值绝不提升为 native task id。subagent 仅保留 diagnostic 别名。
 * - after：递归提取明确 child session id（优先 childSessionId / child_session_id /
 *   sessionID / sessionId，且不等于父 session），以及受限长度文本结果；仅当明确识别
 *   时绑定 child；completed→completed、error→failed，未知形状保持 running/unknown。
 */
import { TaskRegistry } from '../tools/task/registry';
import type { TaskObservation, TaskStatus, ObservedTaskEvent } from '../tools/task/types';
import { getTaskRegistry } from './task';
import type { JobBoard } from '../tools/task/job-board';
import type { TaskReuseResolvedConfig } from '../config/utils';
import { notifyTerminalTask } from './task-notification';
void notifyTerminalTask; // 保留导出引用，供未来显式调用（T1 默认关闭）
import type { SessionLike } from './types';
import { runDispatchGuards, deriveObjectiveKey } from './dispatch-guard';

/** 被观察的宿主工具名集合。 */
export const OBSERVED_TOOL_NAMES: ReadonlySet<string> = new Set([
  'task',
  'subagent',
]);

/** 标签/摘要文本最大长度（字符）。 */
export const OBSERVER_LABEL_MAX_CHARS = 200;
/** 递归遍历的最大深度，防止畸形结果导致过深递归。 */
export const OBSERVER_WALK_MAX_DEPTH = 12;

export interface TaskObserverOptions {
  /** 注入 registry（默认进程级单例，便于无手工注入的端到端测试）。 */
  registry?: TaskRegistry;
  logger?: (message: string, meta?: Record<string, unknown>) => void;
  board?: JobBoard;
  session?: SessionLike;
  /**
   * subagent 会话复用策略。缺省不启用：不把完成的任务自动标为可复用。
   * 仅在 `reuse.enabled` 且任务以 `completed` 终态结束、且带明确 child session 时，
   * 才标记 `reusable:true`（failed/cancelled 不被默认保留，避免副作用重跑风险）。
   */
  reuse?: TaskReuseResolvedConfig;
  /**
   * after 先到时等待 before barrier 的最长时长（ms），默认 2000。
   * 超时后任务写 uncertain + pending_event（BARRIER_TIMEOUT），late before 可收敛。
   */
  barrierTimeoutMs?: number;
  /** barrier 轮询间隔（ms），默认 10；仅测试注入用。 */
  barrierPollMs?: number;
}

/** observer 暴露给 `ctx.tool.hook` 的 before/after 处理器。 */
export interface TaskObserver {
  'execute.before': (event: any) => Promise<void> | void;
  'execute.after': (event: any) => Promise<void> | void;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const truncate = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max) : s;

/** 在对象中按 key 顺序取第一个非空字符串。 */
function pickString(obj: unknown, keys: string[]): string | undefined {
  if (!isRecord(obj)) return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/** 从 before input 提取任务 id：显式 taskId/task_id 优先，否则用宿主调用 id。 */
export function resolveNativeTaskId(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  const values = ['taskId', 'task_id'].map((key) => result[key]);
  if (values.some((v) => typeof v !== 'string' || v.length === 0)) return undefined;
  return values[0] === values[1] ? values[0] as string : undefined;
}

/** 提取便于观测的 label/subject（若明确）。 */
function extractLabel(input: unknown): string | undefined {
  const value = pickString(input, ['label', 'subject', 'description']);
  return value ? truncate(value, OBSERVER_LABEL_MAX_CHARS) : undefined;
}

/** 只接受 description 中恰好一个合法的 lane:<stable-key> 标记。 */
export function extractLaneKey(input: unknown): string | undefined {
  const description = pickString(input, ['description']);
  if (!description) return undefined;
  const matches = [...description.matchAll(/(?:^|\s)lane:([^\s]+)/g)];
  if (matches.length !== 1 || !/^[A-Za-z0-9._\/-]+$/.test(matches[0][1])) return undefined;
  return matches[0][1];
}

/** 递归访问任意值（含嵌套对象/数组），带深度上限。 */
function walk(value: unknown, visit: (v: unknown) => void, depth = 0): void {
  if (depth > OBSERVER_WALK_MAX_DEPTH) return;
  visit(value);
  if (isRecord(value)) {
    for (const key of Object.keys(value)) {
      walk(value[key], visit, depth + 1);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, visit, depth + 1);
    }
  }
}

/** child session key 优先级（数值越小越优先）。 */
const CHILD_SESSION_KEYS: ReadonlyArray<{ key: string; priority: number }> = [
  { key: 'childSessionId', priority: 1 },
  { key: 'child_session_id', priority: 2 },
];

/**
 * 从 result（output/content/metadata 及任意嵌套）中递归提取明确的 child session id。
 * 优先级 childSessionId > child_session_id > sessionID > sessionId；
 * 与父 session 相同的值一律不作为 child（不要把父 session 当 child）。
 * 无法明确识别时返回 undefined。
 */
export function extractChildSessionId(
  result: unknown,
  parentSessionId: string,
): string | undefined {
  let best: { value: string; priority: number } | undefined;
  walk(result, (value) => {
    if (!isRecord(value)) return;
    for (const key of Object.keys(value)) {
      const v = value[key];
      if (typeof v !== 'string' || v.length === 0) continue;
      const entry = CHILD_SESSION_KEYS.find((e) => e.key === key);
      if (!entry) continue;
      if (v === parentSessionId) continue; // 父 session 不当 child
      if (!best || entry.priority < best.priority) {
        best = { value: v, priority: entry.priority };
      }
    }
  });
  return best?.value;
}

/** 提取受限长度的文本结果摘要；无法序列化时返回 undefined。 */
export function extractResultText(
  result: unknown,
  maxChars = 2000,
): string | undefined {
  if (typeof result === 'string' && result.length > 0) {
    return truncate(result, maxChars);
  }
  if (!isRecord(result)) return undefined;
  const content = result.content;
  if (typeof content === 'string' && content.length > 0) {
    return truncate(content, maxChars);
  }
  const output = result.output;
  if (typeof output === 'string' && output.length > 0) {
    return truncate(output, maxChars);
  }
  if (isRecord(output)) {
    const nested = pickString(output, ['text', 'content', 'result', 'output']);
    if (nested) return truncate(nested, maxChars);
  }
  try {
    const s = JSON.stringify(result);
    return s && s.length > 0 ? truncate(s, maxChars) : undefined;
  } catch {
    return undefined;
  }
}

/** 从 after 事件推断观察状态：completed→completed、error→failed、其余未知。 */
export function inferObservationStatus(event: any): TaskStatus | undefined {
  if (event?.status === 'completed') return 'completed';
  if (event?.status === 'error') return 'failed';
  return undefined;
}

/**
 * 修剪可复用任务：回收超过 TTL 或超出 maxRetained 的 reusable 标记。
 * 全部 fail-open：CAS 冲突或异常忽略，不阻断观察主流程。
 */
export async function pruneReusable(
  board: JobBoard,
  reuse: TaskReuseResolvedConfig,
  now: number = Date.now(),
): Promise<void> {
  const isRetained = (t: any) => t.reusable === true;
  for (const t of (board.tasks() as any[]).filter(isRetained)) {
    const age = now - (t.last_activity_at ?? t.updated_at ?? now);
    if (age <= reuse.ttlMs) continue;
    try {
      await board.replace(
        { ...t, reusable: false },
        { expectedRevision: t.last_board_revision ?? 0, operationId: `prune-reuse-${t.task_id}-${t.generation}-${now}` },
      );
    } catch { /* fail-open */ }
  }
  const retained = (board.tasks() as any[])
    .filter(isRetained)
    .sort((a, b) => (b.last_activity_at ?? 0) - (a.last_activity_at ?? 0));
  for (let i = reuse.maxRetained; i < retained.length; i++) {
    const t = retained[i];
    try {
      await board.replace(
        { ...t, reusable: false },
        { expectedRevision: t.last_board_revision ?? 0, operationId: `prune-cap-${t.task_id}-${t.generation}-${now}` },
      );
    } catch { /* fail-open */ }
  }
}

/** 创建 observer 实例（before/after 处理器）。 */
export function createTaskObserver(
  opts: TaskObserverOptions = {},
): TaskObserver {
  const registry = opts.registry ?? getTaskRegistry();
  const log = opts.logger ?? (() => {});
  const board = opts.board;
  const reuse = opts.reuse;
  /** callId 仅作 before/after 关联键；值是 provisional，不是受控任务。 */
  const provisional = new Map<string, { parentSessionId: string; inputTaskId?: string; generation?: number; at: number; agent?: string; laneKey?: string }>();
  const barrierTimeoutMs = opts.barrierTimeoutMs ?? 2000;
  const barrierPollMs = opts.barrierPollMs ?? 10;
  /** before barrier 解析结果：before 建立任务后确定的 taskId/parent/generation。 */
  interface BarrierInfo {
    taskId: string;
    parentSessionId: string;
    generation: number;
  }
  /**
   * before barrier：callId → { 建立时刻, beforePromise }。
   * 必须按 callId 保存：同一 task 的并发 call 各自持有独立 barrier，
   * after 只能匹配同 callId，不得借用其它 call 的 barrier 或当前 board generation。
   */
  const barriers = new Map<string, { at: number; beforePromise: Promise<BarrierInfo | null>; resolve: (v: BarrierInfo | null) => void }>();
  /** barrier 超时后缓存的 after 事件（每 parent 最多 32 条，保留 10 分钟）。 */
  const pendingByParent = new Map<string, Array<{ event: ObservedTaskEvent; at: number }>>();
  const PENDING_TTL_MS = 10 * 60 * 1000;
  const PENDING_BUFFER_MAX = 32;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** 缓存超时未应用的 after 事件（每 parent 上限 32，先进先出）。 */
  const bufferPending = (event: ObservedTaskEvent): void => {
    const list = pendingByParent.get(event.parentSessionId) ?? [];
    list.push({ event, at: Date.now() });
    if (list.length > PENDING_BUFFER_MAX) list.splice(0, list.length - PENDING_BUFFER_MAX);
    pendingByParent.set(event.parentSessionId, list);
  };

  /** 应用单个观察事件到 board；全部 fail-open，只记录错误码。 */
  const applyEvent = async (event: ObservedTaskEvent): Promise<void> => {
    try {
      await board!.applyObservedEvent(event);
    } catch (e: any) {
      // EVENT_CONFLICT / STALE_EVENT / FUTURE_GENERATION / MISSING_EVENT_KEY / CAS 等
      log('task-observer 事件应用失败(fail-open)', { eventId: event.eventId, error: e?.message ?? messageOf(e) });
    }
  };

  /** late before / 新 attempt 收敛：尝试应用该 parent 缓存的未决事件。 */
  const convergePending = async (parentSessionId: string, callId: string, taskId: string): Promise<void> => {
    const list = pendingByParent.get(parentSessionId);
    if (!list || list.length === 0) return;
    const now = Date.now();
    const remaining: typeof list = [];
    for (const entry of list) {
      if (entry.event.taskId === taskId && entry.event.eventId.startsWith(`${callId}:`) && now - entry.at <= PENDING_TTL_MS) {
        await applyEvent(entry.event);
      } else if (now - entry.at <= PENDING_TTL_MS) {
        remaining.push(entry);
      }
    }
    pendingByParent.set(parentSessionId, remaining);
  };

  const observer: TaskObserver = {
    'execute.before': async (event: any) => {
      if (!event || !OBSERVED_TOOL_NAMES.has(event.tool)) return;
      // 派发纪律守卫（dispatch-guard）：角色冒名 / 同目标终态未消费重派。
      // 必须 try 之外直接抛出——错误文本经宿主回流给编排模型实现自我纠正；
      // 此处 throw 会中止本次工具调用，后续 registry/board 均不写入。
      runDispatchGuards(event, { board });
      try {
        const parentSessionId =
          typeof event.sessionID === 'string' ? event.sessionID : undefined;
        if (!parentSessionId) return;
        const inputTaskId = pickString(event.input, ['taskId', 'task_id']);
        // before 只建立待确认的本地记录；nativeTaskId/controlled 资格仍必须由 task
        // 结果中的一致 taskId/task_id 授予，绝不把 input 当作 native id。
        if (event.tool === 'task' && typeof event.id === 'string' && event.id) {
           let generation: number | undefined;
           if (board && inputTaskId) {
             try { generation = board.get(inputTaskId).generation; } catch { /* native result may create it later */ }
           }
           provisional.set(event.id, { parentSessionId, inputTaskId, generation, at: Date.now() });
          let resolveBarrier!: (v: BarrierInfo | null) => void;
          const beforePromise = new Promise<BarrierInfo | null>((resolve) => { resolveBarrier = resolve; });
          barriers.set(event.id, { at: Date.now(), beforePromise, resolve: resolveBarrier });
          // 超时 pending 只允许由相同 callId 的 late before 消费。
          const pending = pendingByParent.get(parentSessionId)?.find((x) => x.event.eventId.startsWith(`${event.id}:`));
          if (pending && board) {
            try {
              const current = board.get(pending.event.taskId);
              try { registry.create({ id: pending.event.taskId, nativeTaskId: pending.event.taskId, parentSessionId, status: 'running', control: 'controlled', capabilities: ['status', 'result', 'cancel'] }); } catch {}
              resolveBarrier({ taskId: pending.event.taskId, parentSessionId, generation: current.generation });
              await applyEvent(pending.event);
              await board.replace({ ...board.get(pending.event.taskId), pending_event: undefined }, { expectedRevision: board.revision, operationId: `clear-pending-${pending.event.eventId}` });
              const list = pendingByParent.get(parentSessionId) ?? [];
              pendingByParent.set(parentSessionId, list.filter((x) => x !== pending));
            } catch {}
          }
          return;
        }
        // before 没有宿主返回的 native id，不能创建受控任务；仅为 raw subagent 留诊断别名。
        if (event.tool === 'subagent' && typeof event.id === 'string' && event.id.length > 0) {
          const agent = pickString(event.input, ['agent']);
          provisional.set(event.id, { parentSessionId, at: Date.now(), agent, laneKey: extractLaneKey(event.input) });
        }
         return;
      } catch (e) {
        log('task-observer.before 失败(fail-open)', { error: messageOf(e) });
      }
    },

    'execute.after': async (event: any) => {
      if (!event || !OBSERVED_TOOL_NAMES.has(event.tool)) return;
      try {
        if (typeof event.id !== 'string' || !event.id) return;
        // after 先到（before 未发生）时 callId 映射不存在：回退用 input.taskId / callId 解析，
        // 之后靠 barrier 等待 late before，保证 before/after 顺序语义。
           const parentSessionId = typeof event.sessionID === 'string' ? event.sessionID : undefined;
           if (!parentSessionId) return;
           const status = inferObservationStatus(event);
           const nativeTaskId = resolveNativeTaskId((event as any).result);
           if (event.tool === 'subagent') {
             const directChild = isRecord((event as any).result) && typeof (event as any).result.sessionID === 'string' && (event as any).result.sessionID !== parentSessionId
               ? (event as any).result.sessionID : undefined;
             const p = provisional.get(event.id);
             if (!directChild || !p || p.parentSessionId !== parentSessionId || !status || !board) return;
             try {
               const made: any = await board.replace({ task_id: directChild, parent_session_id: parentSessionId, child_session_id: directChild, agent: p.agent, lane_key: p.laneKey, reusable: false, state: 'running', ownership: { parent_session_id: parentSessionId } }, { expectedRevision: board.revision, operationId: `observe-subagent-${event.id}` });
               try { registry.create({ id: directChild, nativeTaskId: directChild, parentSessionId, childSessionId: directChild, status: 'running', agent: p.agent, lane_key: p.laneKey, control: 'controlled', capabilities: ['status', 'result', 'cancel'] }); } catch {}
               await board.applyObservedEvent({ eventId: `${event.id}:after:${Number.isInteger((event as any).attempt) ? (event as any).attempt : 1}`, taskId: directChild, parentSessionId, childSessionId: directChild, generation: made.generation, kind: status === 'completed' ? 'completed' : 'failed', at: Date.now() });
               registry.setObservation(directChild, parentSessionId, { source: 'host-after', childSessionId: directChild, status, at: Date.now() });
               if (status === 'completed' && reuse?.enabled && p.agent && p.laneKey && typeof opts.session?.get === 'function') {
                 const host: any = await opts.session.get({ sessionID: directChild });
                 if (host?.outcome === 'succeeded' && host?.id === directChild && host?.parentID === parentSessionId) {
                   const fresh: any = board.get(directChild);
                   await board.replace({ ...fresh, reconciliation: 'reconciled', certainty: 'authoritative', reusable: true }, { expectedRevision: fresh.last_board_revision, operationId: `reconcile-subagent-${directChild}-${fresh.generation}` });
                   await pruneReusable(board, reuse);
                 }
               }
             } catch (e) { log('task-observer.subagent 事件应用失败(fail-open)', { error: messageOf(e) }); }
             return;
           }
           if (event.tool !== 'task') return;
           if (!nativeTaskId) return;
           const effectiveTaskId = nativeTaskId;
           const childSessionId = extractChildSessionId(event.result, parentSessionId);
        const text = extractResultText(event.result);
         // native id 仅来自 task 结果；此处首次建立受控 registry 记录。
        // 无可记录信息（既无 child、无文本、也无明确终态）→ 不写入，保持现状。
        if (!childSessionId && !text && !status) return;

        const observation: TaskObservation = {
          source: 'host-after',
          childSessionId,
          text,
          status,
          at: Date.now(),
        };
        // registry 写入独立 fail-open：after 先到时任务可能尚未由 before 创建，
        // 等 barrier 确认后再补写（见下方观察补写）。
        let observed = false;
        const writeObservation = (): void => {
          if (observed) return;
          try {
           registry.setObservation(effectiveTaskId, parentSessionId, observation);
            observed = true;
          } catch {
            /* 任务尚未创建：等 late before 后补写 */
          }
        };
         // eventId=`${callId}:${phase}:${attempt}`；callId=event.id，phase=after。
          const attempt = Number.isInteger((event as any).attempt) ? (event as any).attempt : 1;
           const eventId = `${event.id}:after:${attempt}`;
           const kind: ObservedTaskEvent['kind'] = status === 'completed' ? 'completed' : 'failed';
            // 无 JobBoard 的轻量注册路径仍须保留 Registry 观察能力；它不授予
            // 持久化生命周期控制，只记录已经由 native result 验证的 task ID。
            if (!board) {
              try {
                registry.create({
                  id: effectiveTaskId,
                  nativeTaskId: effectiveTaskId,
                  parentSessionId,
                  status: 'running',
                  control: 'controlled',
                  capabilities: ['status', 'result', 'cancel'],
                });
              } catch { /* 已存在或容量不足均 fail-open */ }
              writeObservation();
              provisional.delete(event.id);
              return;
            }
            if (!status) { provisional.delete(event.id); return; }
           void (async () => {
            try {
              // before/after barrier：after 先到最多等待 barrierTimeoutMs；
              // 只匹配同 callId 的 barrier，绝不借用其它 call 或当前 board generation。
              const callId = event.id;
              const deadline = Date.now() + barrierTimeoutMs;
              let entry = barriers.get(callId);
              while (!entry && Date.now() < deadline) {
                await sleep(barrierPollMs);
                entry = barriers.get(callId);
              }
               const p = provisional.get(callId);
               if (entry && p && p.parentSessionId === parentSessionId) {
                  let generation = p?.generation ?? 1;
                  if (board && p?.generation === undefined) {
                    try { generation = board.get(effectiveTaskId).generation ?? 1; } catch {
                     try { const made = await board.replace({ task_id: effectiveTaskId, parent_session_id: parentSessionId, state: 'running', ownership: { parent_session_id: parentSessionId } }, { expectedRevision: board.revision, operationId: `observe-before-start-${callId}` }); generation = made.generation ?? 1; } catch {}
                   }
                 }
                 try { registry.create({ id: effectiveTaskId, nativeTaskId: effectiveTaskId, parentSessionId, status: 'running', control: 'controlled', capabilities: ['status', 'result', 'cancel'] }); } catch {}
                 entry.resolve({ taskId: effectiveTaskId, parentSessionId, generation });
               }
               const info = entry
                ? await Promise.race([
                    entry.beforePromise,
                    sleep(Math.max(0, deadline - Date.now()) + 1).then(() => null as BarrierInfo | null),
                  ])
                : null;
              if (
                !info ||
                 info.taskId !== effectiveTaskId ||
                info.parentSessionId !== parentSessionId
              ) {
                // barrier 超时/不匹配：不用当前 board generation 猜测终态，
                // 写 uncertain + pending_event（迟到事件由 generation fence 拒绝）。
                let current: any;
                 try { current = board.get(effectiveTaskId); } catch { current = undefined; }
                const base = current ?? {
                   task_id: effectiveTaskId, parent_session_id: parentSessionId,
                  ownership: { parent_session_id: parentSessionId },
                  task_version: 0, generation: 1,
                };
                const pending: ObservedTaskEvent = {
                  eventId, taskId: effectiveTaskId, parentSessionId, childSessionId,
                  generation: current?.generation ?? 1, kind,
                  result: text ? { status: kind === 'completed' ? 'success' : 'failure', summary: text } : undefined,
                  at: Date.now(),
                };
                try {
                  // 终态任务不被迟到的缺 barrier 事件降级为 uncertain：仅缓冲 pending。
                  const terminal = current && ['completed', 'failed', 'cancelled'].includes(current.state);
                  if (!terminal) {
                    await board.replace(
                      { ...base, state: 'uncertain', pending_event: pending },
                      {
                        expectedRevision: current ? (current.last_board_revision ?? 0) : board.revision,
                        operationId: `barrier-timeout-${eventId}`,
                      },
                    );
                  }
                } catch { /* fail-open */ }
                bufferPending(pending);
                writeObservation(); // after 先到：registry 可能仍无任务，保持 fail-open
                 log('task-observer BARRIER_TIMEOUT：after 先到且 before 未出现，已写 uncertain + pending_event', { taskId: effectiveTaskId, eventId });
                return;
              }
              // before 已在同一 callId 上确定 generation：after 使用同一 generation；
              // revive 后迟到的旧事件因 generation < 当前而被 STALE_EVENT 拒绝。
               try { registry.create({ id: effectiveTaskId, nativeTaskId: effectiveTaskId, parentSessionId, status: 'running', control: 'controlled', capabilities: ['status', 'result', 'cancel'] }); } catch {}
               writeObservation(); // late before 已创建任务，补写观察
               if (!board) return;
               await board.applyObservedEvent({
                 eventId, taskId: effectiveTaskId, parentSessionId, childSessionId,
                generation: info.generation, kind,
                result: text ? { status: kind === 'completed' ? 'success' : 'failure', summary: text } : undefined,
                at: Date.now(),
              });
               // 完成且已明确绑定 child 后，以 replace 做一次 CAS 标记；
               // reconciliation 仍由启动恢复链路确认，故这里不伪造 reconciled。
               if (reuse?.enabled && kind === 'completed') {
                  const after = board.get(effectiveTaskId);
                 if (after.child_session_id && after.reconciliation === 'reconciled') {
                   await board.replace(
                     { ...after, reusable: true },
                      { expectedRevision: after.last_board_revision ?? board.revision, operationId: `reuse-${effectiveTaskId}-${after.generation}` },
                   ).catch(() => undefined);
         }
                 await pruneReusable(board, reuse).catch(() => undefined);
               }
            } catch (e: any) {
              log('task-observer.after 事件应用失败(fail-open)', { eventId, error: e?.message ?? messageOf(e) });
            }
          })();
         // T1：默认关闭终态 queue 通知（不再调用 session.prompt / notifyTerminalTask）。
        // notifyTerminalTask 保留供未来显式调用；registry/board 状态更新不受影响。
      } catch (e) {
        log('task-observer.after 失败(fail-open)', { error: messageOf(e) });
      }
    },
  };

  return observer;
}
