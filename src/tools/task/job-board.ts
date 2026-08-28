import { mkdir, readFile, rename, writeFile, copyFile, open, unlink, chmod } from 'node:fs/promises';
import { join } from 'node:path';

export class JobBoardCasError extends Error { constructor(message = 'CAS_CONFLICT') { super(message); } }
export class JobBoardAccessError extends Error {}
export class JobBoardPersistenceError extends Error {}

const transitions: Record<string, string[]> = {
  queued: ['starting'], starting: ['running', 'blocked', 'failed', 'uncertain', 'completed'],
  running: ['blocked', 'cancel_requested', 'stopped', 'completed', 'failed'],
  blocked: ['starting'], cancel_requested: ['cancelled', 'completed', 'failed', 'uncertain'],
  stopped: ['running'], uncertain: ['starting', 'cancelled', 'completed', 'failed'], completed: [], failed: [], cancelled: [],
};
const now = () => Date.now();
const payload = (x: unknown) => JSON.stringify(x);

export class JobBoard {
  private lock: Promise<void> = Promise.resolve();
  private constructor(private readonly file: string, private data: any, public degraded = false, private parent = '', private workspace = '') {}
  static async open(opts: { workspaceRoot: string; parentSessionId: string }) {
    const dir = join(opts.workspaceRoot, '.oceanus'); await mkdir(dir, { recursive: true });
    const file = join(dir, 'task-board.json'); let data: any; let degraded = false;
    for (const p of [file, `${file}.bak`]) { try { data = JSON.parse(await readFile(p, 'utf8')); validate(data); break; } catch (e: any) { if (e?.code !== 'ENOENT') degraded = true; } }
    if (!data) data = { schema_version: '1', board_id: `${opts.parentSessionId}-${now()}`, parent_session_id: opts.parentSessionId, parent_agent: 'sisyphus', workspace_root: opts.workspaceRoot, revision: 0, created_at: now(), updated_at: now(), event_log: [], tasks: [] };
    // board 文件是 workspace 与 parent 的归属契约；打开到另一归属时只读，
    // 防止误把共享工作区中的任务写入/复用到错误 lane。
    if (data.parent_session_id !== opts.parentSessionId || data.workspace_root !== opts.workspaceRoot) degraded = true;
    if (data.tasks.some((t: any) => t.parent_session_id !== data.parent_session_id || (t.workspace_root && t.workspace_root !== data.workspace_root))) degraded = true;
    return new JobBoard(file, data, degraded, opts.parentSessionId, opts.workspaceRoot);
  }
  tasks() { return this.degraded ? [] : this.data.tasks.map((x: any) => structuredClone(x)); }
  /** 返回同一归属/工作区/lane/agent 下仍可安全复用的任务。 */
  listReusable(opts: { agent?: string; lane_key?: string; workspace_root?: string; now?: number; ttlMs?: number; maxRetained?: number } = {}) {
    if (this.degraded) return [];
    const at = opts.now ?? now();
    let list = this.data.tasks.filter((t: any) => t.parent_session_id === this.parent &&
      t.reusable === true && t.reconciliation === 'reconciled' && t.state === 'completed' &&
      (opts.agent === undefined || t.agent === opts.agent) &&
      (opts.lane_key === undefined || t.lane_key === opts.lane_key) &&
      (opts.workspace_root === undefined || t.workspace_root === opts.workspace_root) &&
      (opts.ttlMs === undefined || at - (t.last_activity_at ?? t.updated_at ?? at) <= opts.ttlMs));
    list.sort((a: any, b: any) => (b.last_activity_at ?? b.updated_at ?? 0) - (a.last_activity_at ?? a.updated_at ?? 0));
    if (opts.maxRetained !== undefined) list = list.slice(0, Math.max(0, opts.maxRetained));
    return structuredClone(list);
  }
  get(id: string): any { if (this.degraded) return undefined; const t = this.data.tasks.find((x: any) => x.task_id === id); if (!t) throw Error('TASK_NOT_FOUND'); this.auth(t); return structuredClone(t); }
  /** 当前 board revision（观察链路 barrier 超时建任务时使用）。 */
  get revision() { return this.data.revision; }
  private auth(t: any, session?: string) { if (session && session !== this.parent || t.parent_session_id !== this.parent) throw new JobBoardAccessError('PARENT_OWNERSHIP'); }
  private async commit(next: any) {
    if (this.degraded) throw new JobBoardPersistenceError('DEGRADED_READ_ONLY');
    const lockFile = `${this.file}.lock`;
    let handle: any;
    for (let i = 0; i < 200; i++) {
      try { handle = await open(lockFile, 'wx'); break; } catch (e: any) {
        if (e?.code !== 'EEXIST') throw e;
        await new Promise(r => setTimeout(r, 2));
      }
    }
    if (!handle) throw new JobBoardPersistenceError('LOCK_TIMEOUT');
    const tmp = `${this.file}.${process.pid}.${now()}.tmp`;
    try {
      let current: any;
      try { current = JSON.parse(await readFile(this.file, 'utf8')); validate(current); } catch { current = this.data; }
      if (current.revision !== next.revision - 1) throw new JobBoardCasError();
      await writeFile(tmp, JSON.stringify(next, null, 2)); const h = await open(tmp, 'r'); await h.sync(); await h.close();
      try { await copyFile(this.file, `${this.file}.bak`); } catch { await copyFile(tmp, `${this.file}.bak`); }
      await rename(tmp, this.file); const d = await open(join(this.file, '..'), 'r'); await d.sync(); await d.close(); this.data = next;
    } catch (e) { try { await unlink(tmp); } catch {} throw e instanceof JobBoardCasError ? e : new JobBoardPersistenceError(String(e)); }
    finally { await handle.close(); try { await unlink(lockFile); } catch {} }
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> { const run = this.lock.then(fn); this.lock = run.then(() => undefined, () => undefined); return run; }
  async replace(task: any, o: { expectedRevision: number; operationId: string }) {
    const prior = this.data.tasks.find((t: any) => t.operations?.[o.operationId]); if (prior) { if (prior.operations[o.operationId] !== payload(task)) throw Error('IDEMPOTENCY_KEY_REUSE'); return structuredClone(prior); }
    if (this.degraded) throw new JobBoardPersistenceError('DEGRADED_READ_ONLY');
    if (this.data.revision !== o.expectedRevision) throw new JobBoardCasError();
    if (task.parent_session_id !== this.parent || task.ownership?.parent_session_id !== this.parent || (task.workspace_root && task.workspace_root !== this.workspace)) throw new JobBoardAccessError('PARENT_OWNERSHIP');
    const old = this.data.tasks.find((x: any) => x.task_id === task.task_id);
    const stamp = now(); const t = { certainty: 'authoritative', reconciliation: 'unreconciled', ownership: { parent_session_id: this.parent }, leases: {}, messages: [], created_at: stamp, last_activity_at: stamp, ...structuredClone(task), task_version: old ? old.task_version + 1 : (task.task_version ?? 0) + 1, generation: old?.generation ?? task.generation ?? 1, operations: { ...(old?.operations || task.operations || {}), [o.operationId]: payload(task) }, updated_at: stamp };
    const revision = this.data.revision + 1; t.last_board_revision = revision; const next = { ...this.data, revision, updated_at: now(), tasks: [...this.data.tasks.filter((x: any) => x.task_id !== t.task_id), t] }; await this.commit(next); return structuredClone(t);
  }
  async transition(id: string, state: string, o: any) {
    if (this.degraded) throw new JobBoardPersistenceError('DEGRADED_READ_ONLY');
    const t = this.get(id); this.auth(t, o.sessionId); const seen = t.operations?.[o.operationId]; if (seen) { if (seen !== payload({ state })) throw Error('IDEMPOTENCY_KEY_REUSE'); return t; }
    if (this.data.revision !== o.expectedRevision || t.task_version !== o.expectedTaskVersion || (o.expectedGeneration !== undefined && t.generation !== o.expectedGeneration)) throw new JobBoardCasError();
    if (!(transitions[t.state] || []).includes(state)) throw Error('INVALID_TRANSITION');
    const n = { ...t, state, task_version: t.task_version + 1, updated_at: now(), last_activity_at: now(), operations: { ...(t.operations || {}), [o.operationId]: payload({ state }) } }; const revision = this.data.revision + 1; n.last_board_revision = revision; return this.commit({ ...this.data, revision, updated_at: now(), tasks: this.data.tasks.map((x: any) => x.task_id === id ? n : x) }).then(() => structuredClone(n));
  }
  async revive(id: string, o: any) { const t = this.get(id); const op = { brief: o.brief, resumeId: o.resumeId, expectedRevision: o.expectedRevision, expectedTaskVersion: o.expectedTaskVersion, expectedGeneration: o.expectedGeneration }; const seen = t.operations?.[o.operationId]; if (seen) { if (seen !== payload(op)) throw Error('IDEMPOTENCY_KEY_REUSE'); return t; } if (!(t.state === 'blocked' || t.state === 'uncertain' || (t.reusable && ['completed','failed','cancelled'].includes(t.state)))) throw Error('NOT_REVIVEABLE'); if (!t.reusable && t.state !== 'blocked' && t.state !== 'uncertain') throw Error('NOT_REUSABLE'); if (this.data.revision !== o.expectedRevision || t.task_version !== o.expectedTaskVersion || t.generation !== o.expectedGeneration) throw new JobBoardCasError(); const n = { ...t, state: 'starting', generation: t.generation + 1, task_version: t.task_version + 1, continuation_brief: o.brief, resume_id: o.resumeId, updated_at: now(), last_activity_at: now(), operations: { ...(t.operations || {}), [o.operationId]: payload(op) } }; const revision = this.data.revision + 1; n.last_board_revision = revision; await this.commit({ ...this.data, revision, updated_at: now(), tasks: this.data.tasks.map((x: any) => x.task_id === id ? n : x) }); return structuredClone(n); }
  async messages(id: string) { if (this.degraded) return []; const t = this.get(id); return structuredClone(t?.messages ?? []); }
  /**
   * T4 outbox 追加：CAS（revision/task_version/generation）+ running 守卫，
   * sequence 由调用方按 task 内现存最大值分配。返回更新后的 task。
   */
  async appendMessage(id: string, msg: any, o: any) { const t = this.get(id); if (t.parent_session_id !== this.parent || t.state !== 'running' || t.generation !== o.generation) throw new JobBoardCasError('TASK_NOT_LIVE'); if (this.data.revision !== o.expectedRevision || t.task_version !== o.expectedTaskVersion) throw new JobBoardCasError(); const n = { ...t, messages: [...(t.messages ?? []), msg].slice(-32), task_version: t.task_version + 1 }; const revision = this.data.revision + 1; n.last_board_revision = revision; await this.commit({ ...this.data, revision, updated_at: now(), tasks: this.data.tasks.map((x: any) => x.task_id === id ? n : x) }); return structuredClone(n); }
  /** T4 outbox 状态更新（attempts/delivered/uncertain）：按 key 定位，CAS 保守更新。 */
  async updateMessage(id: string, key: string, patch: any, o: { expectedRevision: number; expectedTaskVersion: number; generation: number }) {
    if (this.degraded) throw new JobBoardPersistenceError('DEGRADED_READ_ONLY');
    const t = this.get(id);
    if (t.parent_session_id !== this.parent) throw new JobBoardAccessError('PARENT_OWNERSHIP');
    if (this.data.revision !== o.expectedRevision || t.task_version !== o.expectedTaskVersion || t.generation !== o.generation) throw new JobBoardCasError();
    const list = [...(t.messages ?? [])]; const i = list.findIndex((m: any) => m.key === key);
    if (i < 0) throw Error('MESSAGE_NOT_FOUND');
    list[i] = { ...list[i], ...patch, updatedAt: now() };
    const n = { ...t, messages: list };
    const revision = this.data.revision + 1; n.last_board_revision = revision;
    await this.commit({ ...this.data, revision, updated_at: now(), tasks: this.data.tasks.map((x: any) => x.task_id === id ? n : x) });
    return structuredClone(n);
  }
  async recordEvent(id: string, e: any) { const t = this.get(id); if (e.generation < t.generation) throw Error('STALE_EVENT'); return t; }

  /**
   * 应用观察事件（observer 专用入口）。
   * - 幂等：同 eventId 同 payload 直接返回当前任务，revision 不增加；
   *   同 eventId 不同 payload 抛 EVENT_CONFLICT，状态不变。
   * - generation fence：事件 generation < 当前 → STALE_EVENT；
   *   > 当前 → FUTURE_GENERATION；均不应用。等于当前才应用。
   * - 终态事件（completed/failed/interrupted）要求 eventId 为
   *   `${callId}:${phase}:${attempt}` 三段式，缺 callId/phase 抛 MISSING_EVENT_KEY。
   * - event_log 为 board（父）级缓冲，最多保留 32 条。
   */
  async applyObservedEvent(ev: {
    eventId: string; taskId: string; parentSessionId: string;
    childSessionId?: string; generation: number;
    kind: 'started' | 'completed' | 'failed' | 'interrupted';
    result?: any; at: number;
  }) {
    if (this.degraded) throw new JobBoardPersistenceError('DEGRADED_READ_ONLY');
    const t = this.get(ev.taskId);
    if (ev.parentSessionId !== this.parent || t.parent_session_id !== this.parent) throw new JobBoardAccessError('PARENT_OWNERSHIP');
    if (!Number.isInteger(ev.generation)) throw Error('INVALID_EVENT');
    if (!Array.isArray(this.data.event_log)) this.data.event_log = [];
    const log: any[] = this.data.event_log;
    const pl = payload(ev);
    // 幂等键：精确 eventId 匹配，或宿主缺 attempt 时同 `callId:phase` 且同 kind 的重试。
    const key = ev.eventId.split(':').slice(0, 2).join(':');
    const sameKind = (p: any) => { try { return JSON.parse(p).kind === ev.kind; } catch { return false; } };
    const prior = log.find((e: any) => e.eventId === ev.eventId || (e.eventId.split(':').slice(0, 2).join(':') === key && sameKind(e.payload)));
    if (prior) {
      if (prior.eventId === ev.eventId && prior.payload !== pl) throw Error('EVENT_CONFLICT');
      if (prior.eventId !== ev.eventId && !sameKind(prior.payload)) throw Error('EVENT_CONFLICT');
      return structuredClone(t); // 幂等重放：revision 不增加
    }
    // 宿主缺 attempt 的重试：同 callId:phase 但 kind 不同 → 冲突，不静默改判
    if (ev.eventId.split(':').length < 3 && log.some((e: any) => e.eventId.split(':').slice(0, 2).join(':') === key && !sameKind(e.payload))) throw Error('EVENT_CONFLICT');
    if (ev.kind !== 'started' && !/^[^:]+:[^:]+/.test(ev.eventId)) throw Error('MISSING_EVENT_KEY');
    if (ev.generation < t.generation) throw Error('STALE_EVENT');
    if (ev.generation > t.generation) throw Error('FUTURE_GENERATION');
    const state = ev.kind === 'started' ? 'running' : ev.kind === 'completed' ? 'completed' : ev.kind === 'failed' ? 'failed' : 'cancelled';
    const stamp = now();
    // 状态机守卫：只有合法转换才应用；终态不被同代迟到事件降级
    // （cancel_requested 遇 succeeded/failed → completed/failed，不改 cancelled）。
    if (t.state === state) {
      // 已处于目标状态的重复观察（如 started×running）：纯 no-op，不增加 revision
      return structuredClone(t);
    }
    if (!(transitions[t.state] || []).includes(state)) {
      // 迟到/非法事件：仅记录 event_log，任务状态与确定性不变，不伪造终态
      log.push({ eventId: ev.eventId, payload: pl, at: ev.at ?? stamp });
      if (log.length > 32) log.splice(0, log.length - 32);
      if (!this.degraded) { const next = { ...this.data, revision: this.data.revision + 1, updated_at: now(), event_log: log }; await this.commit(next); }
      return structuredClone(this.get(ev.taskId));
    }
    if (this.degraded) throw new JobBoardPersistenceError('DEGRADED_READ_ONLY');
    const n = { ...structuredClone(t), state, certainty: 'observed', pending_event: undefined, child_session_id: ev.childSessionId ?? t.child_session_id, result: ev.result ?? t.result, operations: { ...(t.operations || {}), [`event:${ev.eventId}`]: pl }, task_version: t.task_version + 1, updated_at: stamp, last_activity_at: stamp };
    const revision = this.data.revision + 1; n.last_board_revision = revision;
    log.push({ eventId: ev.eventId, payload: pl, at: ev.at ?? stamp });
    if (log.length > 32) log.splice(0, log.length - 32);
    const next = { ...this.data, revision, updated_at: now(), event_log: log, tasks: this.data.tasks.map((x: any) => x.task_id === ev.taskId ? n : x) };
    await this.commit(next);
    return structuredClone(n);
  }
}

 function validate(d: any) { if (!d || d.schema_version !== '1' || typeof d.board_id !== 'string' || typeof d.parent_session_id !== 'string' || typeof d.workspace_root !== 'string' || !Number.isInteger(d.revision) || !Number.isFinite(d.created_at) || !Number.isFinite(d.updated_at) || !Array.isArray(d.tasks)) throw Error('SCHEMA'); for (const t of d.tasks) if (!t.task_id || t.parent_session_id !== d.parent_session_id || !['queued','starting','running','blocked','cancel_requested','stopped','uncertain','completed','failed','cancelled'].includes(t.state) || !['authoritative','observed','uncertain'].includes(t.certainty) || !['unreconciled','reconciled'].includes(t.reconciliation) || !Number.isInteger(t.task_version) || !Number.isInteger(t.generation) || !Number.isInteger(t.last_board_revision) || !t.ownership || t.ownership.parent_session_id !== d.parent_session_id || !Number.isFinite(t.created_at) || !Number.isFinite(t.updated_at) || !Number.isFinite(t.last_activity_at)) throw Error('SCHEMA'); }

export { JobBoard as TaskBoard };
