import { describe, expect, test } from 'bun:test';
import { READONLY_DEFAULT_PERMISSION } from '../config/constants';
import { createAgents } from './index';
import type { PluginConfig } from '../config/schema';

/**
 * explorer 只读权限契约（2026-09 用户决策：调研结果不落盘）：
 * explorer 与其他只读 agent 一致使用 READONLY_DEFAULT_PERMISSION，
 * write 为普通 deny（无资源级放行）；历史 findings 落盘放行已移除。
 */

function writeRuleOf(permission: unknown): Record<string, 'allow' | 'deny' | 'ask'> | undefined {
  const rule = (permission as Record<string, unknown> | undefined)?.write;
  return typeof rule === 'object' && rule !== null
    ? (rule as Record<string, 'allow' | 'deny' | 'ask'>)
    : undefined;
}

describe('explorer 只读权限（不落盘）', () => {
  test('createAgents：explorer 使用统一只读默认权限，write 为 deny 且无资源级规则', () => {
    const agents = createAgents({} as PluginConfig);
    const explorer = agents.find((a) => a.name === 'explorer');

    expect(explorer?.permission).toBe(READONLY_DEFAULT_PERMISSION);
    expect((explorer?.permission as Record<string, unknown>).write).toBe('deny');
    expect(writeRuleOf(explorer?.permission)).toBeUndefined();
  });

  test('其余写动作保持 deny', () => {
    const perm = READONLY_DEFAULT_PERMISSION as Record<string, unknown>;
    expect(perm.write).toBe('deny');
    expect(perm.edit).toBe('deny');
    expect(perm.apply_patch).toBe('deny');
    expect(perm.ast_grep_replace).toBe('deny');
    expect(perm.task).toBe('deny');
  });

  test('createAgents：oracle/librarian 与 explorer 权限一致', () => {
    const agents = createAgents({} as PluginConfig);
    const explorer = agents.find((a) => a.name === 'explorer');
    const oracle = agents.find((a) => a.name === 'oracle');
    const librarian = agents.find((a) => a.name === 'librarian');

    expect(explorer?.permission).toEqual(oracle?.permission);
    expect(explorer?.permission).toEqual(librarian?.permission);
  });
});
