import type { BlockedRequest, DelegationBrief, TaskResult, TaskState, TaskCertainty, Reconciliation } from './types';

export interface TaskProtocol {
  state: TaskState;
  certainty: TaskCertainty;
  reconciliation: Reconciliation;
}

const text = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;
const version = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;

export function validateResult(x: unknown): string[] {
  const r = x as Partial<TaskResult>;
  return x && typeof x === 'object' && ['success', 'failure', 'blocked'].includes(r.status ?? '') && text(r.summary)
    ? [] : ['result'];
}

export function validateDelegationBrief(x: unknown): string[] {
  const b = x as Partial<DelegationBrief>;
  const errors: string[] = [];
  if (!version(b.board_revision)) errors.push('board_revision');
  if (!version(b.task_version)) errors.push('task_version');
  if (!version(b.generation)) errors.push('generation');
  if (!text(b.task_id)) errors.push('task_id');
  if (!text(b.objective)) errors.push('objective');
  if (!Array.isArray(b.capabilities) || b.capabilities.some(c => !text(c))) errors.push('capabilities');
  if (validateResult(b.result).length) errors.push('result');
  return errors;
}

export function validateBlockedRequest(x: unknown): string[] {
  const b = x as Partial<BlockedRequest>;
  return x && typeof x === 'object' && text(b.task_id) && text(b.reason) && Array.isArray(b.requested_capabilities) && b.requested_capabilities.every(text)
    ? [] : ['blocked_request'];
}

export function validateTaskProtocol(x: unknown): string[] {
  const p = x as Partial<TaskProtocol>;
  const errors: string[] = [];
  if (!['pending', 'running', 'completed', 'failed', 'blocked'].includes(p.state ?? '')) errors.push('state');
  if (!['certain', 'uncertain'].includes(p.certainty ?? '')) errors.push('certainty');
  if (!['not_required', 'required', 'complete'].includes(p.reconciliation ?? '')) errors.push('reconciliation');
  return errors;
}
