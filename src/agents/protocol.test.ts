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
import { DELEGATION_BRIEF_PROMPT } from './orchestrator-context';

describe('Agent 编排公共协议', () => {
  test('公共协议各自拥有明确职责并可组合', () => {
    expect(DISPATCH_PROTOCOL).toContain('subagent');
    expect(TASK_BOARD_PROTOCOL).toContain('Active/Unknown');
    expect(TERMINAL_STATE_PROTOCOL).toContain('task_status');
    expect(LEDGER_PROTOCOL).toContain('pending');
    expect(RUNTIME_GUARDS_PROTOCOL).toContain('acceptance criteria');
    expect(buildAgentProtocol()).toContain(DISPATCH_PROTOCOL);
  });

  test('三个 Agent prompt 使用同一公共协议关键规则', () => {
    const prompts = [buildOceanusPrompt(), createSisyphusAgent().system!, DELEGATION_BRIEF_PROMPT];
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
});
