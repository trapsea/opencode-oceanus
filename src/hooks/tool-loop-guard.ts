/**
 * 工具循环保护。
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
 * - 编辑后重读豁免：主 agent 的“编辑 → 重读同一文件”是正常工作循环。写工具
 *   （LOOP_GUARD_WRITE_TOOLS）成功完成后记录目标路径；只读工具
 *   （LOOP_GUARD_REREAD_TOOLS）引用这些路径时不阻塞（before）且计数重置为 1
 *   （after），避免打断合法的迭代式编辑。
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

/**
 * 会写入文件系统的工具：成功完成后提取目标路径记入本 session 的
 * recentEdits，供编辑后重读豁免判定使用。
 */
export const LOOP_GUARD_WRITE_TOOLS: Record<string, true> = {
  write: true,
  edit: true,
  apply_patch: true,
  ast_grep_replace: true,
};

/**
 * 享受编辑后重读豁免的只读工具。含不在硬阻塞集合中的 ast_grep_search：
 * 豁免作用于 after 的计数递增处，避免合法重读累计到告警阈值。
 */
export const LOOP_GUARD_REREAD_TOOLS: Record<string, true> = {
  read: true,
  grep: true,
  glob: true,
  ast_grep_search: true,
};

export const LOOP_GUARD_MARKER = '[重复工具调用 - 停止]';

/** 编辑后重读提示的幂等 marker 与提示文案。 */
export const LOOP_GUARD_REREAD_MARKER = '[loop-guard] 已识别为编辑后重读';
export const LOOP_GUARD_REREAD_HINT = `${LOOP_GUARD_REREAD_MARKER}，重置重复计数。`;

/** 每个 session 最多记录的最近编辑路径条数；超出按插入序（FIFO）淘汰。 */
export const MAX_RECENT_EDITS = 64;

/**
 * 生成告警文案；使用实际 warnAt 以便阈值可配置后文案仍准确。
 */
export function buildLoopGuardWarning(warnAt: number): string {
  return `
${LOOP_GUARD_MARKER}

你已连续 ${warnAt} 次发出参数完全相同的工具调用，并收到相同结果。这是无限循环，你没有取得进展。

停止重复此调用，改为：
1. 重新考虑你要查找的内容；上方结果已经包含此调用能提供的信息。
2. 如果需要不同信息，请发起不同调用（不同路径、模式或工具）。
3. 如果任务已经完成，现在直接给出最终答复，不要继续调用工具。
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

/**
 * 归一化工具入参中的文件路径：去除 file:// 前缀、统一为 posix 分隔符字符串，
 * 便于跨工具（write 的 path 与 read 的 file:// 路径等）做相等比较。
 * 非字符串或空串返回 null。
 */
function normalizeToolPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let path = raw;
  if (path.startsWith('file://')) {
    path = path.slice('file://'.length);
  }
  return path.replace(/\\/g, '/');
}

/**
 * 从写工具入参提取被修改的目标路径（归一化后）：
 * - write/edit/apply_patch：input.path
 * - ast_grep_replace：优先 input.paths 数组，否则回退 input.path（存在哪个用哪个）
 * 非写工具或无有效路径时返回空数组。
 */
function extractWrittenPaths(tool: string, input: unknown): string[] {
  if (!LOOP_GUARD_WRITE_TOOLS[tool]) return [];
  const args = (input ?? {}) as Record<string, unknown>;
  const paths: string[] = [];
  if (Array.isArray(args.paths)) {
    for (const raw of args.paths) {
      const normalized = normalizeToolPath(raw);
      if (normalized !== null) paths.push(normalized);
    }
    // paths 数组存在且非空时以数组为准。
    if (paths.length > 0) return paths;
  }
  const single = normalizeToolPath(args.path);
  if (single !== null) paths.push(single);
  return paths;
}

/**
 * 判定只读工具调用是否引用了本 session 最近编辑过的路径（编辑后重读）。
 * 命中规则刻意宽松、偏向不误伤：
 * - 精确路径：read/grep 的 input.path、ast_grep_search 的 input.paths 元素，
 *   归一化后存在于 recentEdits 即命中。
 * - glob 模式简化判定：grep 的 include、glob 的 pattern、ast_grep_search 的
 *   globs 元素，只要模式字符串包含任一被编辑路径的文件名部分即算命中。
 */
function isRereadAfterEdit(
  tool: string,
  input: unknown,
  recentEdits: Set<string> | undefined,
): boolean {
  if (!LOOP_GUARD_REREAD_TOOLS[tool]) return false;
  if (!recentEdits || recentEdits.size === 0) return false;

  const args = (input ?? {}) as Record<string, unknown>;

  // 1. 精确路径命中。
  const directPath = normalizeToolPath(args.path);
  if (directPath !== null && recentEdits.has(directPath)) return true;
  if (Array.isArray(args.paths)) {
    for (const raw of args.paths) {
      const normalized = normalizeToolPath(raw);
      if (normalized !== null && recentEdits.has(normalized)) return true;
    }
  }

  // 2. glob 模式简化命中：包含被编辑路径的文件名部分即算引用。
  const patterns: string[] = [];
  if (typeof args.include === 'string') patterns.push(args.include);
  if (typeof args.pattern === 'string') patterns.push(args.pattern);
  if (Array.isArray(args.globs)) {
    for (const raw of args.globs) {
      if (typeof raw === 'string') patterns.push(raw);
    }
  }
  if (patterns.length === 0) return false;
  for (const edited of recentEdits) {
    const basename = edited.split('/').pop();
    if (basename !== undefined && basename.length > 0) {
      if (patterns.some((pattern) => pattern.includes(basename))) return true;
    }
  }
  return false;
}

/**
 * 记录一条被编辑路径。重复路径先删后插，将其移到“最近”位置；超过
 * MAX_RECENT_EDITS 时按插入序（FIFO）淘汰最旧的。
 */
function addRecentEdit(recentEdits: Set<string>, path: string): void {
  recentEdits.delete(path);
  recentEdits.add(path);
  while (recentEdits.size > MAX_RECENT_EDITS) {
    const oldest = recentEdits.values().next().value as string | undefined;
    if (oldest === undefined) break;
    recentEdits.delete(oldest);
  }
}

/**
 * 向工具结果的可变文本字段追加一段文案（幂等：marker 已存在时不重复追加）。
 * 支持 v2 的 content 字符串、content 文本数组（只修改最后一个文本项）与
 * output 字符串。返回是否实际追加，便于调用方决定是否打日志。
 */
function appendResultText(
  result: ToolExecuteAfterCompletedEvent['result'],
  text: string,
  marker: string,
): boolean {
  if (typeof result.content === 'string') {
    if (result.content.includes(marker)) return false;
    result.content = `${result.content}\n${text}`;
    return true;
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
    // 故障开放：数组为空或没有文本项时静默跳过，不抛错。
    if (textIndex === -1) return false;
    const textItem = result.content[textIndex];
    // marker 幂等：文本项已含 marker 则不重复追加。
    if (textItem.text.includes(marker)) return false;
    const next = result.content.slice();
    next[textIndex] = { ...textItem, text: `${textItem.text}\n${text}` };
    result.content = next;
    return true;
  }
  if (typeof result.output === 'string') {
    if (result.output.includes(marker)) return false;
    result.output = `${result.output}\n${text}`;
    return true;
  }
  return false;
}

interface SessionState {
  /** 最近一次完成的可计数调用指纹（args）。 */
  last: string;
  /** 参数相同 AND 输出相同的连续完成调用次数。 */
  runs: number;
  /** 最近一次完成调用输出的指纹。 */
  lastOutput: string;
  /**
   * 本 session 最近被写工具成功修改过的目标路径（已归一化），用于编辑后
   * 重读豁免。上限 MAX_RECENT_EDITS（FIFO 淘汰），随 session 状态整体清理。
   */
  recentEdits?: Set<string>;
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

      // 编辑后重读豁免：硬阻塞工具引用了本 session 最近被写工具修改过的路径
      // 时，视为正常工作循环（编辑 → 重读），不阻塞。
      const rereadExempt =
        LOOP_GUARD_BLOCK_TOOLS[tool] === true &&
        isRereadAfterEdit(tool, input.input, existing?.recentEdits);

      // 仅在 CONFIRMED 相同 run 上拒绝：此前 blockAt 次调用参数与结果都相同。
      // 本次调用结果未知，但 run 已经是退化状态。
      if (
        !rereadExempt &&
        existing &&
        existing.last === key &&
        existing.runs >= blockAt &&
        LOOP_GUARD_BLOCK_TOOLS[tool]
      ) {
        log('[tool-loop-guard] 已阻止重复工具调用', {
          sessionID,
          tool,
          runs: existing.runs,
        });
        throw new Error(
          `拒绝执行“${tool}”：此完全相同的调用（相同工具、相同参数）已连续 ${existing.runs} 次返回相同结果，构成无限循环。请停止重复，重新评估目标，发起不同调用，或给出最终答复。`,
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
      const existing = sessions.get(sessionID);

      // 错误/非完成结果视为结果变化：重置 run，绝不向阻塞累计。
      if (input.status !== 'completed') {
        // 编辑记录与本次失败无关：保留 recentEdits；失败的写调用不新增路径。
        sessions.set(sessionID, {
          last: key ?? `${tool}:<untracked>`,
          runs: 1,
          lastOutput: '',
          recentEdits: existing?.recentEdits,
        });
        keepSessionsBounded();
        return;
      }

      const result = input.result;
      const outputHash = fingerprint(tool, {
        output: result.output,
        content: result.content,
      });

      // 编辑后重读豁免：只读工具引用了本 session 最近被写工具修改过的路径。
      const rereadExempt = isRereadAfterEdit(tool, input.input, existing?.recentEdits);

      let state: SessionState;
      if (!rereadExempt && existing && key !== undefined && key === existing.last) {
        // 参数相同：仅当结果也相同时才 +1；结果变化是进展，重置 run。
        state = {
          last: key,
          runs: outputHash === existing.lastOutput ? existing.runs + 1 : 1,
          lastOutput: outputHash,
          recentEdits: existing.recentEdits,
        };
      } else {
        // 参数不同 / 未跟踪调用 / 编辑后重读豁免：runs 重置为 1。
        // 豁免语义：编辑后重读按全新调用序列处理，不向重复计数累计——
        // 本实现的 SessionState 是每 session 单条计数，无法按 key 删除，
        // 等价做法是把该调用视为开启新 run（runs=1），因此豁免的重复重读
        // 永远无法累计到告警/阻塞阈值。
        state = {
          last: key ?? `${tool}:<untracked>`,
          runs: 1,
          lastOutput: outputHash,
          recentEdits: existing?.recentEdits,
        };
      }

      // 写工具成功完成：把目标路径记入本 session 的最近编辑集合（FIFO 上限）。
      for (const edited of extractWrittenPaths(tool, input.input)) {
        // recentEdits 不存在时惰性创建；随后由 sessions.set 持久化。
        state.recentEdits ??= new Set<string>();
        addRecentEdit(state.recentEdits, edited);
      }

      sessions.set(sessionID, state);
      keepSessionsBounded();

      if (rereadExempt) {
        // 豁免提示（marker 幂等）：不阻塞、不计数，仅告知计数已重置。
        appendResultText(result, LOOP_GUARD_REREAD_HINT, LOOP_GUARD_REREAD_MARKER);
        return;
      }

      if (state.runs < warnAt) return;

      // 追加告警到可变的文本字段（v2 结果文本在 result.content 或 result.output）。
      // 追加告警到可变的文本字段（v2 结果文本在 result.content 或 result.output）。
      // appendResultText 幂等（marker 已存在时不重复追加），返回是否实际追加。
      const warned = appendResultText(result, warningText, LOOP_GUARD_MARKER);
      if (warned) {
        log('[tool-loop-guard] 已警告重复工具调用', {
          sessionID,
          tool,
          runs: state.runs,
        });
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
