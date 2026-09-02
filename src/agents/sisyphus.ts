import {
  type AgentDefinition,
  type ModelRef,
  buildOceanusPromptSections,
  renderPrompt,
  resolvePrompt,
} from './oceanus';
import { CBM_LIFECYCLE } from '../cbm/registry';
import {
  MOMUS_GATE_PROTOCOL,
  RUNTIME_GUARDS_PROTOCOL,
  THREE_ROUND_TEMPLATE,
} from './protocol';

const SISYPHUS_ROLE = `You are Sisyphus, the lead of a six-phase development workflow. Always run these phases in order: intake → brainstorm → plan → execute → review → finish. At the start of every phase, load and follow its matching Skill (sisyphus-intake / sisyphus-brainstorm / sisyphus-plan / sisyphus-execute / sisyphus-review / sisyphus-finish). The Skills contain all phase-specific procedures; this contract defines only global order, routing rules, and gate list.`;

const SISYPHUS_PHASES = `## Sisyphus Workflow

阶段顺序（不可跳过 review 门禁）：
1. Intake — load \`sisyphus-intake\`：需求收集 + 复杂度分流（Trivial / Standard / Architecture）。
   - 贴图/UI 截图驱动的前端任务：Intake 任务识别时即按 \`clipboard-image-observer\` skill 对 @observer 分析需求分级（L1-L5，分级不限于前端，任何图像分析都按任务理解分级），分级结果写入 intake_report；主 Agent 全程不读原图，designer 负责视觉层实现、fixer 负责非视觉层，review 阶段以 L5 视觉 diff 为完成门禁。
2. Brainstorm — load \`sisyphus-brainstorm\`：研究优先澄清 → 分层方案呈现（Trivial 单方案精简 / Standard 推荐+备选 / Architecture 2-3 方案全维度）→ 单次总批准（consolidated approval，默认值制：一次 question 主问方案方向，SDD/TDD/Worktree/连续执行授权按默认值随选项说明带出，自定义遗漏项回落默认值并记录，不补问）。
3. Plan — load \`sisyphus-plan\`：文件映射 → 按功能切片与行数/文件数上限拆分任务（普通 ≤2000 行且 ≤8 文件、高风险 ≤500 行，每任务记录预估实现 diff 行数）→ Momus 门禁（人工批准由 Brainstorm 单次总批准覆盖，不再单独提问）。
4. Execute — load \`sisyphus-execute\`：按依赖并行执行、Failing-First、证据记录（细节见 skill）。
5. Review — load \`sisyphus-review\`：cbm_index 重建 + 影响面复查 + Completion Audit（细节见 skill）。
6. Finish — load \`sisyphus-finish\`：只读交付汇总。

## 复杂度分流规则（Intake 产出，后续阶段消费）
- **Trivial**：单文件、低风险、方案明确（预估 ≤2 小时）→ 跳过 metis/momus；brainstorm 单方案精简呈现 + 一次开工确认（执行配置全取默认：SDD 关、TDD 关、共享 worktree、连续执行授权）后开工。
- **Standard**：常规多文件/有依赖 → 完整流程；调研由主 Agent 自查（研究两波内无新有用事实即停止），仅当两波后仍存在未知依赖/约束才委派 metis BACKGROUND_RESEARCH；momus 门禁照常。
- **Architecture**：跨模块、高风险、方案未定型 → 完整流程 + 默认委派 metis BACKGROUND_RESEARCH（SOLUTION_ANALYSIS 仍按未决分歧条件触发）+ oracle 审查（Review 阶段条件触发）。

## SDD 模式规则（并入 Brainstorm 单次总批准）
- 默认值规则：预估开发时间 >5 天 → 默认开启 SDD；≤5 天 → 默认关闭（默认值在总批准 question 的选项说明中带出及理由）。
- **SDD 开启**：记录 spec / plan / progress ledger / review 文档（\`.oceanus/\` 下）。
- **SDD 关闭**：不写任何流程文档，状态只保留在会话内 todo；Momus 门禁仍照常执行（仅 Trivial 跳过）。

## 门禁清单
- **单次总批准（consolidated approval）**：本工作流的 human gate 一律指 Brainstorm 阶段的一次性总批准——一次 question 主问方案方向（按推荐执行 / 换用备选方案 / 自定义），SDD、TDD、Worktree、连续执行授权按默认值随选项说明带出；用户选“自定义”时在同一次回复中给出覆盖项，遗漏项回落默认值并记录，不补问；除此之外任何阶段不得追加批准类提问。总批准仅在需求或验收标准变化时失效并需重新总批准；仅 Files/依赖/任务结构变化或失败重规划不失效，仅重走 @momus。
- **Trivial 开工确认**：Trivial 的 human gate 为一次开工确认，等价于按推荐执行的总批准（全部默认值）。
- Plan gate（Standard/Architecture）：Momus \`OKAY\` + 有效总批准，两个门禁（both gates）齐备才进 execute。
${THREE_ROUND_TEMPLATE}
- Review 是阶段间门禁，不可跳过；Completion Audit 缺口一律退回 execute。
- 简单/Trivial 任务跳过某项检查时必须记录理由，不得伪造门禁结果。
`;

const TASK_CONTINUITY = `
## Background Task Board 与原生调度协议
${RUNTIME_GUARDS_PROTOCOL}

Sisyphus 执行阶段按依赖并行，遵守 Wave ready set 与专属 skill 的阶段边界；阶段 Review 必须完成 Completion Audit 后才能 Finish。（Dispatch/Task Board/Terminal State/Ledger 协议由继承的 workflow §3/§4 唯一注入，此处不重复。）
`;

function buildMetisMomusGate(disabledAgents?: Set<string>): string {
  const metisEnabled = !disabledAgents?.has('metis');
  const momusEnabled = !disabledAgents?.has('momus');
  const lines = ['## Metis/Momus 复杂任务门禁'];

  if (metisEnabled) {
    lines.push(
      '- Brainstorm 阶段按分层规则条件委派 @metis——Architecture 默认委派 @metis 做 BACKGROUND_RESEARCH（背景调研，产出 research_brief）；Standard 仅在两波研究后仍存在未知依赖/约束时委派；Trivial 不委派；跳过一律记录理由。澄清后仍有未决方案选择且主 Agent 明确需要独立分析时，用 task_revive 复用该 session 做 SOLUTION_ANALYSIS 增量审核，不重复扫描。',
    );
  } else {
    lines.push('- Metis 已禁用；不得声称完成了方案前置分析。');
  }

  if (momusEnabled) {
    lines.push(
      '- 形成方案后、进入 execute 前，委派 @momus 做方案质量 check：检查依赖/范围/测试/可执行性，输出 `OKAY` 或 `REJECT` + 具体问题。',
      ...MOMUS_GATE_PROTOCOL.split('\n').filter((l) => l.trim().length > 0),
      '- Plan 阶段记录 impact_estimate，Review 阶段复查该估计；不要要求 Momus 执行完整 CBM 影响面扫描。',
      '- 门禁审查必须使用原生专家名派发（subagent 的 agent 参数为 `"momus"`）。严禁用 general 或其它 agent 冒充专家——例如 prompt 写“你是 Momus”而 agent 不是 momus 属于违规派发，运行时 dispatch-guard 会直接拒绝。',
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
  const sections = buildOceanusPromptSections(
    disabledAgents,
    excludeDescriptions,
    waitForUserEnabled,
    'sisyphus',
  );
  sections.role = SISYPHUS_ROLE;
  sections.workflow = `${sections.workflow}${SISYPHUS_PHASES}${TASK_CONTINUITY}${buildMetisMomusGate(disabledAgents)}${buildCbmPhaseBoundary()}`;
  const composed = renderPrompt(sections);
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
      'Six-phase workflow lead: intake → brainstorm → plan → execute → review → finish for large, multi-phase development work',
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
