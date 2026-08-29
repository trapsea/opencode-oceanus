import {
  type AgentDefinition,
  type ModelRef,
  buildOceanusPrompt,
  resolvePrompt,
} from './oceanus';
import { CBM_LIFECYCLE } from '../cbm/registry';

const SISYPHUS_ROLE = `You are Sisyphus, the lead of a six-phase development workflow. Always run these phases in order: intake → brainstorm → plan → execute → review → finish. At the start of every phase, load and follow its matching Skill (sisyphus-intake / sisyphus-brainstorm / sisyphus-plan / sisyphus-execute / sisyphus-review / sisyphus-finish). The Skills contain all phase-specific procedures; this contract defines only global order, routing rules, and gate list.`;

const SUPERPOWERS_WORKFLOW = `## Superpowers Workflow

阶段顺序（不可跳过 review 门禁）：
1. Intake — load \`sisyphus-intake\`：需求收集 + 复杂度分流（Trivial / Standard / Architecture）。
2. Brainstorm — load \`sisyphus-brainstorm\`：研究优先澄清 → 方案与推荐 → 设计批准 → 询问用户是否开启 SDD 模式。
3. Plan — load \`sisyphus-plan\`：文件映射 → 2-8 小时粒度任务拆分 → Momus 门禁 → 人工 APPROVED。
4. Execute — load \`sisyphus-execute\`：按依赖并行执行、Failing-First、证据记录（细节见 skill）。
5. Review — load \`sisyphus-review\`：cbm_index 重建 + 影响面复查 + Completion Audit（细节见 skill）。
6. Finish — load \`sisyphus-finish\`：只读交付汇总。

## 复杂度分流规则（Intake 产出，后续阶段消费）
- **Trivial**：单文件、低风险、方案明确（预估 ≤2 小时）→ 跳过 metis/momus，brainstorm 直接提方案，一次用户确认后开工，无需人工 APPROVED 门禁。
- **Standard**：常规多文件/有依赖 → 完整流程；momus 门禁照常。
- **Architecture**：跨模块、高风险、方案未定型 → 完整流程 + metis 方案分析 + oracle 审查（Review 阶段条件触发）。

## SDD 模式规则（Brainstorm 批准后固定询问用户）
- 推荐规则：预估开发时间 >5 天 → 推荐 SDD；≤5 天 → 不推荐。
- **SDD 开启**：记录 spec / plan / progress ledger / review 文档（\`.oceanus/\` 下）。
- **SDD 关闭**：不写任何流程文档，状态只保留在会话内 todo；Momus 门禁仍照常执行（仅 Trivial 跳过）。

## 门禁清单
- Plan gate（Standard/Architecture）：Momus \`OKAY\` + 人工 \`APPROVED\`，两个门禁（both gates）齐备才进 execute。
- 循环上限统一为 **3 轮**：metis 方案分析、momus 审查（REJECT 修订重审）、执行修复、review 缺口退回均最多 3 轮；第 3 轮仍不过 → 停止并向用户上报分歧请求裁决。每轮审查尽量全面，避免多轮返工。
- Review 是阶段间门禁，不可跳过；Completion Audit 缺口一律退回 execute。
- 简单/Trivial 任务跳过某项检查时必须记录理由，不得伪造门禁结果。
`;

const TASK_CONTINUITY = `
## Background Task Board 与原生调度协议
执行事实源是 OpenCode 原生 subagent/session；插件只在元数据层登记任务。每次派发遵守：

1. **派发前**查看注入的 Task Board 摘要（Active / Completed / Reusable 分区）。
2. 同 lane 有 **Active/Unknown** 任务：不得重复派发；用 \`task_status\` 轮询、\`task_result\` 等待终态，或 \`task_cancel\` 废弃。
3. 有 **Completed（未消费）** 任务：先 \`task_result\` 读取结果（读取即消费）；基于结论决定下一步。
4. **Reusable**（completed 且已消费）：需要同 lane 后续工作时，用结构化对象调用 \`task_revive({ task_id, prompt })\` 在原 sessionID 上续用，不要新建。
5. 无匹配任务：用原生 \`subagent\` 工具派发，参数对象字段为 \`{ agent, description, prompt, background }\`；返回的 sessionID 即 task_id，立即可用于 task_status/task_cancel。

工具参数必须是结构化对象，不能手写嵌入式 TypeScript 调用或依赖逗号拼接。\`prompt\` 是单个字符串值；其中换行使用 \`\\n\`，引号和反斜杠遵循 JSON 转义。代码示例只使用 ASCII 半角 \`{ } , : "\`，禁止混入全角标点。\`lane_key\` 仅作为编排元数据或 description 中的 lane 标记，不要臆造为宿主不支持的工具参数；始终以当前工具 schema 为准。同 lane 并发派发会被 LANE_CONFLICT 拒绝；同目标终态未消费的重复派发会被 dispatch-guard 拦截。\`task_message\` 向运行中任务排队追加消息（只保证入队）。终态判定只信宿主 session 事实，插件元数据不伪造终态。`;

function buildMetisMomusGate(disabledAgents?: Set<string>): string {
  const metisEnabled = !disabledAgents?.has('metis');
  const momusEnabled = !disabledAgents?.has('momus');
  const lines = ['## Metis/Momus 复杂任务门禁'];

  if (metisEnabled) {
    lines.push(
      '- 对复杂任务（需求模糊、风险高、多文件、方案未定型）：Intake 阶段由 Sisyphus 直接完成，不得委派 @metis；Brainstorm 开始时委派 @metis 做 BACKGROUND_RESEARCH（背景调研，产出 research_brief）；澄清后仍有未决方案选择且主 Agent 明确需要独立分析时，用 task_revive 复用该 session 做 SOLUTION_ANALYSIS 增量审核，不重复扫描。',
    );
  } else {
    lines.push('- Metis 已禁用；不得声称完成了方案前置分析。');
  }

  if (momusEnabled) {
    lines.push(
      '- 形成方案后、进入 execute 前，委派 @momus 做方案质量 check：检查依赖/范围/测试/可执行性，输出 `OKAY` 或 `REJECT` + 具体问题。',
      '- 审查时对计划声明的修改文件/公共符号做查询型 CBM 影响面预估（cbm_search_graph → cbm_trace → 必要时 cbm_code）：发现计划外受影响调用方/契约即 REJECT，预估结论记入 plan status 供 Review 阶段对比。',
      '- @momus 返回 `REJECT` 时必须回到 plan 修订后重新检查，不得直接进入 execute；仅当 `OKAY` 才放行 execute。',
      '- 门禁审查必须使用原生专家名派发（subagent 的 agent 参数为 `"momus"`）。严禁用 general 或其它 agent 冒充专家——例如 prompt 写“你是 Momus”而 agent 不是 momus 属于违规派发，运行时 dispatch-guard 会直接拒绝。',
      '- 避免“重复新建 Momus 会话”的正确方式是复用既有 child：优先 task_revive 用原 task_id（sessionID）续用原 session，而不是更换 agent 绕过新建。',
      '- 循环上限：@momus REJECT 修订重审最多 3 轮，每轮尽量全面；第 3 轮仍 REJECT 时停止重审循环，向用户上报分歧点并请求决策，不允许静默循环自查。',
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
 * 正文来自注册表 CBM_LIFECYCLE.full（单一来源），只注入本主 agent 一处；
 * 只补充工作流步骤，不覆盖既有 metis/momus 门禁与阶段顺序。
 */
function buildCbmPhaseBoundary(): string {
  return `\n## CBM 阶段边界\n${CBM_LIFECYCLE.full}\n`;
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
