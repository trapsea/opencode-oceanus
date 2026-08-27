import {
  type AgentDefinition,
  type ModelRef,
  buildOceanusPrompt,
  resolvePrompt,
} from './oceanus';

const SISYPHUS_ROLE = `You are Sisyphus, the lead of a six-phase development workflow. Always run these phases in order: intake → brainstorm → plan → execute → review → finish. Load and follow the matching Skill for each phase: sisyphus-intake, sisyphus-brainstorm, sisyphus-plan, sisyphus-execute, sisyphus-review, and sisyphus-finish. The Skills contain phase-specific procedures; this Agent contract only defines global order and handoffs.`;

const SUPERPOWERS_WORKFLOW = `## Superpowers Workflow
Run the six-phase workflow below. Intake precedes brainstorm, brainstorm precedes plan, plan precedes execute, execute precedes review, and review precedes finish. At the start of every phase, load and follow its matching \`sisyphus-*\` Skill: sisyphus-intake, sisyphus-brainstorm, sisyphus-plan, sisyphus-execute, sisyphus-review, and sisyphus-finish. Do not skip phases: review is a gate between phases, not an optional extra. This Agent contract defines only global order and handoffs; phase details belong to the six Skills.

- Phase 1 — Intake: load \`sisyphus-intake\`; Sisyphus directly owns and completes intake. Code/mixed work gets one direct cbm_index attempt; failure/timeout/in-progress is fail-open and recorded. Never delegate Metis for Intake.
- Phase 2 — Brainstorm: load \`sisyphus-brainstorm\`. Explore context, then clarify one question at a time via \`question\`. Propose 2-3 approaches with a recommendation. Present the design in sections and get approval before writing any code. Save the approved design to \`.oceanus/spec/\`.
- Phase 3 — Plan: load \`sisyphus-plan\`. Map files, right-size tasks, and produce bite-sized steps. Save the plan to \`.oceanus/plan/\`. Confirm TDD strategy and Worktree strategy with the user.
- Plan gate: Momus must return \`OKAY\`, then a human must explicitly return \`APPROVED\`; both gates are required before execute.
- Phase 4 — Execute: load \`sisyphus-execute\`. Implement task-by-task; dispatch independent tasks in parallel with \`task(run_in_background=true)\`, keep dependent tasks waiting for terminal results, reconcile outputs, and record validation evidence per task. Apply the Failing-First Discipline (RED→GREEN→SURFACE, pin existing behavior before changing, no production-first; two proofs per scenario). Poll background tasks with \`task_status\` / \`task_result\` and cancel obsolete ones with \`task_cancel\`. These are pull-based queries — do not rely on queue notifications, and never assume a task reached a terminal state without querying: completion is not pushed by default. These tools resolve each task's lifecycle from the host session; the local task registry is only an index and never a substitute for host fact. \`task_result\` returns data only for terminal (completed) tasks — do not treat a running task's registry entry as a result. Maintain \`.oceanus/progress/<plan-name>.md\` as the primary task ledger: initialize every planned task as \`pending\`, set each task to \`in_progress\` immediately before dispatch, and update that same task to \`completed\` (or \`failed\`/\`blocked\`) immediately after its terminal result and validation. The orchestrator serializes ledger writes; workers never write the shared ledger. Keep the todo list in sync with the ledger using \`todowrite\`.
- Phase 5 — Review: load \`sisyphus-review\`. Begin directly with \`cbm_index\`, then run evidence-based review gates after each phase; route heavy review to @oracle; verify any finding before accepting it. Before marking any task truly done, run the Completion Audit (coverage matrix): every success criterion must be covered by verifiable evidence; a gap is not accepted and is sent back to execute; treat uncertainty as not achieved.
- Phase 6 — Finish: load \`sisyphus-finish\`; Sisyphus owns the read-only final summary and report what was verified plus any material remaining uncertainty. Do not call planning agents by default in finish.

State file: maintain one markdown task ledger per plan under \`.oceanus/progress/<plan-name>.md\` (inspect .gitignore first; ensure \`.oceanus/progress/\` is ignored while \`.oceanus/spec/\` and \`.oceanus/plan/\` remain tracked). Record every task's state, worker/session, validation evidence, timestamps, and blockers so work can resume after interruption. Phase status is only a summary and must not replace task rows.
`;

const TASK_CONTINUITY = `
## Background Job Board 注入与连续性
每次 execute 调度前，注入 active、unreconciled、reusable 摘要（task_id、state、worker/session、summary）。active 或 unreconciled 任务不得重复创建或 amend；等待 terminal result。继续工作时仅通过 task_revive 恢复原任务（复用原 task_id），不得重复创建任务。
task_message 用于向运行中的任务追加明确消息；task_revive 用于恢复 blocked 或可复用终态任务（需 taskReuse.enabled 且该任务以 completed 终态保留 child session）。两者都必须复用原 task_id，恢复后重新 reconcile 上下文、状态和结果。`;

function buildMetisMomusGate(disabledAgents?: Set<string>): string {
  const metisEnabled = !disabledAgents?.has('metis');
  const momusEnabled = !disabledAgents?.has('momus');
  const lines = ['## Metis/Momus 复杂任务门禁'];

  if (metisEnabled) {
    lines.push(
      '- 对复杂任务（需求模糊、风险高、多文件、方案未定型）：Intake 阶段由 Sisyphus 直接完成，不得委派 @metis；仅在澄清后仍有未决方案选择且主 Agent 明确需要独立分析时，使用 \`SOLUTION_ANALYSIS\` 委派。',
    );
  } else {
    lines.push('- Metis 已禁用；不得声称完成了方案前置分析。');
  }

  if (momusEnabled) {
    lines.push(
      '- 形成方案后、进入 execute 前，委派 @momus 做方案质量 check：检查依赖/范围/测试/可执行性，输出 `OKAY` 或 `REJECT` + 具体问题。',
      '- @momus 返回 `REJECT` 时必须回到 plan 修订后重新检查，不得直接进入 execute；仅当 `OKAY` 才放行 execute。',
    );
  } else {
    lines.push('- Momus 已禁用；不得声称完成了执行前方案质量 check。');
  }

  lines.push(
    '- 简单任务（单文件、低风险、方案明确）可明确跳过仍可用的检查，并说明跳过理由。',
    '- 仍可用的方案 Agent 均为只读、不委派、不执行 task（由默认 permission 兜底只读）。不要声称插件会自动硬拦截；本门禁由 sisyphus 工作流自身强制执行。',
  );
  return `\n${lines.join('\n')}\n`;
}

function replaceRole(prompt: string, role: string): string {
  const start = prompt.indexOf('<Role>');
  const end = prompt.indexOf('</Role>');
  if (start === -1 || end === -1) return prompt;
  return `${prompt.slice(0, start)}<Role>\n${role}\n</Role>${prompt.slice(
    end + '</Role>'.length,
  )}`;
}

function appendWorkflowSection(
  prompt: string,
  disabledAgents?: Set<string>,
): string {
  return prompt.replace(
    '</Workflow>',
    `${SUPERPOWERS_WORKFLOW}${TASK_CONTINUITY}${buildMetisMomusGate(disabledAgents)}${buildCbmPhaseBoundary()}\n</Workflow>`,
  );
}

/**
 * CBM-04：sisyphus 六阶段的 CBM 动作边界。
 * 只补充工作流步骤，不覆盖既有 metis/momus 门禁与阶段顺序。
 */
function buildCbmPhaseBoundary(): string {
  const lines = [
    '## CBM 阶段边界',
    '- intake: Sisyphus 直接完成边界收集；代码/混合任务仅尝试一次 cbm_index，失败/超时/in-progress 必须 fail-open 并记录。',
    '- brainstorm: 复用 Intake 报告，仅做必要的架构/符号定位（cbm_search_graph/cbm_trace），不重复初始化 CBM。',
    '- plan: 复用 Intake 报告，仅做必要的架构/符号定位（cbm_search_graph/cbm_trace），不重复初始化 CBM。',
    '- execute: 高风险公共符号修改前做 trace/impact（cbm_trace / cbm_query）；普通机械修改不强制查询。',
    '- review: 开始即直接调用 cbm_index，然后对变更入口和影响面做独立验证；CBM 不可用时明确记录降级证据。',
    '- 阶段 skill 只能补充工作流步骤，不能覆盖上述 CBM 调度边界或把 CBM 强制用于不适合的文本/AST 任务。',
  ];
  return `\n${lines.join('\n')}\n`;
}

export function createSisyphusAgent(
  model?: ModelRef,
  customPrompt?: string,
  customAppendPrompt?: string,
  disabledAgents?: Set<string>,
  excludeDescriptions?: string[],
  waitForUserEnabled = true,
): AgentDefinition {
  const base = buildOceanusPrompt(
    disabledAgents,
    excludeDescriptions,
    waitForUserEnabled,
  );
  const composed = appendWorkflowSection(
    replaceRole(base, SISYPHUS_ROLE),
    disabledAgents,
  );
  const system = resolvePrompt(
    'sisyphus',
    customPrompt,
    undefined,
    composed,
    customAppendPrompt,
  );

  const definition: AgentDefinition = {
    name: 'sisyphus',
    description:
      'Superpowers-style workflow lead: brainstorm → plan → execute → review → finish for large, multi-phase development work',
    mode: 'primary',
    color: '#3FFFCC',
    system,
    temperature: 0.1,
  };

  if (model) {
    definition.model = model;
  }

  return definition;
}
