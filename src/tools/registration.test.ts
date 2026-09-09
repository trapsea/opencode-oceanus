import { describe, expect, test } from 'bun:test';
import { registerOceanusTools } from './index';
import type { PluginConfig } from '../config/schema';
import type { ToolDefinition, ToolingContext } from '../runtime/types';

function mockContext(added: ToolDefinition[]): ToolingContext {
  return {
    tool: {
      transform: async (cb) => {
        cb({ add: (tool) => added.push(tool) });
      },
      hook: async () => {},
    },
  } as unknown as ToolingContext;
}

describe('工具注册目录', () => {
  test('cbm_index 进入直接工具目录，避免 Code Mode catalog 中 Unknown tool', async () => {
    const added: ToolDefinition[] = [];
    const config = {} as PluginConfig;

    await registerOceanusTools(mockContext(added), config, {
      cbmIndexer: {
        ensureIndexed: async () => ({ kind: 'indexed' }),
        isIndexed: () => false,
        isIndexing: () => false,
        getLastOutcome: () => undefined,
        runExclusive: (_projectPath, _workspaceRoot, fn) => fn(),
        reset: () => {},
      },
    });

    const tool = added.find((item) => item.name === 'cbm_index');
    expect(tool).toBeDefined();
    expect(tool?.options).toMatchObject({ codemode: false });
  });
});
