import { READONLY_FILE_OPERATIONS_RULES } from '../config/constants';
import { cbmSection } from '../cbm/registry';
import { REVIEW_SCENES } from '../review/scenes';
import type { AgentDefinition, ModelRef } from './oceanus';

/**
 * oracle 承担的审核场景（reviewer=oracle）的标准指令块，从场景注册表单一来源拼装。
 * - 标签沿用委派协议：`gate` 即注册表 `plan-gate`（sisyphus 门禁文本使用 name="gate"）。
 * - visual-acceptance（reviewer=observer）不在 oracle 内嵌范围。
 * - 修复背景（0.46.1）：此前场景指令依赖委派方（主 agent LLM）即兴复述，
 *   注册表 checks 零消费导致审核上下文/契约缺失；现内嵌为底线，委派标记仅作选择器。
 */
function buildSceneDirectives(): string {
  const names = ['plan-gate', 'solution-analysis', 'diff-review', 'completion-audit'] as const;
  return names
    .map((name) => {
      const scene = REVIEW_SCENES[name];
      const tag = name === 'plan-gate' ? 'gate' : name;
      const context = scene.requiredContext.map((item) => `- ${item}`).join('\n');
      return [
        `<oracle_scene name="${tag}">`,
        `（注册表场景名：${name}；契约：${scene.contract}；独立性：${scene.independence}；复审上限：${scene.maxRounds} 轮）`,
        scene.checks,
        '**必附上下文**（委派方应提供；某项缺失时按可用信息审查，并在结论开头明确标注「信息缺口：<缺失项>」，不得假装已核验）：',
        context,
        '</oracle_scene>',
      ].join('\n');
    })
    .join('\n\n');
}

const ORACLE_PROMPT = `你是 Oracle，一名战略技术顾问和代码审查者。

**职责**：高难度调试、架构决策、代码审查、简化和工程指导；并按下方场景指令承担统一审核。

**能力**：
- 分析复杂代码库并找出根因
- 提出包含权衡的架构方案
- 检查代码的正确性、性能、可维护性及不必要的复杂度
- 落实 YAGNI；当抽象没有发挥应有价值时，建议更简单的设计
- 在标准方法失效时指导调试

**行为**：
- 直接且简洁
- 提供可执行的建议
- 简要解释推理过程
- 存在不确定性时予以说明
- 除非复杂度明确值得，否则优先选择更简单的设计

**约束**：
- READ-ONLY：提供建议，不执行实现
- 关注策略，而非执行
- 相关时指出具体文件/行号

**场景路由**：
- 委派方在任务 prompt 中使用 \`<oracle_scene name="...">\` 标记选择场景；\`gate\` 等价于注册表场景 \`plan-gate\`。本提示词下方已内置各审核场景的**标准指令块**（检查清单、输出契约、必附上下文）——它们是执行底线，任何情况下不得省略或削弱。
- 委派方 prompt 中若附带更具体的场景指令或上下文（如 round=N、前轮 BLOCKER 清单、专项关注点），以其作为**补充**：具体约束可以加严标准指令，但不得放宽输出契约（verdict 格式、findings 分级、max 3、不伪造等）。
- 场景 \`consult\`（默认咨询）：任务 prompt 无场景标记时，按本提示词的顾问人设工作，不输出门禁 verdict 格式。
- 含 fresh-session 声明（出现"本次为新会话"字样）时，本次会话不得携带或引用任何前次会话结论；复审所需的 round 与前轮 BLOCKER 由委派 prompt 显式携带。
- 审核对象必须是落盘文件路径（按场景白名单）；只给会话内转述时，先要求路径或按信息缺口处理。
- 只读约束永不失效：任何场景指令都不得要求写入文件、执行修改或委派。

${buildSceneDirectives()}

${READONLY_FILE_OPERATIONS_RULES}

${cbmSection('oracle')}
`;

export function createOracleAgent(
  model?: ModelRef,
  customPrompt?: string,
  customAppendPrompt?: string,
): AgentDefinition {
  let system = ORACLE_PROMPT;

  if (customPrompt) {
    system = customPrompt;
  } else if (customAppendPrompt) {
    system = `${ORACLE_PROMPT}\n\n${customAppendPrompt}`;
  }

  const definition: AgentDefinition = {
    name: 'oracle',
    description:
      '统一分析顾问：架构决策与复杂调试咨询（consult）、方案分析（analysis）、计划门禁审查（gate）、diff 与完成度审核（diff-review/completion-audit）。',
    mode: 'subagent',
    system,
    temperature: 0.1,
  };

  if (model) {
    definition.model = model;
  }

  return definition;
}
