import { describe, expect, test } from 'bun:test';
import {
  PROMETHEUS_PERMISSION,
  READONLY_DEFAULT_PERMISSION,
} from '../config/constants';
import { createAgents } from './index';
import { createPrometheusAgent } from './prometheus';
import type { PluginConfig } from '../config/schema';

/**
 * prometheus 受限 primary 权限契约：
 * 以 READONLY_DEFAULT_PERMISSION spread 派生，差异仅 question/skill 两键；
 * 写路径全部拒绝；不委派任何 subagent（task/subagent 沿用只读表整体 deny）。
 * 注意：用户显式 agents.prometheus.permission 会整体替换本表（非合并）。
 */

describe('prometheus 受限 primary 权限契约', () => {
  test('createAgents：prometheus 默认启用，mode 为 primary 且使用 PROMETHEUS_PERMISSION', () => {
    const agents = createAgents({} as PluginConfig);
    const prometheus = agents.find((a) => a.name === 'prometheus');

    expect(prometheus).toBeDefined();
    expect(prometheus?.mode).toBe('primary');
    expect(prometheus?.permission).toBe(PROMETHEUS_PERMISSION);
  });

  test('权限表以只读默认权限派生，差异仅 question/skill 两键', () => {
    const base = READONLY_DEFAULT_PERMISSION as Record<string, unknown>;
    const derived = PROMETHEUS_PERMISSION as Record<string, unknown>;
    const diffKeys = new Set<string>();
    for (const key of new Set([...Object.keys(base), ...Object.keys(derived)])) {
      if (base[key] !== derived[key]) diffKeys.add(key);
    }
    expect([...diffKeys].sort()).toEqual(['question', 'skill']);
  });

  test('写路径全部拒绝，澄清放行，skill 拒绝', () => {
    const perm = PROMETHEUS_PERMISSION as Record<string, unknown>;
    expect(perm.write).toBe('deny');
    expect(perm.edit).toBe('deny');
    expect(perm.apply_patch).toBe('deny');
    expect(perm.ast_grep_replace).toBe('deny');
    expect(perm.todowrite).toBe('deny');
    expect(perm.question).toBe('allow');
    expect(perm.skill).toBe('deny');
  });

  test('不委派任何 subagent：task/subagent 沿用只读表整体 deny', () => {
    const perm = PROMETHEUS_PERMISSION as Record<string, unknown>;

    expect(perm.task).toBe('deny');
    expect(perm.subagent).toBe('deny');
  });

  test('disabled_agents 可禁用 prometheus', () => {
    const agents = createAgents({
      disabled_agents: ['prometheus'],
    } as PluginConfig);
    expect(agents.find((a) => a.name === 'prometheus')).toBeUndefined();
  });

  test('工厂不再注入已禁用 agent 提示（无委派语境下无意义）', () => {
    const plain = createPrometheusAgent().system!;

    expect(plain).not.toContain('已禁用 agent');
    expect(plain).not.toContain('受限委派白名单');
  });

  test('prompt 契约：CBM 段来自注册表、含身份边界与输出契约', () => {
    const system = createPrometheusAgent().system!;
    expect(system).toContain('你是 Prometheus');
    expect(system).toContain('先见之明');
    expect(system).toContain('不落盘');
    expect(system).toContain('无委派');
    expect(system).not.toContain('缺少委派上下文时不要直接问用户');
  });
});
