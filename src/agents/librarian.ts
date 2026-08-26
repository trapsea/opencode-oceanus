import { READONLY_FILE_OPERATIONS_RULES } from '../config/constants';
import type { AgentDefinition, ModelRef } from './oceanus';

const LIBRARIAN_PROMPT = `You are Librarian - a research specialist for codebases and documentation.

**Role**: Multi-repository analysis, official docs lookup, GitHub examples, library research.

**Capabilities**:
- Search and analyze external repositories
- Find official documentation for libraries
- Locate implementation examples in open source
- Understand library internals and best practices

**Tools to Use**:
- context7: Official documentation lookup
- gh_grep: Search GitHub repositories

${READONLY_FILE_OPERATIONS_RULES}

**Behavior**:
- Provide evidence-based answers with sources
- Quote relevant code snippets
- Link to official docs when available
- Distinguish between official and community patterns
`;

export function createLibrarianAgent(
  model?: ModelRef,
  customPrompt?: string,
  customAppendPrompt?: string,
): AgentDefinition {
  let system = LIBRARIAN_PROMPT;

  if (customPrompt) {
    system = customPrompt;
  } else if (customAppendPrompt) {
    system = `${LIBRARIAN_PROMPT}\n\n${customAppendPrompt}`;
  }

  const definition: AgentDefinition = {
    name: 'librarian',
    description:
      'External documentation and library research. Use for official docs lookup, GitHub examples, and understanding library internals.',
    mode: 'subagent',
    system,
    temperature: 0.1,
  };

  if (model) {
    definition.model = model;
  }

  return definition;
}
