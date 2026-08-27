/** Job Board 与 progress ledger 的最小、单向同步边界。
 * Job Board 是运行态事实；ledger 只接收运行摘要，不反向驱动调度。
 */
export type BridgeDiagnostic = { code: string; taskId?: string; message: string };

export interface LedgerBridgeTask {
  taskId: string;
  state: string;
  [key: string]: unknown;
}

export interface JobBoardBridgeTask {
  task_id: string;
  state: string;
  generation: number;
  child_session_id?: string;
  agent?: string;
  runtime_summary?: string;
  verification_evidence?: unknown[];
  blocker?: string;
}

export interface LedgerBridgeResult<T extends { tasks: LedgerBridgeTask[] }> {
  ledger: T;
  diagnostics: BridgeDiagnostic[];
}

/** 仅复制 task id、运行摘要、worker/session、验证证据和 blocker。 */
export function bridgeJobBoardToLedger<T extends { tasks: LedgerBridgeTask[] }>(
  ledger: T,
  boardTasks: readonly JobBoardBridgeTask[],
  expectedGenerations: Readonly<Record<string, number>> = {},
): LedgerBridgeResult<T> {
  const diagnostics: BridgeDiagnostic[] = [];
  const board = new Map<string, JobBoardBridgeTask>();
  for (const task of boardTasks) {
    if (board.has(task.task_id)) diagnostics.push({ code: 'conflicting_task_id', taskId: task.task_id, message: `Job Board 出现重复 task ${task.task_id}` });
    board.set(task.task_id, task);
  }
  const tasks = ledger.tasks.map(entry => {
    const task = board.get(entry.taskId);
    if (!task) {
      diagnostics.push({ code: 'missing_job_board_task', taskId: entry.taskId, message: `Job Board 缺失 task ${entry.taskId}` });
      return entry;
    }
    const expected = expectedGenerations[entry.taskId];
    if (expected !== undefined && task.generation !== expected) {
      diagnostics.push({ code: 'stale_generation', taskId: entry.taskId, message: `task ${entry.taskId} generation 过旧：期望 ${expected}，实际 ${task.generation}` });
      return entry;
    }
    const runtime = {
      state: task.state,
      summary: task.runtime_summary,
      worker: task.agent,
      session: task.child_session_id,
      verificationEvidence: task.verification_evidence,
      blocker: task.blocker,
      generation: task.generation,
    };
    return { ...entry, runtime };
  });
  for (const task of boardTasks) if (!ledger.tasks.some(entry => entry.taskId === task.task_id))
    diagnostics.push({ code: 'missing_ledger_task', taskId: task.task_id, message: `progress ledger 缺失 task ${task.task_id}` });
  return { ledger: { ...ledger, tasks } as T, diagnostics };
}

export const syncJobBoardToLedger = bridgeJobBoardToLedger;
