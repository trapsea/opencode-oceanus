/**
 * subagent-bridge：原生 `subagent` 工具调用的元数据桥（spec: native-session-orchestration）。
 *
 * - 登记发生在工具结果返回 child sessionID 时（同步路径），不再事后推断。
 * - laneKey 结构化优先（input.lane_key / input.lane / input.laneKey），
 *   回退 description 唯一 `lane:<key>` 正则标记。
 * - 全链路 fail-open：bridge 任何异常只吞掉，绝不阻断宿主工具。
 * - 完成事件后以 coordinator（宿主事实）收敛终态，不伪造。
 */
import type { TaskCoordinator } from './task-coordinator';
import { runDispatchGuards } from './dispatch-guard';

export interface SubagentBridge {
  'execute.before': (event: any) => Promise<void>;
  'execute.after': (event: any) => Promise<void>;
}

export interface SubagentBridgeOptions {
  coordinator: TaskCoordinator;
  logger?: (message: string, meta?: Record<string, unknown>) => void;
}

const OBJECTIVE_MAX = 200;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 结构化 lane 优先；回退 description 中唯一的 lane:<key> 标记。 */
export function extractLane(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  for (const key of ['lane_key', 'laneKey', 'lane']) {
    const v = input[key];
    if (typeof v === 'string' && v.trim() && /^[A-Za-z0-9._/-]+$/.test(v.trim())) return v.trim();
  }
  const desc = input.description;
  if (typeof desc === 'string') {
    const matches = [...desc.matchAll(/(?:^|\s)lane:([^\s]+)/g)];
    if (matches.length === 1 && /^[A-Za-z0-9._/-]+$/.test(matches[0][1])) return matches[0][1];
  }
  return undefined;
}

/** objective：description 优先，回退 prompt 首个非空行。 */
export function extractObjective(input: unknown): string {
  if (!isRecord(input)) return '';
  const desc = typeof input.description === 'string' ? input.description.replace(/\s+/g, ' ').trim() : '';
  if (desc) return desc.slice(0, OBJECTIVE_MAX);
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const first = prompt.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).find(Boolean);
  return (first ?? '').slice(0, OBJECTIVE_MAX);
}

function resultText(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  for (const key of ['content', 'output', 'text']) {
    const v = result[key];
    if (typeof v === 'string' && v.length > 0) return v.slice(0, 2000);
  }
  return undefined;
}

export function createSubagentBridge(opts: SubagentBridgeOptions): SubagentBridge {
  const log = opts.logger ?? (() => {});
  const coordinator = opts.coordinator;
  /** callId → 派发元数据（before 建立，after 消费）。 */
  const pending = new Map<string, { parentSessionID: string; agent: string; laneKey?: string; objective: string }>();

  return {
    'execute.before': async (event) => {
      if (!event || event.tool !== 'subagent') return;
      // 派发纪律守卫（dispatch-guard）：角色冒名 / 同目标终态未消费重派。
      // 必须在 try 之外直接抛出——错误文本经宿主回流给编排模型实现自我纠正。
      runDispatchGuards(event, { coordinator: opts.coordinator });
      try {
        const parentSessionID = typeof event.sessionID === 'string' ? event.sessionID : undefined;
        const id = typeof event.id === 'string' ? event.id : undefined;
        if (!parentSessionID || !id || !isRecord(event.input)) return;
        pending.set(id, {
          parentSessionID,
          agent: typeof event.input.agent === 'string' ? event.input.agent : 'unknown',
          laneKey: extractLane(event.input),
          objective: extractObjective(event.input),
        });
      } catch (e) {
        log('subagent-bridge.before 失败(fail-open)', { error: e instanceof Error ? e.message : String(e) });
      }
    },

    'execute.after': async (event) => {
      if (!event || event.tool !== 'subagent') return;
      try {
        const id = typeof event.id === 'string' ? event.id : undefined;
        const parentSessionID = typeof event.sessionID === 'string' ? event.sessionID : undefined;
        const meta = id ? pending.get(id) : undefined;
        if (id) pending.delete(id);
        if (!meta || meta.parentSessionID !== parentSessionID) return;
        const result = event.result;
        if (!isRecord(result)) return;
        const taskID = typeof result.sessionID === 'string' && result.sessionID && result.sessionID !== parentSessionID
          ? result.sessionID
          : undefined;
        if (!taskID) return;
        const laneKey = meta.laneKey ?? '';
        await coordinator.registerLaunch({
          taskID,
          parentSessionID: meta.parentSessionID,
          agent: meta.agent,
          laneKey,
          objective: meta.objective,
        });
        // 状态收敛交给宿主事实（reconcile）；完成/失败事件先以宿主 outcome 为准，
        // 拿不到时不伪造终态，保持 running 供后续 reconcile。
        if (event.status === 'completed' || event.status === 'error') {
          await coordinator.reconcile(meta.parentSessionID).catch(() => undefined);
        }
        const text = resultText(result);
        if (text) {
          const records = await coordinator.reconcile(meta.parentSessionID).catch(() => []);
          const rec = records.find((r) => r.taskID === taskID);
          if (rec && rec.terminal) {
            await coordinator.markTerminal(taskID, meta.parentSessionID, rec.state as 'completed', text).catch(() => undefined);
          }
        }
      } catch (e) {
        log('subagent-bridge.after 失败(fail-open)', { error: e instanceof Error ? e.message : String(e) });
      }
    },
  };
}
