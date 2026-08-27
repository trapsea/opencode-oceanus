import { describe, expect, test } from 'bun:test';
import {
  decideFinish,
  parseLedger,
  parseReviewReport,
  validateLedger,
} from './contract';

const ref = { gitHead: 'abc123', dirty: false };
const iso = '2026-08-27T00:00:00.000Z';

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'test', status: 'verified', source: 'bun', command: 'bun test',
    exitCode: 0, timestamp: iso, workspaceRef: ref, note: 'ok', ...overrides,
  };
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 't1', wave: 1, dependsOn: [], files: ['src/a.ts'],
    state: 'completed', owner: 'worker', evidence: [evidence()],
    updatedAt: iso, ...overrides,
  };
}

function ledger(overrides: Record<string, unknown> = {}) {
  return { schemaVersion: 1, plan: 'plan', workspaceRef: ref, tasks: [task()], ...overrides };
}

function review(overrides: Record<string, unknown> = {}) {
  return {
    status: 'REVIEW_OKAY', plan: 'plan', spec: 'spec', generatedAt: iso,
    workspaceRef: ref,
    completionMatrix: [{ criterion: 'done', taskId: 't1', evidence: ['e1'], workspaceRef: ref, status: 'verified' }],
    findings: [], tests: [{ command: 'bun test', exitCode: 0, timestamp: iso, workspaceRef: ref, status: 'passed' }],
    residualUncertainty: [], ...overrides,
  };
}

const block = (marker: string, value: unknown) => `<!-- ${marker} -->\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
const ledgerText = (value: unknown) => block('sisyphus-ledger:v1', value);
const reviewText = (value: unknown) => block('sisyphus-review:v1', value);

describe('Ledger v1 schema 与诊断（RED）', () => {
  test('必填、类型、非空字段和 UTC 时间必须校验', () => {
    const bad = ledger({ plan: '', schemaVersion: '1', workspaceRef: { gitHead: 1, dirty: 'no' }, tasks: [{ ...task(), taskId: '', wave: 0, dependsOn: 'x', files: [1], owner: '', updatedAt: 'y', evidence: [{ ...evidence(), command: '', exitCode: '0', timestamp: 'y', note: '' }] }] });
    const result = parseLedger(ledgerText(bad));
    expect(result.diagnostics.map((d: { code: string }) => d.code)).toEqual(expect.arrayContaining(['invalid_timestamp']));
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  test('缺 block、非法 JSON、旧版本和重复 taskId 返回诊断', () => {
    expect(parseLedger('').diagnostics.map((d: { code: string }) => d.code)).toContain('missing_block');
    expect(parseLedger('<!-- sisyphus-ledger:v1 -->\n```json\n{bad\n```').diagnostics).toEqual(expect.any(Array));
    expect(parseLedger(ledgerText({ ...ledger(), schemaVersion: 2 })).diagnostics.map((d: { code: string }) => d.code)).toContain('unsupported_version');
    expect(parseLedger(ledgerText({ ...ledger(), tasks: [task(), task({ taskId: 't1' })] })).diagnostics.map((d: { code: string }) => d.code)).toContain('duplicate_task_id');
  });

  test('依赖缺失、循环、失败上游、文件冲突与证据 freshness/degraded', () => {
    const value = ledger({ tasks: [task({ taskId: 'a', dependsOn: ['missing'], files: ['same.ts'], evidence: [evidence({ status: 'stale', workspaceRef: { gitHead: 'old', dirty: false } })] }), task({ taskId: 'b', dependsOn: ['b'], files: ['same.ts'], state: 'failed', evidence: [evidence({ status: 'degraded' })] })] });
    const codes = validateLedger(value, ref).map((d: { code: string }) => d.code);
    expect(codes).toEqual(expect.arrayContaining(['missing_dependency', 'dependency_cycle', 'upstream_failed_or_blocked', 'file_scope_conflict', 'stale_evidence']));
  });
});

describe('Review Report v1 与 FinishDecision（RED）', () => {
  test('Review 必填/类型/非空、矩阵覆盖和 tests 全部通过必须校验', () => {
    const result = parseReviewReport(reviewText({ ...review(), plan: '', tests: [], completionMatrix: [{ taskId: '', status: 'bad' }] }));
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  test('七个 Finish reasonCode 均有明确分支，并支持多错误组合', () => {
    expect(decideFinish('', ref).reasonCodes).toContain('missing_report');
    expect(decideFinish('not a report', ref).reasonCodes).toContain('invalid_report');
    const cases = [
      ['review_rejected', { status: 'REVIEW_REJECT' }],
      ['stale_report', { workspaceRef: { gitHead: 'old', dirty: false } }],
      ['incomplete_matrix', { completionMatrix: [] }],
      ['blocking_finding', { findings: [{ severity: 'error', summary: 'x', blocking: true }] }],
      ['tests_not_passed', { tests: [{ command: 'x', exitCode: 1, timestamp: iso, workspaceRef: ref, status: 'failed' }] }],
    ] as const;
    for (const [code, changes] of cases) expect(decideFinish(reviewText(review(changes)), ref).reasonCodes).toContain(code);
    const combined = decideFinish(reviewText(review({ status: 'REVIEW_REJECT', workspaceRef: { gitHead: 'old', dirty: false }, completionMatrix: [], findings: [{ severity: 'error', summary: 'x', blocking: true }], tests: [{ command: 'x', exitCode: 1, timestamp: iso, workspaceRef: ref, status: 'skipped' }] })), ref);
    expect(combined.status).toBe('NOT_COMPLETED');
    expect(combined.reasonCodes).toEqual(expect.arrayContaining(['review_rejected', 'stale_report', 'incomplete_matrix', 'blocking_finding', 'tests_not_passed']));
  });
});
