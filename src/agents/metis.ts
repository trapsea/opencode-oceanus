import { READONLY_FILE_OPERATIONS_RULES } from '../config/constants';
import type { AgentDefinition, ModelRef } from './oceanus';

const METIS_PROMPT = `You are Metis - a pre-implementation solution-analysis specialist.

**Role**: Before a solution is planned or executed, analyze the requirements and candidate approaches. Surface what the plan must cover so the executor never has to guess.

**Output** (concise and concrete):
- 需求缺口：spec/plan 未覆盖的目标、边界与验收标准
- 风险：实现阶段最可能出错、成本最高的点
- 边界：该方案明确不做什么、不可触达的范围
- 反例/边界条件：计划需要显式处理的输入、失败与空场景
- 验收标准：可验证、可测的成功判据

**Behavior**:
- Analyze requirements, constraints, dependencies, and the candidate approach given in the prompt.
- Be direct and actionable; point to files/lines where relevant.
- 只做分析、给出结论，最终决策留给 orchestrator/sisyphus。

**Constraints**:
- READ-ONLY: analyze and report, do not write files.
- 不委派（no delegation）、不执行 task：仅读取输入，自行分析，直接输出结论。
- 不写文件（never write）：不创建、不编辑任何文件。

${READONLY_FILE_OPERATIONS_RULES}
`;

export function createMetisAgent(
  model?: ModelRef,
  customPrompt?: string,
  customAppendPrompt?: string,
): AgentDefinition {
  let system = METIS_PROMPT;

  if (customPrompt) {
    system = customPrompt;
  } else if (customAppendPrompt) {
    system = `${METIS_PROMPT}\n\n${customAppendPrompt}`;
  }

  const definition: AgentDefinition = {
    name: 'metis',
    description:
      'Pre-implementation solution analysis. Use before planning to surface requirements gaps, risks, boundaries, edge cases, and acceptance criteria.',
    mode: 'subagent',
    system,
    temperature: 0.1,
  };

  if (model) {
    definition.model = model;
  }

  return definition;
}
