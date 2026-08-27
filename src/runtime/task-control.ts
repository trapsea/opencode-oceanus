import type { SessionLike } from './types';
import { interruptV2, type CapabilityOutcome } from './task-capabilities';

/** 所有运行控制均要求调用方先完成持久化，再触碰宿主。 */
export interface TaskControlStore { persistGeneration(taskId: string, generation: number): Promise<void>; }

export async function interruptTask(
  store: TaskControlStore,
  session: SessionLike,
  taskId: string,
  childSessionId: string,
  generation: number,
): Promise<CapabilityOutcome> {
  await store.persistGeneration(taskId, generation);
  return interruptV2(session, childSessionId);
}

export function classifyHostFailure(error: unknown): 'uncertain' {
  // 控制操作任何无法确认的结果都必须 fail closed。
  void error;
  return 'uncertain';
}
