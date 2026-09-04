#!/usr/bin/env bun

/**
 * 扫描模型可见提示词和说明文件中的英文自然语言。
 * 固定标识只在反引号、URL、命令、路径和已登记 token 中豁免；不使用“忽略所有英文”的通配规则。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TARGET_FILES = [
  'src/agents/oceanus.ts', 'src/agents/sisyphus.ts', 'src/agents/explorer.ts',
  'src/agents/librarian.ts', 'src/agents/oracle.ts', 'src/agents/designer.ts',
  'src/agents/fixer.ts', 'src/agents/observer.ts', 'src/agents/metis.ts',
  'src/agents/momus.ts', 'src/agents/orchestrator-context.ts', 'src/agents/protocol.ts',
  'src/agents/index.ts', 'src/skills/clipboard-image-observer.ts', 'src/skills/opencode-oceanus.ts',
  'src/skills/sisyphus-intake.ts', 'src/skills/sisyphus-brainstorm.ts', 'src/skills/sisyphus-plan.ts',
  'src/skills/sisyphus-execute.ts', 'src/skills/sisyphus-review.ts', 'src/skills/sisyphus-finish.ts',
  'src/config/constants.ts', 'src/cbm/registry.ts', 'src/cbm/guidance.ts',
  'src/hooks/json-error-recovery.ts', 'src/hooks/image-materializer.ts', 'src/hooks/image-error-hint.ts',
  'src/hooks/tool-loop-guard.ts', 'src/hooks/cbm-guidance.ts', 'README.md',
  'docs/opencode-v2-compatibility.md', 'docs/prompt-workflow-review-2026-08.md',
  'docs/tooling-and-runtime.md', 'docs/codebase-memory-mcp.md',
];

const APPROVED_TOKENS = new Set([
  'OpenCode', 'Oceanus', 'Sisyphus', 'CBM', 'Metis', 'Momus', 'Fixer', 'Explorer',
  'Librarian', 'Oracle', 'Designer', 'Observer', 'README', 'Markdown', 'TypeScript',
  'ESM', 'Bun', 'API', 'UI', 'UX', 'TUI', 'JSON', 'OCR', 'PDF', 'YAGNI', 'TDD', 'SDD', 'L1', 'L2', 'L3', 'L4', 'L5',
  'AST', 'ast-grep', 'wait_for_user', 'intake_report', 'open_questions', 'risks', 'clipboard-image-observer',
  'ledger', 'pending', 'in_progress', 'completed', 'failed', 'blocked', 'evidence', 'updated_at', 'stale',
  'diff', 'Files', 'scope', 'acceptance', 'criteria', 'typecheck', 'build', 'real-surface', 'Review',
  'TUI', 'image', 'input', 'clipboard', 'browser', 'tool', 'call', 'background', 'worker', 'lane',
  'in', 'progress', 'Task', 'ID', 'Context', 'Interfaces', 'Dependencies', 'Preconditions', 'Validation',
  'Expected', 'Acceptance', 'Risks', 'rollback', 'status', 'owner', 'wave', 'updated', 'strict', 'light',
  'exempt', 'TDD', 'on', 'off', 'RED', 'GREEN', 'SURFACE', 'characterization', 'test', 'endpoint', 'live',
  'Findings', 'ready', 'set', 'Todo', 'list', 'Momus', 'OKAY', 'REJECT', 'Review', 'accepted', 'green',
  'MATCH', 'RETURN', 'does', 'support', 'session', 'issue', 'read', 'AND', 'N', 'M', 'run', 'task',
  'execute', 'before', 'after', 'hook', 'v2', 'ToolHooks', 'task-session-manager', 'task_*', 'wait_for_*',
  'no-op', 'spy', 'warnAt', 'blockAt', 'MAX_TRACKED_SESSIONS', 'LOOP_GUARD_WARN_AT', 'LOOP_GUARD_BLOCK_AT',
  'verdict', 'tier',
  'LOOP', 'GUARD', 'default', 'no', 'op', 'grep', 'Execute', 'SKIPPED_BY_USER', 'BY', 'USER',
  'for', 'user', 'intake', 'report', 'ast',
]);

const fixed = /`[^`]*`|https?:\/\/\S+|(?:[A-Za-z]:)?(?:\.?\.?\/)[^\s,)]+|\b(?:bun|npm|git|pnpm)\s+[^\n]+/g;
const word = /[A-Za-z]+(?:[-'][A-Za-z]+)?/g;
const findings: string[] = [];

function naturalLanguage(text: string): boolean {
  const line = text.replace(/\$\{[^}]*\}/g, ' ').replace(fixed, ' ');
  const words = [...line.matchAll(word)].map((m) => m[0]).filter((w) => !APPROVED_TOKENS.has(w));
  const natural = words.filter((w) => w.length > 1 && !/^(src|test|ts|md|js|tsx|cbm|skill|agent)$/i.test(w));
  const functionWords = /^(a|an|and|are|as|at|be|before|by|can|do|for|from|if|in|into|is|it|must|never|not|of|on|only|or|return|should|the|then|this|to|use|when|with|you)$/i;
  return natural.length >= 3 && natural.some((w) => functionWords.test(w));
}

function scanTypeScript(file: string, lines: string[]): void {
  let fenced = false;
  let blockComment = false;
  for (const [index, raw] of lines.entries()) {
    let text = '';
    let i = 0;
    while (i < raw.length) {
      if (blockComment) {
        const end = raw.indexOf('*/', i);
        text += end < 0 ? raw.slice(i) : raw.slice(i, end);
        if (end < 0) break;
        blockComment = false;
        i = end + 2;
        continue;
      }
      if (fenced) {
        const end = raw.indexOf('`', i);
        text += end < 0 ? raw.slice(i) : raw.slice(i, end);
        if (end < 0) break;
        fenced = false;
        i = end + 1;
        continue;
      }
      if (raw.startsWith('/*', i)) {
        blockComment = true;
        i += 2;
      } else if (raw.startsWith('//', i)) {
        text += raw.slice(i + 2);
        break;
      } else if (raw[i] === '`') {
        fenced = true;
        i += 1;
      } else if (raw[i] === '"' || raw[i] === "'") {
        const quote = raw[i];
        const start = ++i;
        while (i < raw.length && (raw[i] !== quote || raw[i - 1] === '\\')) i += 1;
        text += raw.slice(start, i);
        i += 1;
      } else {
        i += 1;
      }
    }
    if (naturalLanguage(text)) findings.push(`${file}:${index + 1}`);
  }
}

for (const file of TARGET_FILES) {
  const lines = readFileSync(resolve(file), 'utf8').split('\n');
  if (file.endsWith('.ts') || file.endsWith('.tsx')) scanTypeScript(file, lines);
  else {
    let fenced = false;
    lines.forEach((raw, index) => {
      if (/^\s*```/.test(raw)) { fenced = !fenced; return; }
      if (!fenced && naturalLanguage(raw)) findings.push(`${file}:${index + 1}`);
    });
  }
}

if (findings.length) {
  console.error(findings.join('\n'));
  process.exit(1);
}
console.log('PROMPT_CHINESE_SCAN_OK: 0 unapproved English natural-language matches');
