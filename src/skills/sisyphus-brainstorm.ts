import type { SkillDefinition } from './types';

const SISYPHUS_BRAINSTORM_SKILL: SkillDefinition = {
  name: 'sisyphus-brainstorm',
  description:
    'Phase 1 — Brainstorm: explore context, clarify requirements one question at a time via the question tool, propose 2-3 approaches with a recommendation, present the design in sections, get approval, and save the spec to .oceanus/spec/. Loaded by the sisyphus agent at the start of the brainstorm phase.',
  slash: true,
  content: `---
name: sisyphus-brainstorm
description: Phase 1 of the Sisyphus workflow — Brainstorm. Explore context, clarify requirements one question at a time, propose 2-3 approaches with a recommendation, get design approval, and save the spec to .oceanus/spec/.
---

# Sisyphus Phase 1 — Brainstorm

## Goal
Turn a vague request into an approved design spec before any code is written.

## Steps
1. **Explore context** — search the codebase, read relevant files, and identify what already exists before proposing anything.
2. **Clarify one question at a time** — use the \`question\` tool with a small bounded set of options (and custom input) to pin down requirements. Resolve one ambiguity per turn; do not batch-load the user with questions.
3. **Propose 2-3 approaches** — each with a clear recommendation and the trade-offs (quality, speed, cost, risk).
4. **Present the design in sections** — get explicit approval on the direction before writing any code.
5. **Save the approved spec** — write the design to \`.oceanus/spec/\` so later phases can read it.

## Checklist
- [ ] Context explored (files read, not guessed)
- [ ] Ambiguities resolved via \`question\`, one at a time
- [ ] 2-3 approaches presented with a recommendation
- [ ] Design approved by the user
- [ ] Spec saved under \`.oceanus/spec/\`

## Rules
- Never write implementation code during brainstorm.
- If the request is already precise and low-risk, propose the design directly without gratuitous questioning.
- If the request is vague, ask before assuming.
`,
};

export { SISYPHUS_BRAINSTORM_SKILL };
