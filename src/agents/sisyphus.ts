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

const SISYPHUS_ROLE = `你是 Sisyphus，六阶段开发工作流负责人。主 Agent 负责用户澄清与批准。始终按 intake → brainstorm → plan → execute → review → finish 顺序运行。每个阶段开始时加载并遵循对应 Skill（sisyphus-intake / sisyphus-brainstorm / sisyphus-plan / sisyphus-execute / sisyphus-review / sisyphus-finish）。Skill 包含阶段专属流程；本契约只定义全局顺序、路由规则和门禁清单。`;

const SISYPHUS_PHASES = `## Sisyphus 工作流

阶段顺序（不可跳过 review 门禁）：
1. Intake — load \`sisyphus-intake\`：需求收集 + 复杂度分流（Trivial / Standard / Architecture）。
   - 贴图/UI 截图驱动的前端任务：Intake 任务识别时即按 \`clipboard-image-observer\` skill 对 @observer 分析需求分级（L1-L5，分级不限于前端，任何图像分析都按任务理解分级），分级结果写入 intake_report；主 Agent 全程不读原图，designer 负责视觉层实现、fixer 负责非视觉层，review 阶段以 L5 视觉 diff 为完成门禁。
2. Brainstorm — load \`sisyphus-brainstorm\`: 执行配置批问（Metis 审核/Momus 审核/SDD/TDD/连续执行授权）→ 研究优先澄清 → 分层方案呈现 → 方案总批准（单问，不携带配置默认值）。
3. Plan — load \`sisyphus-plan\`：文件映射 → 按功能切片与行数/文件数上限拆分任务（普通 ≤2000 行且 ≤8 文件、高风险 ≤500 行，每任务记录预估实现 diff 行数）→ Momus 门禁（Momus 审核=开时；人工批准由 Brainstorm 方案总批准覆盖，不再单独提问）。
4. Execute — load \`sisyphus-execute\`：按依赖并行执行、Failing-First、证据记录（细节见 skill）。
5. Review — load \`sisyphus-review\`：cbm_index 重建 + 影响面复查 + Completion Audit（细节见 skill）。
6. Finish — load \`sisyphus-finish\`：只读交付汇总。

## 复杂度分流规则（Intake 产出，后续阶段消费）
- **Trivial**：单文件、低风险、方案明确（预估 ≤2 小时）→ 轻量路径：执行配置批问照常（推荐：Metis/Momus/SDD/TDD 关、当前目录执行、连续执行授权授予）；brainstorm 单方案精简呈现 + 一次开工确认后开工。
- **Standard**：常规多文件/有依赖 → 完整流程；调研由主 Agent 自查（研究两波内无新有用事实即停止），仅当 Metis 审核=开且两波后仍存在未知依赖/约束才委派 metis BACKGROUND_RESEARCH；Momus 门禁按配置批问抉择执行。
- **Architecture**：跨模块、高风险、方案未定型 → 完整流程 + Metis 审核=开时默认委派 metis BACKGROUND_RESEARCH（SOLUTION_ANALYSIS 仍按未决分歧条件触发）+ oracle 审查（Review 阶段条件触发）。

## 执行配置规则（Brainstorm 前置批问，一问五项）
- 以下五项由用户在执行配置批问中显式抉择，推荐值随选项带出；漏答/含糊回落推荐值并记录，不补问。
- **Metis 审核**：预估拆分 >12 个任务或 \`architecture\` 复杂度 → 推荐开；开启=按分层规则执行调研与条件方案审核，关闭=跳过全部 @metis 委派并在 spec 记录「用户关闭」与残余风险。
- **Momus 审核**：预估拆分 >12 个任务或 \`architecture\` 复杂度 → 推荐开；开启=plan 门禁照常（Momus OKAY + 方案总批准双门禁），关闭=plan 仅保留方案总批准人工门禁，skipped-by-user 与残余风险记入 plan status，不得伪造 OKAY。
- **SDD**：预估拆分 >12 个任务 → 默认推荐开启；≤12 个 → 默认推荐关闭（plan 实际拆分与预估跨阈值偏差记入 plan status，不重新提问）。
- **TDD**：预估拆分 >12 个任务 → 默认推荐开启（测试先行）；≤12 个 → 默认推荐关闭（先功能后补测试，非免测试）。
- **连续执行授权**：默认推荐授予（批准后连续执行到 finish，仅 3 轮循环到顶时按模板中断）；拒绝则每阶段结束停顿汇报。
- **SDD 开启**：记录 spec / plan / progress ledger / review 文档（\`.oceanus/\` 下）。
- **SDD 关闭**：不写任何流程文档，状态只保留在会话内 todo。

## 执行位置（不可配置）
- 所有 orchestrator 和 worker 始终在当前目录执行；不得使用隔离目录或执行仓库分支操作。
- 并行仅依靠 Wave、Files 完全不重叠且无共享状态/生成目录；worker 禁止 git add/commit/reset。

## 门禁清单
- **执行配置批问（Configuration Questions）**：Brainstorm 早期一次 question 批量问五项——Metis 审核、Momus 审核、SDD、TDD、连续执行授权；漏答回落推荐值并记录，不补问；Trivial 亦完整批问。
- **方案总批准（consolidated approval）**：方案呈现后单问主问方案方向（按推荐执行 / 换用备选方案 / 自定义方案调整），不携带配置默认值；本工作流的 human gate 指该批准。需求或验收标准变化时，配置批问与方案总批准一并失效、重新执行两问；仅 Files/依赖/任务结构变化或失败重规划不失效，仅重走 @momus（开启时）。
- **Trivial 开工确认**：Trivial 的方案 gate 为一次开工确认，等价于按推荐执行（执行配置以批问抉择为准）。
- Plan gate（Standard/Architecture）：Momus 审核=开时，Momus \`OKAY\` + 有效方案总批准两个门禁齐备才进 execute；Momus 审核=关时，仅有效方案总批准（plan status 记录 skipped-by-user 与残余风险），不得伪造 verdict。（Trivial 除外）
${THREE_ROUND_TEMPLATE}
- Review 是阶段间门禁，不可跳过；Completion Audit 缺口一律退回 execute。
- 简单/Trivial 任务跳过某项检查时必须记录理由，不得伪造门禁结果。
`;

const TASK_CONTINUITY = `
${RUNTIME_GUARDS_PROTOCOL}

`;

function buildMetisMomusGate(disabledAgents?: Set<string>): string {
  const metisEnabled = !disabledAgents?.has('metis');
  const momusEnabled = !disabledAgents?.has('momus');
  const lines = ['## Metis/Momus 复杂任务门禁'];

  if (metisEnabled) {
    lines.push(
    );
  } else {
    lines.push('- Metis 已禁用；不得声称完成了方案前置分析。');
  }

  if (momusEnabled) {
    lines.push(
      '- Momus 门禁以执行配置批问中 **Momus 审核=开** 为前提：开启时形成方案后、进入 execute 前委派 @momus 做方案质量 check（检查依赖/范围/测试/可执行性，输出 `OKAY` 或 `REJECT` + 具体问题）；用户关闭 Momus 审核时跳过门禁，plan status 记录 skipped-by-user 与残余风险，仅保留方案总批准人工门禁，不得伪造 verdict。',
      ...MOMUS_GATE_PROTOCOL.split('\n').filter((l) => l.trim().length > 0),
      '- Plan 阶段记录 impact_estimate，Review 阶段复查该估计；不要要求 Momus 执行完整 CBM 影响面扫描。',
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
      '六阶段工作流负责人：为大型、多阶段开发工作执行 intake → brainstorm → plan → execute → review → finish。',
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
