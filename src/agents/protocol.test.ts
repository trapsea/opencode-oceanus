import { describe, expect, test } from 'bun:test';
import {
  DISPATCH_PROTOCOL,
  LEDGER_PROTOCOL,
  RUNTIME_GUARDS_PROTOCOL,
  TASK_BOARD_PROTOCOL,
  TERMINAL_STATE_PROTOCOL,
  buildAgentProtocol,
} from './protocol';
import { buildOceanusPrompt } from './oceanus';
import { createSisyphusAgent } from './sisyphus';

describe('Agent 编排公共协议', () => {
  test('公共协议各自拥有明确职责并可组合', () => {
    expect(DISPATCH_PROTOCOL).toContain('subagent');
    expect(TASK_BOARD_PROTOCOL).toContain('Active/Unknown');
    expect(TERMINAL_STATE_PROTOCOL).toContain('task_status');
    expect(LEDGER_PROTOCOL).toContain('pending');
    expect(RUNTIME_GUARDS_PROTOCOL).toContain('acceptance criteria');
    expect(buildAgentProtocol()).toContain(DISPATCH_PROTOCOL);
  });

  test('两个主 Agent prompt 使用同一公共协议关键规则', () => {
    const prompts = [buildOceanusPrompt(), createSisyphusAgent().system!];
    for (const prompt of prompts) {
      expect(prompt).toContain('task_status');
      expect(prompt).toContain('task_result');
      expect(prompt).toContain('Task Board');
    }
  });

  test('Oceanus 不重复定义 Ledger 状态协议', () => {
    const prompt = buildOceanusPrompt();
    expect(prompt.match(/ledger 区分 pending/g)?.length).toBe(1);
    expect(prompt).toContain('shared ledger');
  });

  test('协议段在 oceanus 与 sisyphus prompt 中各只注入一次（防双注入回归）', () => {
    const headers = [
      '### Dispatch Protocol',
      '### Task Board Protocol',
      '### Terminal State Protocol',
      '### Progress Ledger Protocol',
    ];
    for (const [name, prompt] of [['oceanus', buildOceanusPrompt()], ['sisyphus', createSisyphusAgent().system!]] as const) {
      for (const header of headers) {
        expect(prompt.split(header).length - 1).toBe(1);
      }
      void name;
    }
    // Runtime Guards 只由 sisyphus 追加段注入一次；oceanus 的 Verify 用自己的措辞表达 stale 语义。
    expect(createSisyphusAgent().system!.split('### Runtime Guards Protocol').length - 1).toBe(1);
    expect(buildOceanusPrompt()).not.toContain('### Runtime Guards Protocol');
  });
});
