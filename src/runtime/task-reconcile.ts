import type { JobBoard } from '../tools/task/job-board';
import { inspectV2 } from './task-capabilities';
import type { SessionLike } from './types';

export type ReconcileKind = 'active' | 'stopped' | 'unreconciled' | 'reusable' | 'lost';
export interface ReconcileResult { task_id: string; kind: ReconcileKind; certainty: 'certain' | 'uncertain'; state: string; }
export interface ReconcileOptions { board: JobBoard; session?: SessionLike; ownerAgent?: string; workspaceRoot?: string; now?: () => number; timeoutMs?: number; }

/** 启动时只依据宿主事实恢复；无法确认时保守标为 unreconciled/uncertain。 */
export async function reconcileTasks(opts: ReconcileOptions): Promise<ReconcileResult[]> {
  const now = opts.now ?? Date.now;
  const timeout = opts.timeoutMs ?? 300000;
  const result: ReconcileResult[] = [];
  for (const task of opts.board.tasks() as any[]) {
    if (opts.ownerAgent && task.ownership?.owner_agent && task.ownership.owner_agent !== opts.ownerAgent) continue;
    if (opts.workspaceRoot && task.workspace_root && task.workspace_root !== opts.workspaceRoot) continue;
    let kind: ReconcileKind = 'unreconciled';
    let certainty: 'certain' | 'uncertain' = 'uncertain';
    if (['completed', 'failed', 'cancelled'].includes(task.state)) {
      // 终态也必须由宿主 get 验证；读取失败不得伪造 authoritative。
      const inspected = opts.session && task.child_session_id
        ? await inspectV2(opts.session, task.child_session_id) : undefined;
      if (inspected?.info?.outcome === 'succeeded') {
        kind = task.reusable ? 'reusable' : 'stopped'; certainty = 'certain';
      }
    } else if (opts.session && task.child_session_id) {
      const inspected = await inspectV2(opts.session, task.child_session_id);
      if (inspected.info?.outcome === 'interrupted') {
        kind = 'stopped'; certainty = 'certain';
      } else if (inspected.info && task.state !== 'cancel_requested') {
        kind = 'active'; certainty = 'certain';
      } else if (now() - (task.last_activity_at ?? task.updated_at ?? now()) > timeout) {
        kind = 'lost';
      }
    } else if (task.state === 'stopped') { kind = 'stopped'; certainty = 'certain'; }
    const terminal = ['completed', 'failed', 'cancelled'].includes(task.state);
    const state = terminal ? task.state : (kind === 'active' ? 'running' : kind === 'stopped' ? 'stopped' : kind === 'lost' ? 'uncertain' : task.state);
    const reconciled = certainty === 'certain';
    // 只有已确认完成、具备 child 归属的任务才进入 reusable；通过 replace
    // 使用 board revision/task_version 做 CAS，避免并发 reconcile 覆盖新 attempt。
    const reusable = reconciled && state === 'completed' && !!task.child_session_id;
    const updated: any = { ...task, state, certainty: reconciled ? 'authoritative' : 'uncertain', reconciliation: reconciled ? 'reconciled' : 'unreconciled', reusable: reusable || (reconciled && task.reusable === true), recovery: { kind, certainty, at: now() } };
    try {
      // 每轮从 board 读取最新 revision/version，避免前一任务写入后沿用旧 revision。
      const fresh = opts.board.get(task.task_id);
      if (!fresh) continue;
      await opts.board.replace({ ...fresh, ...updated }, { expectedRevision: fresh.last_board_revision ?? 0, operationId: `reconcile-${fresh.task_id}-${fresh.generation}` });
    } catch { /* fail-open */ }
    result.push({ task_id: task.task_id, kind, certainty, state });
  }
  return result;
}

export const rehydrateTasks = reconcileTasks;
