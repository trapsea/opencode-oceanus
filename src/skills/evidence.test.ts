import { describe, expect, test } from 'bun:test';
import { SISYPHUS_SKILLS } from './index';

const execute = SISYPHUS_SKILLS.find((skill) => skill.name === 'sisyphus-execute');

describe('Execute evidence tier 契约', () => {
  test('阶段说明使用中文自然语言', () => {
    expect(execute?.content ?? '').not.toMatch(/You must|The following|Evidence tier/);
  });
  test('声明三档 tier 及各自证据要求', () => {
    const content = execute?.content ?? '';
    expect(content).toMatch(/strict[\s\S]*RED[\s\S]*GREEN[\s\S]*real-surface/);
    expect(content).toMatch(/light[\s\S]*test-after[\s\S]*测试/);
    expect(content).toMatch(/exempt[\s\S]*白名单[\s\S]*理由/);
  });

  test('拒绝缺失或 stale evidence，并升级公共符号', () => {
    const content = execute?.content ?? '';
    expect(content).toMatch(/缺失[\s\S]*未完成/);
    expect(content).toMatch(/stale[\s\S]*未完成/);
    expect(content).toMatch(/公共符号[\s\S]*strict/);
  });

  test('TDD × strict 组合矩阵消除 RED 歧义', () => {
    const content = execute?.content ?? '';
    // 组合矩阵存在且覆盖三种组合
    expect(content).toMatch(/TDD × Evidence Tier 组合矩阵/);
    expect(content).toMatch(/strict \+ TDD on[\s\S]*RED \+ GREEN \+ real-surface/);
    expect(content).toMatch(/strict \+ TDD off[\s\S]*characterization[\s\S]*不得伪称存在 RED/);
    // 禁止先写生产代码的回退义务限定为 TDD on
    expect(content).toMatch(/禁止先写生产代码.*仅 TDD on 时适用/);
    // 两份证明的 code proof 定义按 TDD 开关分流
    expect(content).toMatch(/代码证明（TDD on：同一测试的 RED 输出 \+ GREEN 输出；TDD off：characterization 基线 \+ 最终状态 GREEN）/);
  });

  test('Plan-Change 使门禁失效并要求重审', () => {
    const content = execute?.content ?? '';
    expect(content).toMatch(/Plan-Change[\s\S]*配置批问\/方案总批准均失效/);
    expect(content).toMatch(/旧的.*失效/);
  });

  test('frontmatter 与 TypeScript description 各自唯一且一致', () => {
    const skill = execute!;
    const matches = skill.content.match(/^description:\s*(.+)$/gm) ?? [];
    expect(matches).toHaveLength(1);
    expect(matches[0]?.replace(/^description:\s*/, '')).toBe(skill.description);
  });
});
