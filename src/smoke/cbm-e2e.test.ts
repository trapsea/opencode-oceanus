/**
 * CBM-14 跨模块验收夹具：只使用 fake CLI，不触碰网络、daemon 或真实缓存。
 */
import { describe, expect, test } from 'bun:test';
import { createIndexer } from '../cbm/indexer';
import { buildManifestUrl, createCanonicalManifest } from '../cbm/manifest';
import { resolveCbmPlatform } from '../cbm/constants';
import { INDEX_REPOSITORY_TOOL, INDEX_STATUS_TOOL } from '../tools/cbm/types';

describe('CBM-14 离线端到端验收夹具', () => {
  test('六平台 manifest 可模拟解析，Windows 使用 zip 与 exe', () => {
    const platforms = [
      ['darwin', 'x64'], ['darwin', 'arm64'], ['linux', 'x64'],
      ['linux', 'arm64'], ['win32', 'x64'], ['win32', 'arm64'],
    ] as const;
    for (const [os, arch] of platforms) {
      const manifest = resolveCbmPlatform(os, arch);
      const url = buildManifestUrl(manifest);
      const release = createCanonicalManifest(manifest, 'a'.repeat(64));
      expect(url.startsWith('https://')).toBe(true);
      if (os === 'win32') {
        expect(url.endsWith('.zip')).toBe(true);
        expect(release.binaryPath).toEndWith('.exe');
      } else {
        expect(url.endsWith('.tar.gz')).toBe(true);
        expect(release.binaryPath.includes('.exe')).toBe(false);
      }
    }
  });

  test('Windows index_repository 失败返回结构化降级，绝不误报成功', async () => {
    const calls: string[] = [];
    const indexer = createIndexer({
      autoIndex: true,
      runCli: async (options) => {
        calls.push(options.tool);
        if (options.tool === INDEX_STATUS_TOOL) {
          return { ok: true, tool: options.tool, data: { status: 'unindexed' } };
        }
        return {
          ok: false,
          tool: INDEX_REPOSITORY_TOOL,
          data: undefined,
          error: { code: 'exit_nonzero', message: 'Windows index_repository unsupported' },
        };
      },
    });
    const outcome = await indexer.ensureIndexed('C:/workspace/project', {
      workspaceRoot: 'C:/workspace', timeoutMs: 1000, autoIndex: true,
    });
    expect(calls).toEqual([INDEX_STATUS_TOOL, INDEX_REPOSITORY_TOOL]);
    expect(outcome).toMatchObject({ kind: 'degraded', reason: 'index_failed', errorCode: 'exit_nonzero' });
    expect(indexer.isIndexed('C:/workspace/project', 'C:/workspace')).toBe(false);
  });
});
