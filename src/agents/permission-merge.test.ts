import { describe, expect, test } from 'bun:test';
import { mergeAgentPermissions } from '../index';

/** 宿主 Agent.Info 默认基线的形状（二进制实证：*:* allow + .env/外部目录 ask 特例）。 */
const HOST_DEFAULT_PERMISSIONS = [
  { action: '*', resource: '*', effect: 'allow' },
  { action: 'external_directory', resource: '*', effect: 'ask' },
  { action: 'read', resource: '*.env', effect: 'ask' },
  { action: 'read', resource: '*.env.*', effect: 'ask' },
  { action: 'read', resource: '*.env.example', effect: 'allow' },
];

describe('mergeAgentPermissions（写入工具族 permission 合并语义）', () => {
  test('以宿主默认基线为底，追加规则优先且保留 .env/外部目录 ask 特例', () => {
    const merged = mergeAgentPermissions(HOST_DEFAULT_PERMISSIONS, [
      { action: 'edit', resource: '*', effect: 'deny' },
      { action: 'ast_grep_replace', resource: '*', effect: 'allow' },
      { action: 'ast_grep_replace', resource: '*', effect: 'allow' },
    ]);
    // 基线保留（含 ask 特例），追加规则位于尾部（findLast 优先）
    expect(merged).toHaveLength(8);
    expect(merged[0]).toEqual({ action: '*', resource: '*', effect: 'allow' });
    expect(merged.some((r) => r.action === 'read' && r.resource === '*.env' && r.effect === 'ask')).toBe(true);
    const editRules = merged.filter((r) => r.action === 'edit');
    expect(editRules).toEqual([{ action: 'edit', resource: '*', effect: 'deny' }]);
    expect(merged.at(-1)).toEqual({ action: 'ast_grep_replace', resource: '*', effect: 'allow' });
  });

  test('幂等：transform 重跑同一批规则不叠加', () => {
    const incoming = [
      { action: 'edit', resource: '*', effect: 'deny' },
      { action: 'ast_grep_replace', resource: '*', effect: 'allow' },
    ];
    const once = mergeAgentPermissions(HOST_DEFAULT_PERMISSIONS, incoming);
    const twice = mergeAgentPermissions(once, incoming);
    expect(twice).toEqual(once);
    expect(twice.filter((r) => r.action === 'edit')).toHaveLength(1);
  });

  test('existing 为 undefined 时仅返回 incoming', () => {
    const merged = mergeAgentPermissions(undefined, [
      { action: 'edit', resource: '*', effect: 'deny' },
    ]);
    expect(merged).toEqual([{ action: 'edit', resource: '*', effect: 'deny' }]);
  });

  test('incoming 接管的 action 覆盖基线中的同名规则（如只读 agent 的 edit deny）', () => {
    const readonlyBase = [
      ...HOST_DEFAULT_PERMISSIONS,
      { action: 'ast_grep_replace', resource: '*', effect: 'deny' },
    ];
    const merged = mergeAgentPermissions(readonlyBase, [
      { action: 'ast_grep_replace', resource: '*', effect: 'allow' },
    ]);
    const rules = merged.filter((r) => r.action === 'ast_grep_replace');
    expect(rules).toEqual([{ action: 'ast_grep_replace', resource: '*', effect: 'allow' }]);
  });
});
