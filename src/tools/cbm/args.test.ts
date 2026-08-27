import { describe, expect, test } from 'bun:test';
import {
  buildCbmEnv,
  canonicalToolName,
  CbmBoundaryError,
  extractProjectPath,
  isPathWithinRoot,
  isSensitiveEnvKey,
  isToolNotFoundOutput,
  isTraceTool,
  validateProjectPath,
  deriveProjectName,
} from './args';

/**
 * CBM-03：CLI 执行器参数纯函数契约。
 *
 * 覆盖路径越界校验、工具名归一化（trace_call_path→trace_path）、
 * 环境变量白名单（不继承 provider token）与旧版本 trace fallback 判定。
 */

describe('isPathWithinRoot / validateProjectPath', () => {
  test('相对/绝对路径位于 root 内时通过', () => {
    expect(isPathWithinRoot('src', '/ws')).toBe(true);
    expect(isPathWithinRoot('src/a.ts', '/ws')).toBe(true);
    expect(isPathWithinRoot('/ws/src', '/ws')).toBe(true);
    expect(isPathWithinRoot('.', '/ws')).toBe(true);
  });

  test('越界路径被拒绝', () => {
    expect(isPathWithinRoot('../outside', '/ws')).toBe(false);
    expect(isPathWithinRoot('/etc', '/ws')).toBe(false);
    expect(isPathWithinRoot('../../etc', '/ws')).toBe(false);
    expect(isPathWithinRoot('/ws2/src', '/ws')).toBe(false);
  });

  test('validateProjectPath：内部路径返回规范化绝对路径', () => {
    expect(validateProjectPath('src', '/ws')).toBe('/ws/src');
    expect(validateProjectPath('.', '/ws')).toBe('/ws');
  });

  test('validateProjectPath：未提供/空串返回 undefined', () => {
    expect(validateProjectPath(undefined, '/ws')).toBeUndefined();
    expect(validateProjectPath('', '/ws')).toBeUndefined();
  });

  test('validateProjectPath：越界抛出 CbmBoundaryError', () => {
    expect(() => validateProjectPath('../outside', '/ws')).toThrow(CbmBoundaryError);
    expect(() => validateProjectPath('/etc', '/ws')).toThrow(CbmBoundaryError);
    try {
      validateProjectPath('../x', '/ws');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CbmBoundaryError);
      expect((e as CbmBoundaryError).requested).toBe('../x');
      expect((e as CbmBoundaryError).workspaceRoot).toBe('/ws');
    }
  });
});

describe('extractProjectPath', () => {
  test('识别 repository_path / path / workspace_root 字段', () => {
    expect(extractProjectPath({ repository_path: '/ws/a' })).toBe('/ws/a');
    expect(extractProjectPath({ project_path: '/ws/b' })).toBe('/ws/b');
    expect(extractProjectPath({ path: 'src' })).toBe('src');
    expect(extractProjectPath({ workspace_root: '/ws' })).toBe('/ws');
  });

  test('无路径字段或非法输入返回 undefined', () => {
    expect(extractProjectPath({ query: 'x' })).toBeUndefined();
    expect(extractProjectPath({ repository_path: '' })).toBeUndefined();
    expect(extractProjectPath(null)).toBeUndefined();
    expect(extractProjectPath(undefined)).toBeUndefined();
    expect(extractProjectPath('not-an-object')).toBeUndefined();
  });
});

describe('deriveProjectName', () => {
  test('生成稳定、清理后的项目名', () => {
    expect(deriveProjectName('/workspace/my_repo.v2')).toBe('my_repo.v2');
    expect(deriveProjectName('///')).toBe('workspace');
  });
});

describe('工具名归一化与 trace fallback 判定', () => {
  test('canonicalToolName：trace_call_path → trace_path', () => {
    expect(canonicalToolName('trace_call_path')).toBe('trace_path');
    expect(canonicalToolName('trace_path')).toBe('trace_path');
    expect(canonicalToolName('search_graph')).toBe('search_graph');
  });

  test('isTraceTool 覆盖 canonical 与旧版本 alias', () => {
    expect(isTraceTool('trace_path')).toBe(true);
    expect(isTraceTool('trace_call_path')).toBe(true);
    expect(isTraceTool('search_graph')).toBe(false);
    expect(isTraceTool('detect_changes')).toBe(false);
  });

  test('isToolNotFoundOutput：识别工具不存在类错误', () => {
    expect(isToolNotFoundOutput('', "unrecognized subcommand 'trace_path'")).toBe(true);
    expect(isToolNotFoundOutput('', 'unknown tool: trace_path')).toBe(true);
    expect(isToolNotFoundOutput('', 'invalid tool name')).toBe(true);
    expect(isToolNotFoundOutput('', 'command not found')).toBe(true);
    expect(isToolNotFoundOutput('', 'some unrelated error')).toBe(false);
    expect(isToolNotFoundOutput('', '')).toBe(false);
  });
});

describe('buildCbmEnv 环境白名单', () => {
  test('白名单：继承允许项，不继承 provider token', () => {
    const base = {
      CBM_CACHE_DIR: '/cache',
      PATH: '/usr/bin',
      HOME: '/root',
      OPENAI_API_KEY: 'sk-xxx',
      ANTHROPIC_API_KEY: 'sk-ant-xxx',
      OPENCODE_API_KEY: 'sk-oc-xxx',
      AWS_SECRET_ACCESS_KEY: 's3cret',
      SOME_TOKEN: 'tok',
      GITHUB_TOKEN: 'ghp_xxx',
    };
    const env = buildCbmEnv({}, base);
    expect(env.CBM_CACHE_DIR).toBe('/cache');
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/root');
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENCODE_API_KEY).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.SOME_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });

  test('覆盖项：CBM_CACHE_DIR 显式注入并保留', () => {
    const env = buildCbmEnv({ CBM_CACHE_DIR: '/my/cache' }, {});
    expect(env.CBM_CACHE_DIR).toBe('/my/cache');
  });

  test('敏感覆盖项被剥离（纵深防御）', () => {
    const env = buildCbmEnv(
      { API_TOKEN: 'x', CBM_CACHE_DIR: '/c', ANTHROPIC_AUTH_TOKEN: 'y' },
      {},
    );
    expect(env.API_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.CBM_CACHE_DIR).toBe('/c');
  });

  test('isSensitiveEnvKey', () => {
    expect(isSensitiveEnvKey('OPENAI_API_KEY')).toBe(true);
    expect(isSensitiveEnvKey('API_TOKEN')).toBe(true);
    expect(isSensitiveEnvKey('AWS_SECRET_ACCESS_KEY')).toBe(true);
    expect(isSensitiveEnvKey('CBM_CACHE_DIR')).toBe(false);
    expect(isSensitiveEnvKey('PATH')).toBe(false);
  });
});
