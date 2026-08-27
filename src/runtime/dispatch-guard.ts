/**
 * dispatch-guard：subagent/task 派发纪律守卫（可教学的硬拦截）。
 *
 * 背景（2026-08-27 复盘）：长会话压缩后编排模型曾出现两类漂移——
 * ① 角色冒名：prompt 以「你是 Momus…」开头但 input.agent="general"，
 *    用通用 agent 冒充专家伪造质量门禁（13 连发）；
 * ② 同目标重复派发：既有终态任务未被读取/确认时按相同目标再 spawn 新任务。
 *
 * 设计对齐 oh-my-opencode-slim `task-session-manager/tool-execute-hooks` 范式：
 * - 在 tool.execute.before 阶段直接 throw，错误文本作为 tool failure 回流给
 *   编排模型 —— “报错即提示词”：文本必须点名违规并给出正确替代动作。
 * - 只拦截这两类明确违规；其余一律放行。inspectDispatch 自身不做 IO，
 *   board 匹配依赖注入的 JobBoard 只读视图。
 */

import type { JobBoard } from '../tools/task/job-board';
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

export interface DispatchViolation {
  rule: 'persona-mismatch' | 'duplicate-objective';
  message: string;
}

/**
 * 检查单次派发是否违反纪律。返回第一个命中的违规；无违规返回 null。
 * 纯函数（board 只读），绝不抛错、不改写输入。
 */
export function inspectDispatch(
  event: any,
  board?: JobBoard,
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
            `专家审查必须使用原生名派发（agent="${subject}"）；若动机是避免“重复新建”，正确路径是用 ` +
            `task_reuse / task_revive 续用既有 child session（Job Board 的 reusable 记录），` +
            `绝不能用其它 agent 冒充专家。`,
        };
      }
    }
  }

  // ── 规则②：同目标终态未消费的重复派发（slim #1070 同类）────────────
  if (board && isRecord(event)) {
    const explicitTaskId = pickString(input, ['taskId', 'task_id']);
    // 显式 task_id 是 revive/reuse 通道：不属于“新 spawn”，放行。
    if (!explicitTaskId && typeof event.sessionID === 'string') {
      const agentRaw2 = pickString(input, ['agent', 'subagent_type']);
      const agent =
        agentRaw2 === undefined ? undefined : canonicalAgentName(agentRaw2.trim());
      const objectiveKey = deriveObjectiveKey(
        input.description,
        input.prompt,
      );
      if (agent && GUARD_AGENT_NAMES.has(agent) && objectiveKey) {
        for (const t of board.tasks() as any[]) {
          if (t.parent_session_id !== event.sessionID) continue;
          if (canonicalAgentName(String(t.agent ?? '')) !== agent) continue;
          if (!TERMINAL_STATES.has(String(t.state))) continue;
          if (t.reconciliation !== 'unreconciled') continue;
          const lastUsedAt =
            typeof t.last_used_at === 'number' ? t.last_used_at : Number.NEGATIVE_INFINITY;
          const settledAt =
            typeof t.updated_at === 'number' ? t.updated_at : 0;
          // 结果已被读取（last_used_at > 终态落板时间）→ 允许重试/继续。
          if (lastUsedAt > settledAt) continue;
          const priorKey = normalizeObjectiveText(
            String(t.objective_key ?? t.objective ?? t.description ?? ''),
          );
          if (priorKey && priorKey === objectiveKey) {
            return {
              rule: 'duplicate-objective',
              message:
                `DispatchGuard 同目标重派拦截：任务 ${t.task_id}（agent=${t.agent}，state=${t.state}）` +
                `目标与本次派发一致且终态结果尚未被读取。请先调用 task_result(taskId="${t.task_id}") 读取结果——` +
                `读取后即视为已消费，才允许重试或基于其结论继续；若目的是提交实质修订后的复审，` +
                `请走 task_reuse / task_revive 续用原 child，不要再次 spawn 新任务。`,
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
 * 在 task-observer 的 execute.before 最前面调用（任何 fail-open 记录之前）。
 */
export function runDispatchGuards(
  event: any,
  opts: { board?: JobBoard } = {},
): void {
  const violation = inspectDispatch(event, opts.board);
  if (violation) {
    throw new Error(`[${violation.rule}] ${violation.message}`);
  }
}

/**
 * 结果消费标记：task_result 成功读取终态后在 board 上写 last_used_at，
 * 使“同目标重派”断路器放行后续重试。fail-open：失败仅返回 false。
 */
export async function markResultConsumed(
  board: JobBoard,
  taskId: string,
): Promise<boolean> {
  try {
    const current = (board as any).get?.(taskId);
    if (!current) return false;
    await (board as any).replace(
      { ...current, last_used_at: Date.now() },
      {
        expectedRevision: (current as any).last_board_revision ?? 0,
        operationId: `result-consumed-${taskId}-${Date.now()}`,
      },
    );
    return true;
  } catch {
    return false;
  }
}
