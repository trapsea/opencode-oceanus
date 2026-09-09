import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupStaleVersions } from './cleanup';

/**
 * 构造 OpenCode 宿主 npm 缓存布局的真实文件系统 fixture：
 * <root>/opencode-oceanus@latest/<ts>/node_modules/opencode-oceanus/...
 * modulePath 指向活跃时间戳目录内的模块文件。
 */
function buildLayout(root: string, activeTs = '1788927293658') {
  const identity = join(root, 'opencode-oceanus@latest');
  const mk = (ts: string, opts: { name?: string; omitPkg?: boolean } = {}) => {
    const pkgDir = join(identity, ts, 'node_modules', 'opencode-oceanus');
    mkdirSync(pkgDir, { recursive: true });
    if (!opts.omitPkg) {
      writeFileSync(
        join(pkgDir, 'package.json'),
        JSON.stringify({ name: opts.name ?? 'opencode-oceanus', version: '0.0.0' }),
      );
    }
    mkdirSync(join(pkgDir, 'dist'), { recursive: true });
    writeFileSync(join(pkgDir, 'dist', 'index.js'), '');
    return join(identity, ts);
  };
  const activeDir = mk(activeTs);
  const modulePath = join(activeDir, 'node_modules', 'opencode-oceanus', 'dist', 'index.js');
  return { identity, mk, activeDir, modulePath };
}

describe('cleanupStaleVersions', () => {
  let root: string;

  beforeEach(() => {
    mkdirSync('/tmp/opencode', { recursive: true });
    root = mkdtempSync(join('/tmp/opencode', 'oceanus-cleanup-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('删除更旧的时间戳目录，保留活跃目录与更新的目录', () => {
    const older = '1000000000000';
    const { mk, modulePath } = buildLayout(root);
    mk(older);
    const newer = '1888888888888';
    mk(newer);
    const identity = join(root, 'opencode-oceanus@latest');

    const result = cleanupStaleVersions({ modulePath });

    expect(result.removed).toEqual([older]);
    expect(result.skipped).toEqual([newer]);
    expect(existsSync(join(identity, older))).toBe(false);
    expect(existsSync(join(identity, newer))).toBe(true);
    expect(existsSync(join(identity, '1788927293658'))).toBe(true);
  });

  test('非数字命名的目录不属于清理对象，静默忽略', () => {
    const { identity, modulePath } = buildLayout(root);
    mkdirSync(join(identity, 'staging-abc'), { recursive: true });
    mkdirSync(join(identity, 'live'), { recursive: true });

    const result = cleanupStaleVersions({ modulePath });

    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(existsSync(join(identity, 'staging-abc'))).toBe(true);
    expect(existsSync(join(identity, 'live'))).toBe(true);
  });

  test('更旧但 package.json name 校验失败的目录跳过不删', () => {
    const bad = '1000000000002';
    const { identity, mk, modulePath } = buildLayout(root);
    mk(bad, { name: 'someone-else' });

    const result = cleanupStaleVersions({ modulePath });

    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual([bad]);
    expect(existsSync(join(identity, bad))).toBe(true);
  });

  test('只处理当前 identity 目录，不触碰其他 identity（如 pinned）', () => {
    const { mk, modulePath } = buildLayout(root);
    mk('1000000000000');
    const pinnedIdentity = join(root, 'opencode-oceanus@0.49.0');
    const pinnedTs = join(pinnedIdentity, '1000000000000', 'node_modules', 'opencode-oceanus');
    mkdirSync(pinnedTs, { recursive: true });
    writeFileSync(
      join(pinnedTs, 'package.json'),
      JSON.stringify({ name: 'opencode-oceanus', version: '0.49.0' }),
    );

    cleanupStaleVersions({ modulePath });

    expect(existsSync(pinnedTs)).toBe(true);
  });

  test('无法解析安装上下文（本地开发/路径布局）时 no-op 并返回原因', () => {
    mkdirSync(join(root, 'plain'), { recursive: true });
    writeFileSync(join(root, 'plain', 'index.js'), '');

    const result = cleanupStaleVersions({ modulePath: join(root, 'plain', 'index.js') });

    expect(result.reason).toBe('no-context');
    expect(result.removed).toEqual([]);
  });

  test('活跃目录名非数字时间戳（宿主布局变化）时整体放弃', () => {
    const identity = join(root, 'opencode-oceanus@latest');
    const pkgDir = join(identity, 'custom-name', 'node_modules', 'opencode-oceanus');
    mkdirSync(join(pkgDir, 'dist'), { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'opencode-oceanus' }));
    writeFileSync(join(pkgDir, 'dist', 'index.js'), '');
    mkdirSync(join(identity, '1000000000000'), { recursive: true });

    const result = cleanupStaleVersions({
      modulePath: join(pkgDir, 'dist', 'index.js'),
    });

    expect(result.reason).toBe('layout-unknown');
    expect(result.removed).toEqual([]);
    expect(existsSync(join(identity, '1000000000000'))).toBe(true);
  });

  test('删除抛错时不外抛，记录 skipped 并继续', () => {
    const older = '1000000000000';
    const { mk, modulePath } = buildLayout(root);
    mk(older);
    const errors: unknown[] = [];

    const result = cleanupStaleVersions({
      modulePath,
      rm: () => {
        throw new Error('permission denied');
      },
      log: (event) => errors.push(event),
    });

    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual([older]);
    expect(errors.length).toBeGreaterThan(0);
    expect(existsSync(join(root, 'opencode-oceanus@latest', older))).toBe(true);
  });

  test('identity 目录为空或仅剩活跃目录时为幂等 no-op', () => {
    const { modulePath } = buildLayout(root);

    const result = cleanupStaleVersions({ modulePath });

    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.reason).toBeUndefined();
  });
});
