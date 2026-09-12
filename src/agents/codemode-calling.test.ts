import { describe, expect, test } from 'bun:test';
import { OCEANUS_EXECUTE_SKILL } from '../skills/oceanus-execute';
import { CODEMODE_CALLING_PROTOCOL } from './protocol';
import { buildCompactPromptSections, renderPrompt } from './oceanus';

/**
 * Code Mode 调用纪律回归测试（beta-19296 宿主实证）：
 * `search` 是 execute JS 运行时的全局内置函数，不在 tools 命名空间内；
 * 模型写成 `tools.search(...)` 会触发 `Unknown tool 'search'`（真实会话复现）。
 * 本测试锁定纪律常量的关键内容与两个主 agent prompt 的接线，防止回归。
 */
describe('Code Mode 调用纪律', () => {
  test('纪律常量区分全局 search 与命名空间工具两种调用形态', () => {
    expect(CODEMODE_CALLING_PROTOCOL).toContain('tools.<ns>.<name>');
    expect(CODEMODE_CALLING_PROTOCOL).toContain('search({ query: "..." })');
    expect(CODEMODE_CALLING_PROTOCOL).toContain("Unknown tool 'search'");
    // 版本差异注记必须存在，防止宿主升级后纪律过时却无提示。
    expect(CODEMODE_CALLING_PROTOCOL).toContain('tools.$codemode.search');
  });

  test('oceanus 与 sisyphus 两个主 agent prompt 均携带纪律', () => {
    for (const variant of ['oceanus', 'sisyphus'] as const) {
      const prompt = renderPrompt(buildCompactPromptSections(undefined, true, variant));
      expect(prompt).toContain('### Code Mode 调用纪律');
    }
  });

  test('禁用 agent 场景下纪律仍然常驻', () => {
    const disabled = new Set(['observer']);
    const prompt = renderPrompt(buildCompactPromptSections(disabled, true, 'sisyphus'));
    expect(prompt).toContain('### Code Mode 调用纪律');
  });

  test('oceanus-execute skill 步骤 3 同步纪律（防 skill 文本漂移）', () => {
    expect(OCEANUS_EXECUTE_SKILL.content).toContain('**Code Mode 调用纪律**');
    expect(OCEANUS_EXECUTE_SKILL.content).toContain("Unknown tool 'search'");
  });
});
