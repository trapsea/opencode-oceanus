export const TASK_STATES = ['queued','starting','running','blocked','cancel_requested','stopped','completed','failed','cancelled'] as const;
export type TaskState = typeof TASK_STATES[number];
export const TERMINAL_TASK_STATES = ['completed','failed','cancelled'] as const;
export function isTerminalTaskState(s: string): boolean { return (TERMINAL_TASK_STATES as readonly string[]).includes(s); }
