/**
 * dispatch-guard：subagent/task 派发纪律守卫（可教学的硬拦截）。
 *
 * 背景（2026-08-27 复盘）：长会话压缩后编排模型曾出现两类漂移——
 * ① 角色冒名：prompt 以「你是 Momus…」开头但 input.agent="general"，
 *    用通用 agent 冒充专家伪造质量门禁（13 连发）；
 * ② 同目标重复派发：既有终态任务结果未被读取/消费时按相同目标再派发新任务。
 *
 * 设计对齐 oh-my-opencode-slim `task-session-manager/tool-execute-hooks` 范式：
 * - 在 tool.execute.before 阶段直接 throw，错误文本作为 tool failure 回流给
 *   编排模型 —— “报错即提示词”：文本必须点名违规并给出正确替代动作。
 * - 只拦截这两类明确违规；其余一律放行。inspectDispatch 自身不做 IO、
 *   绝不抛错；duplicate 匹配依赖注入的 coordinator 只读视图（鸭子类型，
 *   与 createTaskCoordinator().listTasks 语义一致）。
 */

import { AGENT_ALIASES } from '../config/constants';

/** 守卫可识别的原生子代理名集合（与 config/constants SUBAGENT_NAMES 对齐）。 */
const GUARD_AGENT_NAMES: ReadonlySet<string> = new Set([
  'explorer',
  'librarian',
  'oracle',
  'designer',
  'fixer',
  'observer',
  'metis',
  'momus',
]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function pickString(obj: unknown, keys: string[]): string | undefined {
  if (!isRecord(obj)) return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/** 归一化别名（AGENT_ALIASES：explore→explorer 等）。 */
function canonicalAgentName(name: string): string {
  return AGENT_ALIASES[name] ?? name;
}

/**
 * 从 prompt 开头片段提取被点名的专家角色。
 * 匹配「你是 X」「You are X」「扮演 X」「Act as X」等第二人称指派句式；
 * 非 zh/en 前缀或无命中返回 undefined。
 */
export function extractPersonaSubject(prompt: string): string | undefined {
  const head = prompt.slice(0, 160);
  const match = head.match(
    /(?:你是|You\s+are|扮演|[Aa]ct\s+as)\s*(?:the\s+)?([A-Za-z]+)/,
  );
  if (!match) return undefined;
  const subject = canonicalAgentName(match[1].toLowerCase());
  return GUARD_AGENT_NAMES.has(subject) ? subject : undefined;
}

/** 目标归一化：折叠空白、小写化。 */
export function normalizeObjectiveText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 由 description + prompt 推导派发目标键（限长 400）。 */
export function deriveObjectiveKey(
  description: unknown,
  prompt: unknown,
): string | undefined {
  const parts: string[] = [];
  if (typeof description === 'string' && description.trim()) parts.push(description);
  if (typeof prompt === 'string' && prompt.trim()) parts.push(prompt);
  if (parts.length === 0) return undefined;
  return normalizeObjectiveText(parts.join('\n')).slice(0, 400);
}

const TERMINAL_STATES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

/**
 * duplicate-objective 规则所需的 coordinator 只读视图（鸭子类型最小接口）。
 * createTaskCoordinator() 返回对象的 listTasks(parentSessionID) 满足该结构；
 * 此处不 import 具体类，避免守卫对存储实现产生耦合。
 */
export interface DispatchGuardTask {
  taskID: string;
  agent: string;
  objective: string;
  state: string;
  /** 终态结果已被 task_result 读取的时间戳；undefined 表示未消费。 */
  resultConsumedAt?: number;
}

export interface DispatchGuardCoordinator {
  /** 列出指定 parent 会话名下的任务记录（只读）。 */
  listByParent(parentSessionID: string): DispatchGuardTask[];
}

export interface DispatchViolation {
  rule: 'persona-mismatch' | 'duplicate-objective';
  message: string;
}

/**
 * 检查单次派发是否违反纪律。返回第一个命中的违规；无违规返回 null。
 * 纯函数（coordinator 只读），绝不抛错、不改写输入；
 * coordinator 缺失或故障时规则②静默降级放行（fail-open）。
 */
export function inspectDispatch(
  event: any,
  coordinator?: DispatchGuardCoordinator,
): DispatchViolation | null {
  if (!isRecord(event)) return null;
  const input = event.input;
  if (!isRecord(input)) return null;

  const agentRaw = pickString(input, ['agent', 'subagent_type']);
  const prompt = input.prompt;

  // ── 规则①：角色冒名（persona mismatch）───────────────────────────
  if (typeof agentRaw === 'string') {
    const agent = canonicalAgentName(agentRaw.trim());
    if (
      typeof prompt === 'string' &&
      prompt.length > 0
    ) {
      const subject = extractPersonaSubject(prompt);
      // 无论被派发的 agent 是什么（general/未知名也含），只要 prompt 指名了
      // 另一位专家而 agent 不一致即视为冒名。
      if (subject && subject !== agentRaw.trim() && subject !== agent) {
        return {
          rule: 'persona-mismatch',
          message:
            `DispatchGuard 角色冒名拦截：prompt 以「你是 ${subject}」开头，但本次派发的 agent 为 "${agentRaw}"。` +
            `专家审查必须使用原生名派发（agent="${subject}"）；若动机是避免“重复新建”，` +
            `正确路径是用 task_revive 续用既有任务的原 sessionID，或以原生 subagent 显式传入原 sessionID 续用该会话，` +
            `绝不能用其它 agent 冒充专家。`,
        };
      }
    }
  }

  // ── 规则②：同目标终态未消费的重复派发（slim #1070 同类）────────────
  if (coordinator && typeof event.sessionID === 'string') {
    // 显式 taskId/task_id/sessionID 是续用通道：不属于“新派发”，放行。
    const explicitId = pickString(input, ['taskId', 'task_id', 'sessionID']);
    if (!explicitId) {
      const agentRaw2 = pickString(input, ['agent', 'subagent_type']);
      const agent =
        agentRaw2 === undefined ? undefined : canonicalAgentName(agentRaw2.trim());
      const objectiveKey = deriveObjectiveKey(
        input.description,
        input.prompt,
      );
      if (agent && objectiveKey) {
        let tasks: unknown;
        try {
          tasks = coordinator.listByParent(event.sessionID);
        } catch {
          // coordinator 故障：fail-open 放行，绝不因守卫自身抛错。
          return null;
        }
        if (!Array.isArray(tasks)) return null;
        for (const t of tasks as DispatchGuardTask[]) {
          if (!isRecord(t)) continue;
          if (canonicalAgentName(String(t.agent ?? '')) !== agent) continue;
          if (!TERMINAL_STATES.has(String(t.state))) continue;
          // 结果已被 task_result 读取（resultConsumedAt 已写入）→ 允许重试/继续。
          if (t.resultConsumedAt !== undefined) continue;
          const priorKey = normalizeObjectiveText(String(t.objective ?? ''));
          if (priorKey && priorKey === objectiveKey) {
            return {
              rule: 'duplicate-objective',
              message:
                `DispatchGuard 同目标重派拦截：任务 ${t.taskID}（agent=${t.agent}，state=${t.state}）` +
                `目标与本次派发一致，且终态结果尚未被读取。请先调用 task_result(task_id="${t.taskID}") 读取结果——` +
                `读取后即视为已消费，才允许重试或基于其结论继续；若目的是提交实质修订后的复审，` +
                `请用 task_revive 续用该任务的原 sessionID（taskID=${t.taskID}），` +
                `或以原生 subagent 显式传入该 sessionID 续用既有会话，不要再次派发新任务。`,
            };
          }
        }
      }
    }
  }

  return null;
}

/**
 * 对外入口：命中违规直接 throw（错误文本回流给编排模型实现自我纠正）。
 * 在派发链路（tool.execute.before）最前面调用（任何 fail-open 记录之前）。
 * 第二参数可选：未注入 coordinator 时规则②静默降级（向后兼容窗口期）。
 */
export function runDispatchGuards(
  event: any,
  opts: { coordinator?: DispatchGuardCoordinator } = {},
): void {
  const violation = inspectDispatch(event, opts.coordinator);
  if (violation) {
    throw new Error(`[${violation.rule}] ${violation.message}`);
  }
}
