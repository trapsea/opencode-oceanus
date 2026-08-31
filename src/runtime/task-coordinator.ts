/**
 * TaskCoordinator：单写入任务元数据协调器（spec: native-session-orchestration）。
 *
 * - OpenCode V2 session 是执行事实源；本协调器只维护 TaskIndex 元数据，
 *   reconcile 以 session.active/get 覆盖本地，绝不伪造终态。
 * - formatBoard 供编排器注入 active/unreconciled(uncertain)/reusable 摘要。
 * - reusable = completed + 结果已消费（resultConsumedAt）+ 指定 agent/lane 匹配。
 */
import { TaskIndex, type TaskRecord } from './task-index';
import { getSessionInfo, sessionActive, sessionOutcome } from './workspace';
import type { SessionLike } from './types';

export interface TaskCoordinatorOptions {
  workspaceRoot: string;
  session?: SessionLike;
  /** 注入索引（测试缝隙）；缺省打开 workspace 下 .oceanus/tasks.json。 */
  index?: TaskIndex;
}

export interface ReviveInput {
  taskID: string;
  parentSessionID: string;
  brief: string;
}

export function createTaskCoordinator(opts: TaskCoordinatorOptions) {
  const indexPromise = opts.index
    ? Promise.resolve(opts.index)
    : TaskIndex.open({ workspaceRoot: opts.workspaceRoot });
  let cache: TaskIndex | undefined;
  const idx = () => {
    if (!cache) throw new Error('COORDINATOR_NOT_READY');
    return cache;
  };
  void indexPromise.then((i) => { cache = i; }).catch(() => { /* fail-open：保持未就绪 */ });

  /** 宿主状态读取：不可确认 → undefined（绝不猜）。 */
  async function hostOutcome(taskID: string): Promise<'succeeded' | 'failed' | 'interrupted' | 'running' | undefined> {
    if (!opts.session) return undefined;
    try {
      const active = await sessionActive(opts.session, taskID);
      if (active === true) return 'running';
      return await sessionOutcome(opts.session, taskID);
    } catch {
      return undefined;
    }
  }

  return {
    async ready(): Promise<TaskIndex> {
      cache ??= await indexPromise;
      return cache;
    },

    async registerLaunch(input: Parameters<TaskIndex['registerLaunch']>[0]): Promise<TaskRecord> {
      return (await this.ready()).registerLaunch(input);
    },

    /**
     * 续用：非 running 状态皆可续用（uncertain/cancelled/failed 视为可恢复，completed 需已消费结果）。
     * LANE_CONFLICT 只挡 active（running）；uncertain 是「宿主未决」而非占用，允许 revive 续原 session。
     */
    async registerRevive(input: ReviveInput): Promise<TaskRecord> {
      const index = await this.ready();
      const rec = index.get(input.taskID, input.parentSessionID);
      if (!rec) throw new Error('TASK_NOT_FOUND');
      if (rec.state === 'running') throw new Error(`LANE_CONFLICT: lane ${rec.laneKey} 已有 active 任务`);
      // completed 有未消费结果时续用会丢结果，必须拦截；其余状态无结果可丢，直接续用。
      if (rec.state === 'completed' && rec.resultConsumedAt === undefined) throw new Error('RESULT_NOT_CONSUMED');
      return index.registerLaunch({
        taskID: input.taskID,
        parentSessionID: input.parentSessionID,
        agent: rec.agent,
        laneKey: rec.laneKey,
        objective: input.brief,
      });
    },

    /**
     * 登记兜底：bridge 登记缺失时以宿主事实补偿登记（spec: background-task-lifecycle 2026-08-28 修订）。
     *
     * - 已有记录 → 原样返回，幂等。
     * - 无记录 → `session.get` 验证该子会话存在且 `parentID === parentSessionID`，
     *   通过则 registerLaunch 并按宿主 outcome 立即收敛终态（不伪造：不可确认保持 running）。
     * - 宿主不可确认 / parentID 缺失或不匹配 → undefined（调用方报 TASK_NOT_FOUND）。
     * 安全：严格 parentID 校验，保持「coordinator 按父过滤」的跨父访问边界。
     */
    async ensureRegistered(taskID: string, parentSessionID: string): Promise<TaskRecord | undefined> {
      const index = await this.ready();
      const existing = index.get(taskID, parentSessionID);
      if (existing) return existing;
      if (!opts.session) return undefined;
      const info = await getSessionInfo(opts.session, taskID);
      if (!info) return undefined;
      if (typeof info.parentID !== 'string' || info.parentID !== parentSessionID) return undefined;
      const rec = await index.registerLaunch({
        taskID,
        parentSessionID,
        // 宿主 Session.Info 暴露 agent；缺失才回落 'unknown'。
        agent: typeof info.agent === 'string' && info.agent ? info.agent : 'unknown',
        // TaskIndex 强制 laneKey 非空；host-fallback 为兜底登记保留 lane（不与真实 lane 冲突）。
        laneKey: 'host-fallback',
        objective: 'host-verified fallback registration',
      });
      const outcome = info.outcome;
      if (outcome === 'succeeded') {
        return index.markTerminal(taskID, parentSessionID, 'completed');
      }
      if (outcome === 'failed') {
        return index.markTerminal(taskID, parentSessionID, 'failed');
      }
      if (outcome === 'interrupted') {
        // 宿主中断 = 未决可恢复，不降格为主动取消；绝不伪造终态。
        return index.markUncertain(taskID, parentSessionID);
      }
      return rec;
    },

    /** 以宿主事实覆盖本地状态；不可确认 → uncertain（不伪造终态）。 */
    async reconcile(parentSessionID: string): Promise<TaskRecord[]> {
      const index = await this.ready();
      const out: TaskRecord[] = [];
      for (const rec of index.listByParent(parentSessionID)) {
        if (rec.state === 'running' || rec.state === 'uncertain') {
          const oc = await hostOutcome(rec.taskID);
          if (oc === 'succeeded') {
            out.push(await index.markTerminal(rec.taskID, parentSessionID, 'completed'));
            continue;
          }
          if (oc === 'failed') {
            out.push(await index.markTerminal(rec.taskID, parentSessionID, 'failed'));
            continue;
          }
          if (oc === 'interrupted') {
            out.push(await index.markUncertain(rec.taskID, parentSessionID));
            continue;
          }
          if (oc === ('running' as const)) {
            out.push(rec);
            continue;
          }
          out.push(await index.markUncertain(rec.taskID, parentSessionID));
          continue;
        }
        out.push(rec);
      }
      return out;
    },

    /** 只读任务列表（dispatch-guard 等注入方使用；listByParent 为鸭子类型别名）。 */
    listTasks(parentSessionID: string): TaskRecord[] {
      if (!cache) return [];
      return cache.listByParent(parentSessionID);
    },
    listByParent(parentSessionID: string): TaskRecord[] {
      return this.listTasks(parentSessionID);
    },

    resolveReusable(parentSessionID: string, laneKey: string, agent?: string): TaskRecord | undefined {
      if (!cache) return undefined;
      return cache
        .listByParent(parentSessionID)
        .find((t) => t.laneKey === laneKey
          && t.state === 'completed'
          && t.resultConsumedAt !== undefined
          && (agent === undefined || t.agent === agent));
    },

    /** dispatch-guard duplicate-objective 输入：同 objective 存在终态未消费记录 → 重复。 */
    findDuplicateObjective(parentSessionID: string, objective: string): boolean {
      if (!cache) return false;
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      return cache
        .listByParent(parentSessionID)
        .some((t) => norm(t.objective) === norm(objective) && t.resultConsumedAt === undefined);
    },

    async markResultConsumed(taskID: string, parentSessionID: string): Promise<TaskRecord> {
      return (await this.ready()).markResultConsumed(taskID, parentSessionID);
    },

    async markTerminal(taskID: string, parentSessionID: string, state: 'completed' | 'failed' | 'cancelled', resultSummary?: string): Promise<TaskRecord> {
      return (await this.ready()).markTerminal(taskID, parentSessionID, state, resultSummary);
    },

    /** 宿主中断 → 未决可恢复（不伪造终态）；task_revive 对 interrupted outcome 的收敛入口。 */
    async markUncertain(taskID: string, parentSessionID: string, note?: string): Promise<TaskRecord> {
      return (await this.ready()).markUncertain(taskID, parentSessionID, note);
    },

    /** 编排器注入用 Job Board 摘要文本。 */
    formatBoard(parentSessionID: string): string | undefined {
      if (!cache) return undefined;
      const all = cache.listByParent(parentSessionID);
      if (all.length === 0) return undefined;
      const active = all.filter((t) => t.state === 'running' || t.state === 'uncertain');
      const completedUnconsumed = all.filter((t) => t.state === 'completed' && t.resultConsumedAt === undefined);
      const reusable = all.filter((t) => t.state === 'completed' && t.resultConsumedAt !== undefined);
      const recoverable = all.filter(
        (t) => (t.state === 'uncertain' || t.state === 'failed' || t.state === 'cancelled') && t.resultConsumedAt === undefined,
      );
      const line = (t: TaskRecord) => `- ${t.taskID} / ${t.agent} / lane:${t.laneKey} / ${t.state}${t.resultConsumedAt ? ' (result consumed)' : ''} -- ${t.objective.slice(0, 60)}`;
      return [
        '#### Active / Uncertain',
        ...(active.length ? active.map(line) : ['- none']),
        '',
        '#### Completed (read via task_result to consume)',
        ...(completedUnconsumed.length ? completedUnconsumed.map(line) : ['- none']),
        '',
        '#### Reusable Sessions (completed + consumed; revive with sessionID)',
        ...(reusable.length ? reusable.map(line) : ['- none']),
        '',
        '#### Recoverable (uncertain/interrupted/cancelled/failed — task_revive 续原 session 或重派)',
        ...(recoverable.length ? recoverable.map(line) : ['- none']),
      ].join('\n');
    },
  };
}

export type TaskCoordinator = ReturnType<typeof createTaskCoordinator>;
