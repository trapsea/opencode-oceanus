/**
 * Tool loop guard.
 *
 * 检测一个 session 连续重复发出完全相同的工具调用（相同 tool + 相同参数），
 * 这是模型侧无限循环的典型表现（参考 issue #1071：子代理无限重复相同
 * read/grep 调用）。
 *
 * 行为：
 * - N 次连续调用且参数相同 AND 结果相同（LOOP_GUARD_WARN_AT）：向工具结果追加
 *   纠正性文案，提示模型停止并改变策略。
 * - 对只读文件工具（LOOP_GUARD_BLOCK_TOOLS），M 次连续调用且参数相同 AND
 *   结果相同（LOOP_GUARD_BLOCK_AT）：在 tool.execute.before 中抛错拒绝下一次
 *   相同调用，从而终止循环。
 * - run 计数只在 tool.execute.after 中推进，且仅当相同参数的调用产生了与上一次
 *   字节相同的结果时 +1。返回了新信息（结果变化）会重置 run，因此合法的重读
 *   （如文件变化后再次读取）永远无法累计到阻塞阈值。
 * - tool.execute.before 从不增加计数，因此重叠的并发调用不会在结果确定前抬高
 *   计数。只有在 run 已被确认相同时才会拒绝。
 *
 * 范围刻意收窄以避免破坏合法的重复调用：
 * - 所有工具在 N 次确认相同的连续调用后告警。
 * - 只有只读文件分析工具硬阻塞：轮询类工具（task_*、wait_for_*）合法地重复
 *   相同调用以等待长时间后台任务，绝不能拒绝。
 * - task 工具在两个维度上都被豁免；task-session-manager 拥有自己的重复派生
 *   保护。
 *
 * 本实现只提供 hook 逻辑，不做注册；适配 v2 的 tool.execute.before/after 事件
 * 形状（@opencode-ai/plugin 的 ToolHooks）。
 */

/**
 * 连续相同调用达到该次数时，向结果追加告警文案。
 */
export const LOOP_GUARD_WARN_AT = 3;

/**
 * 只读文件工具连续相同调用达到该次数时，在 before 中抛错拒绝。
 */
export const LOOP_GUARD_BLOCK_AT = 5;

/**
 * 完全豁免的整套工具：长时间 task 监督/轮询工具的相同重复调用是合法的。
 */
export const LOOP_GUARD_EXEMPT: Record<string, true> = {
  task: true,
  task_status: true,
  task_result: true,
  task_cancel: true,
  task_message: true,
  task_revive: true,
  wait_for_user: true,
  wait_for_background_tasks: true,
};

/**
 * 可能被硬阻塞的工具：只读文件分析是报告的循环面（#1071）；任何有副作用或
 * 轮询外部状态的工具保持仅告警。
 */
export const LOOP_GUARD_BLOCK_TOOLS: Record<string, true> = {
  read: true,
  grep: true,
  glob: true,
};

export const LOOP_GUARD_MARKER = '[REPEATED TOOL CALLS - STOP]';

/**
 * 生成告警文案；使用实际 warnAt 以便阈值可配置后文案仍准确。
 */
export function buildLoopGuardWarning(warnAt: number): string {
  return `
${LOOP_GUARD_MARKER}

You have issued the exact same tool call with identical arguments ${warnAt} times in a row and received identical results. This is an infinite loop and you are making no progress.

STOP repeating this call. Instead:
1. Reconsider what you are looking for; the result above already contains what this call can tell you.
2. If you need different information, make a DIFFERENT call (different path, pattern, or tool).
3. If the task is actually done, produce your final answer now instead of calling more tools.
`;
}

/** 默认阈值（与未配置时的历史行为一致）。 */
export const LOOP_GUARD_WARNING = buildLoopGuardWarning(LOOP_GUARD_WARN_AT);

/** 在清理前最多跟踪的 session 数。 */
export const MAX_TRACKED_SESSIONS = 512;

/**
 * v2 事件形状：tool.execute.before 入参（@opencode-ai/plugin ToolHooks）。
 * 参数（args）位于 `input` 字段，调用 id 位于 `id` 字段。
 */
export interface ToolExecuteBeforeEvent {
  readonly tool: string;
  readonly sessionID: string;
  readonly id: string;
  readonly input: unknown;
}

/** v2 事件形状：tool.execute.after（completed 分支）。结果位于 `result`。 */
export interface ToolExecuteAfterCompletedEvent {
  readonly tool: string;
  readonly sessionID: string;
  readonly id: string;
  readonly input: unknown;
  readonly status: 'completed';
  readonly result: {
    output?: unknown;
    content?: string | ReadonlyArray<unknown>;
    metadata?: unknown;
  };
}

/** v2 事件形状：tool.execute.after（error 分支）。 */
export interface ToolExecuteAfterErrorEvent {
  readonly tool: string;
  readonly sessionID: string;
  readonly id: string;
  readonly input: unknown;
  readonly status: 'error';
  readonly error: unknown;
}

export type ToolExecuteAfterEvent =
  | ToolExecuteAfterCompletedEvent
  | ToolExecuteAfterErrorEvent;

/** 日志回调，默认 no-op；测试可注入 spy。 */
export interface ToolLoopGuardOptions {
  readonly log?: (message: string, meta?: Record<string, unknown>) => void;
  /** 连续相同调用达到该次数时告警；默认 LOOP_GUARD_WARN_AT。 */
  readonly warnAt?: number;
  /** 只读文件工具连续相同调用达到该次数时拒绝；默认 LOOP_GUARD_BLOCK_AT。 */
  readonly blockAt?: number;
  /** 清理前最多跟踪的 session 数；默认 MAX_TRACKED_SESSIONS。 */
  readonly maxSessions?: number;
}

/** 将配置阈值归一化为合法正整数；非法/边界值回落默认值。 */
function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return value;
}

export interface ToolLoopGuardHook {
  'tool.execute.before': (input: ToolExecuteBeforeEvent) => Promise<void>;
  'tool.execute.after': (input: ToolExecuteAfterEvent) => Promise<void>;
  resetSession(sessionID: string): void;
  resetForTests(): void;
}

/** 工具 + 参数的确定性指纹，对键顺序不敏感。 */
function fingerprint(tool: string, value: unknown): string {
  return `${tool.toLowerCase()}:${stableStringify(value)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`)
    .join(',')}}`;
}

interface SessionState {
  /** 最近一次完成的可计数调用指纹（args）。 */
  last: string;
  /** 参数相同 AND 输出相同的连续完成调用次数。 */
  runs: number;
  /** 最近一次完成调用输出的指纹。 */
  lastOutput: string;
}

export function createToolLoopGuardHook(
  options: ToolLoopGuardOptions = {},
): ToolLoopGuardHook {
  const log = options.log ?? (() => {});
  const warnAt = normalizePositiveInt(options.warnAt, LOOP_GUARD_WARN_AT);
  const blockAt = normalizePositiveInt(options.blockAt, LOOP_GUARD_BLOCK_AT);
  const maxSessions = normalizePositiveInt(options.maxSessions, MAX_TRACKED_SESSIONS);
  const warningText = buildLoopGuardWarning(warnAt);
  const sessions = new Map<string, SessionState>();
  /** 每个 callID 的指纹，使 after 无需重新推导参数即可复检。 */
  const callKeys = new Map<string, string>();

  /** 将 session 映射裁剪到 maxSessions（按插入顺序 FIFO）。 */
  function keepSessionsBounded(): void {
    while (sessions.size > maxSessions) {
      const oldest = sessions.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      sessions.delete(oldest);
    }
  }

  return {
    'tool.execute.before': async (input: ToolExecuteBeforeEvent): Promise<void> => {
      const sessionID = input.sessionID;
      if (!sessionID) return;
      const tool = input.tool.toLowerCase();
      if (LOOP_GUARD_EXEMPT[tool]) return;

      const key = fingerprint(tool, input.input);
      const existing = sessions.get(sessionID);

      // 仅在 CONFIRMED 相同 run 上拒绝：此前 blockAt 次调用参数与结果都相同。
      // 本次调用结果未知，但 run 已经是退化状态。
      if (
        existing &&
        existing.last === key &&
        existing.runs >= blockAt &&
        LOOP_GUARD_BLOCK_TOOLS[tool]
      ) {
        log('[tool-loop-guard] blocked repeated tool call', {
          sessionID,
          tool,
          runs: existing.runs,
        });
        throw new Error(
          `Refusing to execute "${tool}": this exact call (same tool, same arguments) has returned identical results ${existing.runs} times in a row and constitutes an infinite loop. Stop repeating it. Reassess your goal, make a different call, or produce your final answer.`,
        );
      }

      callKeys.set(input.id, key);
    },

    'tool.execute.after': async (input: ToolExecuteAfterEvent): Promise<void> => {
      const sessionID = input.sessionID;
      if (!sessionID) return;
      const tool = input.tool.toLowerCase();
      if (LOOP_GUARD_EXEMPT[tool]) return;

      const key = callKeys.get(input.id);
      callKeys.delete(input.id);

      // 错误/非完成结果视为结果变化：重置 run，绝不向阻塞累计。
      if (input.status !== 'completed') {
        sessions.set(sessionID, {
          last: key ?? `${tool}:<untracked>`,
          runs: 1,
          lastOutput: '',
        });
        keepSessionsBounded();
        return;
      }

      const result = input.result;
      const outputHash = fingerprint(tool, {
        output: result.output,
        content: result.content,
      });

      const existing = sessions.get(sessionID);
      let state: SessionState;
      if (existing && key !== undefined && key === existing.last) {
        // 参数相同：仅当结果也相同时才 +1；结果变化是进展，重置 run。
        state = {
          last: key,
          runs: outputHash === existing.lastOutput ? existing.runs + 1 : 1,
          lastOutput: outputHash,
        };
      } else {
        // 参数不同或未跟踪的调用：开始新的 run。
        state = {
          last: key ?? `${tool}:<untracked>`,
          runs: 1,
          lastOutput: outputHash,
        };
      }
      sessions.set(sessionID, state);
      keepSessionsBounded();

      if (state.runs < warnAt) return;

      // 追加告警到可变的文本字段（v2 结果文本在 result.content 或 result.output）。
      if (typeof result.content === 'string') {
        if (result.content.includes(LOOP_GUARD_MARKER)) return;
        log('[tool-loop-guard] warned repeated tool call', {
          sessionID,
          tool,
          runs: state.runs,
        });
        result.content = `${result.content}\n${warningText}`;
        return;
      }
      if (Array.isArray(result.content)) {
        // 文本数组（v2 常见 [{type:'text',text}]）：只向最后一个文本项尾部追加，
        // 非文本项（如图片/资源）保持不变。
        let textIndex = -1;
        for (let i = result.content.length - 1; i >= 0; i--) {
          const item = result.content[i];
          if (
            typeof item === 'object' &&
            item !== null &&
            (item as { type?: unknown }).type === 'text' &&
            typeof (item as { text?: unknown }).text === 'string'
          ) {
            textIndex = i;
            break;
          }
        }
        // fail-open：数组为空或没有文本项时静默跳过，不抛错。
        if (textIndex === -1) return;
        const textItem = result.content[textIndex];
        // marker 幂等：文本项已含 marker 则不重复追加。
        if (textItem.text.includes(LOOP_GUARD_MARKER)) return;
        log('[tool-loop-guard] warned repeated tool call', {
          sessionID,
          tool,
          runs: state.runs,
        });
        const next = result.content.slice();
        next[textIndex] = { ...textItem, text: `${textItem.text}\n${warningText}` };
        result.content = next;
        return;
      }
      if (typeof result.output === 'string') {
        if (result.output.includes(LOOP_GUARD_MARKER)) return;
        log('[tool-loop-guard] warned repeated tool call', {
          sessionID,
          tool,
          runs: state.runs,
        });
        result.output = `${result.output}\n${warningText}`;
      }
    },

    /** 清除某个结束/删除 session 的全部状态。 */
    resetSession(sessionID: string): void {
      sessions.delete(sessionID);
    },

    /** 测试缝隙：清空用例间状态。 */
    resetForTests(): void {
      sessions.clear();
      callKeys.clear();
    },
  };
}
