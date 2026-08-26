/**
 * 轻量 task registry。
 *
 * 仅作为受插件管理的子任务本地索引：记录 task id、父/子 session
 * ownership、状态、创建与最后活动时间。所有状态必须由调用方显式写入，
 * registry 不会伪造任何 v2 session 状态。
 *
 * 约束：
 * - 跨 session 访问拒绝：只有父 session 或子 session 可以读取/修改任务。
 * - 容量上限：达到上限前先清理已过期终态任务，仍不足则拒绝新增。
 * - 终态清理：终态任务在超过 TTL 后被移除。
 */
import {
  DEFAULT_OBSERVATION_MAX_TEXT_CHARS,
  isTerminalStatus,
  type NewTask,
  type TaskObservation,
  type TaskRecord,
  type TaskStatus,
} from './types';

/** 任务不存在。 */
export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`task 不存在: ${id}`);
    this.name = 'TaskNotFoundError';
  }
}

/** 调用方 session 无权访问该任务（跨 session 越权）。 */
export class TaskAccessDeniedError extends Error {
  constructor(id: string, sessionId: string) {
    super(`session ${sessionId} 无权访问 task ${id}`);
    this.name = 'TaskAccessDeniedError';
  }
}

/** 任务 id 已存在。 */
export class DuplicateTaskError extends Error {
  constructor(id: string) {
    super(`task 已存在: ${id}`);
    this.name = 'DuplicateTaskError';
  }
}

/** 达到容量上限，无法注册新任务。 */
export class TaskRegistryCapacityError extends Error {
  constructor(maxTasks: number) {
    super(`task registry 达到容量上限: ${maxTasks}`);
    this.name = 'TaskRegistryCapacityError';
  }
}

export interface RegistryOptions {
  /** 容量上限，默认 512。 */
  maxTasks?: number;
  /** 终态任务保留 TTL（ms）。超过该时长即被清理。默认 0：终态任务立即进入可清理状态。 */
  terminalTtlMs?: number;
  /** 时钟注入，便于测试，默认 Date.now。 */
  now?: () => number;
}

/** 默认容量上限。 */
export const DEFAULT_MAX_TASKS = 512;
/** 默认终态保留 TTL（ms）。 */
export const DEFAULT_TERMINAL_TTL_MS = 0;

export class TaskRegistry {
  private readonly byId = new Map<string, TaskRecord>();
  private readonly byStatus = new Map<TaskStatus, Set<string>>();
  private readonly bySession = new Map<string, Set<string>>();
  private readonly maxTasks: number;
  private readonly terminalTtlMs: number;
  private readonly now: () => number;

  constructor(options: RegistryOptions = {}) {
    this.maxTasks = options.maxTasks ?? DEFAULT_MAX_TASKS;
    this.terminalTtlMs = options.terminalTtlMs ?? DEFAULT_TERMINAL_TTL_MS;
    this.now = options.now ?? (() => Date.now());
    if (!Number.isFinite(this.maxTasks) || this.maxTasks <= 0) {
      throw new Error('maxTasks 必须为正整数');
    }
    if (!Number.isFinite(this.terminalTtlMs) || this.terminalTtlMs < 0) {
      throw new Error('terminalTtlMs 必须为非负数');
    }
  }

  /** 当前注册任务总数。 */
  count(): number {
    return this.byId.size;
  }

  /** 按状态索引查询的任务 id 集合（返回新数组，防止外部篡改内部索引）。 */
  idsByStatus(status: TaskStatus): string[] {
    return Array.from(this.byStatus.get(status) ?? []);
  }

  /** 按 session（父或子）索引查询的任务 id 集合。 */
  idsBySession(sessionId: string): string[] {
    return Array.from(this.bySession.get(sessionId) ?? []);
  }

  /**
   * 注册一个新任务。
   * 在容量不足时会先清理已过期的终态任务；清理后仍达上限则抛
   * TaskRegistryCapacityError。id 冲突抛 DuplicateTaskError。
   */
  create(task: NewTask): TaskRecord {
    if (!task.id) {
      throw new Error('task id 不能为空');
    }
    if (!task.parentSessionId) {
      throw new Error('parentSessionId 不能为空');
    }
    if (this.byId.has(task.id)) {
      throw new DuplicateTaskError(task.id);
    }

    // 容量控制：先尝试清理已过期终态任务。
    this.pruneExpiredTerminal(this.now());
    if (this.byId.size >= this.maxTasks) {
      throw new TaskRegistryCapacityError(this.maxTasks);
    }

    const createdAt = task.createdAt ?? this.now();
    const record: TaskRecord = {
      id: task.id,
      parentSessionId: task.parentSessionId,
      childSessionId: task.childSessionId,
      status: task.status ?? 'running',
      createdAt,
      lastActivityAt: createdAt,
      label: task.label,
    };

    this.byId.set(record.id, record);
    this.indexByStatus(record);
    this.indexBySession(record);

    return this.copyRecord(record);
  }

  /**
   * 读取任务。未找到返回 undefined；找到但调用方 session 既不是父也
   * 不是子时抛 TaskAccessDeniedError（跨 session 访问拒绝）。
   * 返回副本，外部修改不会影响内部索引。
   */
  get(id: string, sessionId: string): TaskRecord | undefined {
    const record = this.byId.get(id);
    if (!record) {
      return undefined;
    }
    this.assertAccessible(record, sessionId);
    return this.copyRecord(record);
  }

  /** 只读枚举任务（返回副本），供父/子 session 使用。 */
  listBySession(sessionId: string): TaskRecord[] {
    const ids = this.bySession.get(sessionId);
    if (!ids) {
      return [];
    }
    const records: TaskRecord[] = [];
    for (const id of ids) {
      const record = this.byId.get(id);
      if (record) {
        records.push(this.copyRecord(record));
      }
    }
    return records;
  }

  /**
   * 更新任务状态并刷新最后活动时间。
   * 未找到抛 TaskNotFoundError；越权访问抛 TaskAccessDeniedError。
   */
  updateStatus(
    id: string,
    sessionId: string,
    status: TaskStatus,
  ): TaskRecord {
    const record = this.byId.get(id);
    if (!record) {
      throw new TaskNotFoundError(id);
    }
    this.assertAccessible(record, sessionId);
    this.removeFromStatusIndex(record);
    record.status = status;
    record.lastActivityAt = this.now();
    this.indexByStatus(record);
    return this.copyRecord(record);
  }

  /** 刷新任务最后活动时间。未找到抛 TaskNotFoundError；越权访问抛 TaskAccessDeniedError。 */
  touch(id: string, sessionId: string): TaskRecord {
    const record = this.byId.get(id);
    if (!record) {
      throw new TaskNotFoundError(id);
    }
    this.assertAccessible(record, sessionId);
    record.lastActivityAt = this.now();
    return this.copyRecord(record);
  }

  /**
   * 为任务绑定子 session（维护父子 ownership 与 session 索引）。
   * 仅父 session 可调用；未找到抛 TaskNotFoundError，越权抛 TaskAccessDeniedError。
   * 返回副本，外部修改不影响内部索引。
   */
  attachChildSession(
    id: string,
    sessionId: string,
    childSessionId: string,
  ): TaskRecord {
    const record = this.byId.get(id);
    if (!record) {
      throw new TaskNotFoundError(id);
    }
    if (record.parentSessionId !== sessionId) {
      throw new TaskAccessDeniedError(id, sessionId);
    }
    if (!childSessionId) {
      throw new Error('childSessionId 不能为空');
    }
    if (record.childSessionId !== childSessionId) {
      if (record.childSessionId) {
        this.removeSessionId(record.childSessionId, record.id);
      }
      record.childSessionId = childSessionId;
      this.indexSessionId(childSessionId, record.id);
    }
    record.lastActivityAt = this.now();
    return this.copyRecord(record);
  }

  /**
   * 写入观察摘要（受限大小）。仅父 session 可调用；未找到抛 TaskNotFoundError，
   * 越权抛 TaskAccessDeniedError。
   * - 结果文本超过上限会被截断。
   * - 观察携带明确 child session 时同步绑定并维护 session 索引。
   * - 仅当观察状态为明确终态时才同步记录状态；running/unknown 不伪造终态。
   * 返回副本。
   */
  setObservation(
    id: string,
    sessionId: string,
    obs: TaskObservation,
  ): TaskRecord {
    const record = this.byId.get(id);
    if (!record) {
      throw new TaskNotFoundError(id);
    }
    if (record.parentSessionId !== sessionId) {
      throw new TaskAccessDeniedError(id, sessionId);
    }
    const normalized: TaskObservation = {
      source: obs.source,
      at: obs.at ?? this.now(),
      childSessionId: obs.childSessionId,
      status: obs.status,
      text: obs.text
        ? obs.text.slice(0, DEFAULT_OBSERVATION_MAX_TEXT_CHARS)
        : undefined,
    };
    if (
      normalized.childSessionId &&
      normalized.childSessionId !== record.childSessionId
    ) {
      if (record.childSessionId) {
        this.removeSessionId(record.childSessionId, record.id);
      }
      record.childSessionId = normalized.childSessionId;
      this.indexSessionId(normalized.childSessionId, record.id);
    }
    record.observation = normalized;
    record.lastActivityAt = this.now();
    if (normalized.status && isTerminalStatus(normalized.status)) {
      this.removeFromStatusIndex(record);
      record.status = normalized.status;
      this.indexByStatus(record);
    }
    return this.copyRecord(record);
  }

  /**
   * 清理超过 TTL 的终态任务，返回被清理的数量。
   * 未达 TTL 的终态任务会被保留，非终态任务（running/unknown）永不清理。
   */
  cleanup(referenceTime: number = this.now()): number {
    return this.pruneExpiredTerminal(referenceTime);
  }

  /** 立即清理所有终态任务（含未过 TTL 的），返回清理数量。 */
  pruneTerminal(): number {
    let removed = 0;
    for (const [id, record] of [...this.byId]) {
      if (isTerminalStatus(record.status)) {
        this.removeRecord(id);
        removed += 1;
      }
    }
    return removed;
  }

  /** 清空全部索引（仅用于测试或彻底重置）。 */
  clear(): void {
    this.byId.clear();
    this.byStatus.clear();
    this.bySession.clear();
  }

  private indexByStatus(record: TaskRecord): void {
    let set = this.byStatus.get(record.status);
    if (!set) {
      set = new Set();
      this.byStatus.set(record.status, set);
    }
    set.add(record.id);
  }

  private indexBySession(record: TaskRecord): void {
    this.indexSessionId(record.parentSessionId, record.id);
    if (record.childSessionId) {
      this.indexSessionId(record.childSessionId, record.id);
    }
  }

  private indexSessionId(sessionId: string, taskId: string): void {
    let set = this.bySession.get(sessionId);
    if (!set) {
      set = new Set();
      this.bySession.set(sessionId, set);
    }
    set.add(taskId);
  }

  private removeFromStatusIndex(record: TaskRecord): void {
    const set = this.byStatus.get(record.status);
    set?.delete(record.id);
    if (set && set.size === 0) {
      this.byStatus.delete(record.status);
    }
  }

  private removeFromSessionIndex(record: TaskRecord): void {
    this.removeSessionId(record.parentSessionId, record.id);
    if (record.childSessionId) {
      this.removeSessionId(record.childSessionId, record.id);
    }
  }

  private removeSessionId(sessionId: string, taskId: string): void {
    const set = this.bySession.get(sessionId);
    if (!set) {
      return;
    }
    set.delete(taskId);
    if (set.size === 0) {
      this.bySession.delete(sessionId);
    }
  }

  /** 返回记录副本，避免外部篡改内部索引；observation 同样复制。 */
  private copyRecord(record: TaskRecord): TaskRecord {
    return {
      ...record,
      observation: record.observation ? { ...record.observation } : undefined,
    };
  }

  /** 判断调用方 session 是否具备访问权限（父或子）。 */
  private canAccess(record: TaskRecord, sessionId: string): boolean {
    return (
      record.parentSessionId === sessionId ||
      record.childSessionId === sessionId
    );
  }

  private assertAccessible(record: TaskRecord, sessionId: string): void {
    if (!this.canAccess(record, sessionId)) {
      throw new TaskAccessDeniedError(record.id, sessionId);
    }
  }

  /** 移除超过 TTL 的终态任务，返回移除数量。 */
  private pruneExpiredTerminal(referenceTime: number): number {
    let removed = 0;
    for (const [id, record] of [...this.byId]) {
      if (!isTerminalStatus(record.status)) {
        continue;
      }
      const age = referenceTime - record.lastActivityAt;
      if (age >= this.terminalTtlMs) {
        this.removeRecord(id);
        removed += 1;
      }
    }
    return removed;
  }

  private removeRecord(id: string): void {
    const record = this.byId.get(id);
    if (!record) {
      return;
    }
    this.byId.delete(id);
    this.removeFromStatusIndex(record);
    this.removeFromSessionIndex(record);
  }
}
