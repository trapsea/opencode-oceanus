/**
 * task registry 的类型定义。
 *
 * 本模块只描述插件自身维护的轻量本地索引（task registry），
 * 用于记录受插件管理的子任务元数据。它不伪造任何 v2 session
 * 状态：终态只能由调用方显式写入，registry 不会把未知状态伪装成
 * 完成或失败。
 */

/** 任务状态。终态之外的状态不会被清理，也不会被伪装成已完成。 */
export type TaskStatus =
  | 'running'
  | 'unknown'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** 终态集合：只有进入终态的任务才有资格被清理。 */
export const TERMINAL_STATUSES: readonly TaskStatus[] = [
  'completed',
  'failed',
  'cancelled',
];

/** 判断某个状态是否为终态。 */
export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * 观察结果的受限文本摘要长度上限（字符）。
 * observer 只保留有限长度的文本，避免结果撑爆 registry。
 */
export const DEFAULT_OBSERVATION_MAX_TEXT_CHARS = 2000;

/**
 * 由内部 `task_registry_observer` 写入的观察摘要。
 * 仅记录从宿主事件中明确可识别的信息；未知形状不猜测、不伪造。
 */
export interface TaskObservation {
  /** 观察来源标识（如 'host-before' / 'host-after'），便于审计。 */
  source: string;
  /** 明确识别到的子 session id（仅在可识别时写入）。 */
  childSessionId?: string;
  /** 受限长度的文本结果摘要。 */
  text?: string;
  /** 观察到的状态（仅当可明确推断时；未知形状缺省）。 */
  status?: TaskStatus;
  /** 观察时间戳（ms）。 */
  at: number;
}

/** 创建任务时的入参。id 必须由调用方显式提供。 */
export interface NewTask {
  /** 任务 id。来自调用方（后续由 v2 session id 派生），registry 不自行生成。 */
  id: string;
  /** 发起该任务的父 session id。任何访问都必须具备该 session 的授权。 */
  parentSessionId: string;
  /** 执行该任务的子 session id（例如 subagent session），可选。 */
  childSessionId?: string;
  /** 初始状态，默认 'running'。 */
  status?: TaskStatus;
  /** 创建时间戳（ms）。默认取注册时刻。 */
  createdAt?: number;
  /** 便于观测的可读标签，可选。 */
  label?: string;
  /** 任务 generation（revive 递增）。缺省 1。 */
  generation?: number;
  agent?: string;
  lane_key?: string;
  workspace_root?: string;
  objective?: string;
  /** 能力分层：只有 controlled 才可进入受控生命周期。 */
  control?: 'controlled' | 'diagnostic';
  nativeTaskId?: string;
  capabilities?: string[];
}

/** registry 中存储的单条任务记录。 */
export interface TaskRecord {
  id: string;
  parentSessionId: string;
  childSessionId?: string;
  status: TaskStatus;
  createdAt: number;
  lastActivityAt: number;
  /** 任务 generation，缺省 1；revive 后递增，用于拒绝旧事件。 */
  generation: number;
  label?: string;
  /** 观察到的结果摘要（受限大小，仅 observer 写入）。 */
  observation?: TaskObservation;
  agent?: string;
  lane_key?: string;
  workspace_root?: string;
  objective?: string;
  reusable?: boolean;
  control?: 'controlled' | 'diagnostic';
  nativeTaskId?: string;
  capabilities?: string[];
}

/** 任务协议中可跨 agent 传递的委派摘要。 */
export interface DelegationBrief {
  board_revision: number;
  task_version: number;
  generation: number;
  task_id: string;
  objective: string;
  capabilities: string[];
  result: TaskResult;
}

export interface BlockedRequest {
  task_id: string;
  reason: string;
  requested_capabilities: string[];
}

export type TaskState = 'queued' | 'starting' | 'running' | 'blocked' | 'cancel_requested' | 'stopped' | 'uncertain' | 'completed' | 'failed' | 'cancelled';
export type TaskCertainty = 'authoritative' | 'observed' | 'uncertain';
export type Reconciliation = 'unreconciled' | 'reconciled';
export interface TaskResult { status: 'success' | 'failure' | 'blocked'; summary: string }

/**
 * observer 从宿主 execute.before/after 事件派生的观察事件。
 * eventId 约定为 `${callId}:${phase}:${attempt}`；终态事件缺 callId/phase 不应用。
 */
export interface ObservedTaskEvent {
  /** `${callId}:${phase}:${attempt}`，幂等键。 */
  eventId: string;
  taskId: string;
  parentSessionId: string;
  childSessionId?: string;
  /** 事件所属 generation；小于任务当前 generation 视为陈旧。 */
  generation: number;
  kind: 'started' | 'completed' | 'failed' | 'interrupted';
  result?: TaskResult;
  at: number;
}
