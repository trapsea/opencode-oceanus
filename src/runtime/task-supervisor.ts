import type { JobBoard } from '../tools/task/job-board';
import { interruptV2, type CapabilityOutcome } from './task-capabilities';
import { reconcileTasks, type ReconcileOptions, type ReconcileResult } from './task-reconcile';
import type { SessionLike } from './types';

export interface TaskSupervisorOptions extends Omit<ReconcileOptions, 'board' | 'session'> {
  board: JobBoard; session?: SessionLike; ownerAgent?: string; persistGeneration?: (id: string, generation: number) => Promise<void>;
}
export interface TaskSupervisor { rehydrate(): Promise<ReconcileResult[]>; cancel(taskId: string): Promise<CapabilityOutcome>; }

const TERMINAL = ['completed', 'failed', 'cancelled'];

export function createTaskSupervisor(opts: TaskSupervisorOptions): TaskSupervisor {
  let boot: Promise<ReconcileResult[]> | undefined;
  const rehydrate = () => (boot ??= reconcileTasks(opts));
  return {
    rehydrate,
    async cancel(taskId) {
      await rehydrate();
      const task: any = opts.board.get(taskId);
      if (opts.ownerAgent && task.ownership?.owner_agent && task.ownership.owner_agent !== opts.ownerAgent) return 'uncertain';
      // 终态任务：cancel 是 no-op，不触碰宿主、不降级终态。
      if (TERMINAL.includes(task.state)) return 'delivered';
      if (task.state === 'running' && typeof (opts.board as any).transition === 'function') {
        try {
          await opts.board.transition(taskId, 'cancel_requested', {
            sessionId: task.parent_session_id,
            expectedRevision: task.last_board_revision ?? 0,
            expectedTaskVersion: task.task_version,
            expectedGeneration: task.generation,
            operationId: `cancel-${taskId}-${task.generation}`,
          });
        } catch { return 'uncertain'; }
      }
      if (opts.persistGeneration) await opts.persistGeneration(taskId, task.generation);
      if (!opts.session || !task.child_session_id) return 'unsupported';
      const outcome = await interruptV2(opts.session, task.child_session_id);
      // 以宿主事实收敛：succeeded→completed、failed→failed、interrupted→cancelled。
      // cancel_requested 遇 succeeded/failed 不改成 cancelled；host 不可确认时保持
      // uncertain，不伪造终态或送达。
      if (typeof (opts.board as any).transition === 'function') {
        try {
          const current: any = opts.board.get(taskId);
          if (!TERMINAL.includes(current.state)) {
            const info = await opts.session.get({ sessionID: current.child_session_id });
            const oc = info?.outcome;
            const target = oc === 'succeeded' ? 'completed' : oc === 'failed' ? 'failed' : oc === 'interrupted' ? 'cancelled' : undefined;
            if (target) {
              // running→cancelled 不在状态机内：先 cancel_requested 再 cancelled。
              if (current.state === 'running' && target === 'cancelled') {
                await opts.board.transition(taskId, 'cancel_requested', {
                  sessionId: current.parent_session_id,
                  expectedRevision: current.last_board_revision ?? 0,
                  expectedTaskVersion: current.task_version,
                  expectedGeneration: current.generation,
                  operationId: `cancel-pre-${taskId}-${current.generation}`,
                });
              }
              const latest: any = opts.board.get(taskId);
              if (!TERMINAL.includes(latest.state) && latest.state !== target) {
                await opts.board.transition(taskId, target, {
                  sessionId: latest.parent_session_id,
                  expectedRevision: latest.last_board_revision ?? 0,
                  expectedTaskVersion: latest.task_version,
                  expectedGeneration: latest.generation,
                  operationId: `cancel-finish-${taskId}-${latest.generation}`,
                });
              }
            } else if (outcome === 'delivered') {
              // interrupt 已送达但宿主无终态可确认：不伪造 cancelled。
              return 'uncertain';
            }
          }
        } catch { return 'uncertain'; }
      }
      return outcome;
    },
  };
}

export async function startTaskSupervisor(opts: TaskSupervisorOptions): Promise<TaskSupervisor> {
  const supervisor = createTaskSupervisor(opts);
  await supervisor.rehydrate();
  return supervisor;
}
