import type { JobBoard } from '../tools/task/job-board';
import { inspectV2 } from './task-capabilities';
import type { SessionLike } from './types';

export type ReconcileKind = 'active' | 'stopped' | 'unreconciled' | 'reusable' | 'lost';
export interface ReconcileResult { task_id: string; kind: ReconcileKind; certainty: 'certain' | 'uncertain'; state: string; }
export interface ReconcileOptions { board: JobBoard; session?: SessionLike; ownerAgent?: string; now?: () => number; timeoutMs?: number; }

/** 启动时只依据宿主事实恢复；无法确认时保守标为 unreconciled/uncertain。 */
export async function reconcileTasks(opts: ReconcileOptions): Promise<ReconcileResult[]> {
  const now = opts.now ?? Date.now;
  const timeout = opts.timeoutMs ?? 300000;
  const result: ReconcileResult[] = [];
  for (const task of opts.board.tasks() as any[]) {
    if (opts.ownerAgent && task.ownership?.owner_agent && task.ownership.owner_agent !== opts.ownerAgent) continue;
    let kind: ReconcileKind = 'unreconciled';
    let certainty: 'certain' | 'uncertain' = 'uncertain';
    if (['completed', 'failed', 'cancelled'].includes(task.state)) {
      kind = task.reusable ? 'reusable' : 'stopped'; certainty = 'certain';
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
    const updated: any = { ...task, state, certainty: certainty === 'certain' ? 'authoritative' : 'uncertain', reconciliation: certainty === 'certain' ? 'reconciled' : 'unreconciled', recovery: { kind, certainty, at: now() } };
    try { await opts.board.replace(updated, { expectedRevision: task.last_board_revision ?? 0, operationId: `reconcile-${task.task_id}-${task.generation}` }); } catch { /* fail-open */ }
    result.push({ task_id: task.task_id, kind, certainty, state });
  }
  return result;
}

export const rehydrateTasks = reconcileTasks;
