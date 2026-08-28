/**
 * task 工具类型（native-session-orchestration 精简版）。
 *
 * taskID === childSessionID；执行状态以 OpenCode V2 原生 session 为准，
 * 本地类型只承载元数据视图，不伪造终态。
 */

/** 任务状态视图。uncertain 表示宿主无法确认，绝不映射为终态。 */
export type TaskStatus =
  | 'running'
  | 'unknown'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'uncertain';

/** 终态集合。 */
export const TERMINAL_STATUSES: readonly TaskStatus[] = [
  'completed',
  'failed',
  'cancelled',
];

/** 判断某个状态是否为终态。 */
export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
