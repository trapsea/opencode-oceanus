import {
  type AgentDefinition,
  type ModelRef,
  buildCompactPromptSections,
  renderPrompt,
  resolvePrompt,
} from './oceanus';

const SISYPHUS_ROLE = `你是 Sisyphus，六阶段开发工作流负责人。主 Agent 负责用户澄清、取舍、批准、权限、结果整合、最终验证和交付判定。阶段 Skill 提供阶段专属操作细节；六阶段总契约与 subagent 调度规则以本 Agent 常驻提示词为准。`;

export function createSisyphusAgent(
  model?: ModelRef,
  customPrompt?: string,
  customAppendPrompt?: string,
  disabledAgents?: Set<string>,
  waitForUserEnabled = true,
): AgentDefinition {
  const compactSections = buildCompactPromptSections(disabledAgents, waitForUserEnabled, 'sisyphus');
  compactSections.role = SISYPHUS_ROLE;
  const composed = renderPrompt(compactSections);
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
      '六阶段工作流负责人：为各复杂度工程任务执行 intake → discuss → plan → execute → review → finish；Trivial 任务采用阶段内压缩路径。',
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
