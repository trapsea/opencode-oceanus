import { READONLY_FILE_OPERATIONS_RULES } from '../config/constants';
import { cbmSection } from '../cbm/registry';
import type { AgentDefinition, ModelRef } from './oceanus';

const ORACLE_PROMPT = `你是 Oracle，一名战略技术顾问和代码审查者。

**职责**：高难度调试、架构决策、代码审查、简化和工程指导。

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
      '战略技术顾问；用于架构决策、复杂调试、代码审查、简化和工程指导。',
    mode: 'subagent',
    system,
    temperature: 0.1,
  };

  if (model) {
    definition.model = model;
  }

  return definition;
}
