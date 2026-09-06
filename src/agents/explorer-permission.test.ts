import { describe, expect, test } from 'bun:test';
import { EXPLORER_DEFAULT_PERMISSION } from '../config/constants';
import { createAgents } from './index';
import type { PluginConfig } from '../config/schema';

/**
 * explorer findings 落盘权限契约（review B1 修复的回归测试）：
 * explorer 默认权限放开 .oceanus/findings/* 的 write（资源级、窄 allow 在前宽 deny 在后），
 * 其余写动作（edit/apply_patch/ast_grep_replace）保持 deny；
 * 其他只读 agent 不受影响。
 */

type ResourceRule = Record<string, 'allow' | 'deny' | 'ask'>;

function writeRuleOf(permission: unknown): ResourceRule | undefined {
  const rule = (permission as Record<string, unknown> | undefined)?.write;
  return typeof rule === 'object' && rule !== null ? (rule as ResourceRule) : undefined;
}

describe('explorer findings 落盘权限', () => {
  test('EXPLORER_DEFAULT_PERMISSION：write 为资源级规则，findings allow、其余 deny', () => {
    const write = writeRuleOf(EXPLORER_DEFAULT_PERMISSION);
    expect(write).toBeDefined();
    expect(write!['.oceanus/findings/*']).toBe('allow');
    expect(write!['*']).toBe('deny');
    // allow 在 deny 之前声明（宿主 findLast 语义下窄规则可命中、宽规则兜底 fail-closed）。
    expect(Object.keys(write!)[0]).toBe('.oceanus/findings/*');
  });

  test('EXPLORER_DEFAULT_PERMISSION：其余写动作保持 deny', () => {
    const perm = EXPLORER_DEFAULT_PERMISSION as Record<string, unknown>;
    expect(perm.edit).toBe('deny');
    expect(perm.apply_patch).toBe('deny');
    expect(perm.ast_grep_replace).toBe('deny');
    expect(perm.task).toBe('deny');
  });

  test('createAgents：explorer 应用 EXPLORER_DEFAULT_PERMISSION，oracle/librarian 保持全量只读', () => {
    const agents = createAgents({} as PluginConfig);
    const explorer = agents.find((a) => a.name === 'explorer');
    const oracle = agents.find((a) => a.name === 'oracle');
    const librarian = agents.find((a) => a.name === 'librarian');

    expect(writeRuleOf(explorer?.permission)).toBeDefined();
    expect(writeRuleOf(oracle?.permission)).toBeUndefined();
    expect(oracle?.permission && (oracle.permission as Record<string, unknown>).write).toBe('deny');
    expect(
      librarian?.permission && (librarian.permission as Record<string, unknown>).write,
    ).toBe('deny');
  });
});
