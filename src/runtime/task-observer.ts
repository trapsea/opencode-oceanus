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
 * - before：从 input 的 taskId/task_id（若明确）或 event.id 生成稳定 task id，
 *   记录 parentSessionId=event.sessionID、label/subject（若明确）、status=running，
 *   并保存 callID→taskId 映射；未知/异常输入不抛错、不伪造 child session。
 * - after：递归提取明确 child session id（优先 childSessionId / child_session_id /
 *   sessionID / sessionId，且不等于父 session），以及受限长度文本结果；仅当明确识别
 *   时绑定 child；completed→completed、error→failed，未知形状保持 running/unknown。
 */
import { TaskRegistry } from '../tools/task/registry';
import type { TaskObservation, TaskStatus } from '../tools/task/types';
import { getTaskRegistry } from './task';

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
function resolveTaskId(input: unknown, callId: unknown): string | undefined {
  const explicit = pickString(input, ['taskId', 'task_id']);
  if (explicit) return explicit;
  if (typeof callId === 'string' && callId.length > 0) return callId;
  return undefined;
}

/** 提取便于观测的 label/subject（若明确）。 */
function extractLabel(input: unknown): string | undefined {
  const value = pickString(input, ['label', 'subject', 'description']);
  return value ? truncate(value, OBSERVER_LABEL_MAX_CHARS) : undefined;
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
  { key: 'sessionID', priority: 3 },
  { key: 'sessionId', priority: 4 },
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

/** 创建 observer 实例（before/after 处理器）。 */
export function createTaskObserver(
  opts: TaskObserverOptions = {},
): TaskObserver {
  const registry = opts.registry ?? getTaskRegistry();
  const log = opts.logger ?? (() => {});
  const callIdToTaskId = new Map<string, string>();

  const observer: TaskObserver = {
    'execute.before': (event: any) => {
      if (!event || !OBSERVED_TOOL_NAMES.has(event.tool)) return;
      try {
        const taskId = resolveTaskId(event.input, event.id);
        const parentSessionId =
          typeof event.sessionID === 'string' ? event.sessionID : undefined;
        if (!taskId || !parentSessionId) return;
        const label = extractLabel(event.input);
        try {
          registry.create({
            id: taskId,
            parentSessionId,
            status: 'running',
            label,
          });
        } catch {
          // 重复 id（同一任务再次被引用）等：仅保留 callID 映射，不抛错。
        }
        if (typeof event.id === 'string' && event.id.length > 0) {
          callIdToTaskId.set(event.id, taskId);
        }
      } catch (e) {
        log('task-observer.before 失败(fail-open)', { error: messageOf(e) });
      }
    },

    'execute.after': (event: any) => {
      if (!event || !OBSERVED_TOOL_NAMES.has(event.tool)) return;
      try {
        if (typeof event.id !== 'string' || !event.id) return;
        const taskId = callIdToTaskId.get(event.id);
        if (!taskId) return;
        const parentSessionId =
          typeof event.sessionID === 'string' ? event.sessionID : undefined;
        if (!parentSessionId) return;

        const childSessionId = extractChildSessionId(event.result, parentSessionId);
        const text = extractResultText(event.result);
        const status = inferObservationStatus(event);
        // 无可记录信息（既无 child、无文本、也无明确终态）→ 不写入，保持现状。
        if (!childSessionId && !text && !status) return;

        const observation: TaskObservation = {
          source: 'host-after',
          childSessionId,
          text,
          status,
          at: Date.now(),
        };
        registry.setObservation(taskId, parentSessionId, observation);
        callIdToTaskId.delete(event.id);
      } catch (e) {
        log('task-observer.after 失败(fail-open)', { error: messageOf(e) });
      }
    },
  };

  return observer;
}
