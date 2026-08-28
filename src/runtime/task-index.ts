/**
 * TaskIndex：原生 subagent 调度元数据索引（持久化）。
 *
 * 设计约束（spec: native-session-orchestration）：
 * - taskID === childSessionID，单一标识；OpenCode V2 session 是执行事实源，
 *   本索引只保存元数据，绝不判定真实执行状态。
 * - 字段含 objective（供 dispatch-guard duplicate-objective）与
 *   resultConsumedAt（结果已消费，放行同目标重派）。
 * - lane 冲突/缺失显式拒绝；跨 parent 读写拒绝；损坏文件 fail-open。
 */
import { mkdir, readFile, rename, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

export const LANE_CONFLICT = 'LANE_CONFLICT';
export const LANE_REQUIRED = 'LANE_REQUIRED';
export const PARENT_OWNERSHIP = 'PARENT_OWNERSHIP';
export const TASK_NOT_FOUND = 'TASK_NOT_FOUND';

export type TaskState = 'running' | 'completed' | 'failed' | 'cancelled' | 'uncertain';

export interface TaskRecord {
  taskID: string;
  parentSessionID: string;
  agent: string;
  laneKey: string;
  objective: string;
  generation: number;
  state: TaskState;
  resultSummary?: string;
  terminal?: boolean;
  resultConsumedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface RegisterLaunchInput {
  taskID: string;
  parentSessionID: string;
  agent: string;
  laneKey: string;
  objective: string;
}

const now = () => Date.now();
const ACTIVE: TaskState[] = ['running', 'uncertain'];

export class TaskIndex {
  private constructor(
    private readonly file: string,
    private records: Map<string, TaskRecord>,
    private readonly degraded = false,
  ) {}

  static async open(opts: { workspaceRoot: string }): Promise<TaskIndex> {
    const dir = join(opts.workspaceRoot, '.oceanus');
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'tasks.json');
    let records = new Map<string, TaskRecord>();
    let degraded = false;
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as { schema_version?: string; tasks?: TaskRecord[] };
      if (raw?.schema_version === '1' && Array.isArray(raw.tasks)) {
        records = new Map(raw.tasks.map((t) => [t.taskID, t]));
      } else {
        degraded = true;
      }
    } catch {
      // 文件不存在或损坏：fail-open 为空索引；尝试保留损坏现场为 .bak 供诊断。
      degraded = true;
      try { await copyFile(file, `${file}.corrupt.bak`); } catch { /* 无文件或不可读 */ }
    }
    return new TaskIndex(file, records, degraded);
  }

  isDegraded(): boolean { return this.degraded; }

  private async persist(): Promise<void> {
    const payload = JSON.stringify({
      schema_version: '1',
      updated_at: now(),
      tasks: [...this.records.values()],
    }, null, 2);
    const tmp = `${this.file}.${process.pid}.${now()}.tmp`;
    await writeFile(tmp, payload);
    try { await copyFile(this.file, `${this.file}.bak`); } catch { /* 首次写入无旧文件 */ }
    await rename(tmp, this.file);
  }

  async registerLaunch(input: RegisterLaunchInput): Promise<TaskRecord> {
    if (!input.laneKey || !input.laneKey.trim()) throw new Error(LANE_REQUIRED);
    for (const t of this.records.values()) {
      if (t.parentSessionID === input.parentSessionID && t.laneKey === input.laneKey && ACTIVE.includes(t.state)) {
        throw new Error(`${LANE_CONFLICT}: lane ${input.laneKey} 已有 active 任务 ${t.taskID}`);
      }
    }
    const stamp = now();
    const old = this.records.get(input.taskID);
    const rec: TaskRecord = {
      taskID: input.taskID,
      parentSessionID: input.parentSessionID,
      agent: input.agent,
      laneKey: input.laneKey,
      objective: input.objective,
      generation: (old?.generation ?? 0) + 1,
      state: 'running',
      createdAt: old?.createdAt ?? stamp,
      updatedAt: stamp,
    };
    this.records.set(input.taskID, rec);
    await this.persist();
    return { ...rec };
  }

  get(taskID: string, parentSessionID: string): TaskRecord | undefined {
    const rec = this.records.get(taskID);
    if (!rec) return undefined;
    if (rec.parentSessionID !== parentSessionID) throw new Error(PARENT_OWNERSHIP);
    return { ...rec };
  }

  listByParent(parentSessionID: string): TaskRecord[] {
    return [...this.records.values()].filter((t) => t.parentSessionID === parentSessionID).map((t) => ({ ...t }));
  }

  async markTerminal(taskID: string, parentSessionID: string, state: 'completed' | 'failed' | 'cancelled', resultSummary?: string): Promise<TaskRecord> {
    const rec = this.records.get(taskID);
    if (!rec) throw new Error(TASK_NOT_FOUND);
    if (rec.parentSessionID !== parentSessionID) throw new Error(PARENT_OWNERSHIP);
    rec.state = state;
    rec.terminal = true;
    if (resultSummary !== undefined) rec.resultSummary = resultSummary;
    rec.updatedAt = now();
    await this.persist();
    return { ...rec };
  }

  async markUncertain(taskID: string, parentSessionID: string, note?: string): Promise<TaskRecord> {
    const rec = this.records.get(taskID);
    if (!rec) throw new Error(TASK_NOT_FOUND);
    if (rec.parentSessionID !== parentSessionID) throw new Error(PARENT_OWNERSHIP);
    rec.state = 'uncertain';
    if (note) rec.resultSummary = note;
    rec.updatedAt = now();
    await this.persist();
    return { ...rec };
  }

  async markResultConsumed(taskID: string, parentSessionID: string): Promise<TaskRecord> {
    const rec = this.records.get(taskID);
    if (!rec) throw new Error(TASK_NOT_FOUND);
    if (rec.parentSessionID !== parentSessionID) throw new Error(PARENT_OWNERSHIP);
    if (rec.resultConsumedAt === undefined) {
      rec.resultConsumedAt = now();
      rec.updatedAt = rec.resultConsumedAt;
      await this.persist();
    }
    return { ...rec };
  }
}
