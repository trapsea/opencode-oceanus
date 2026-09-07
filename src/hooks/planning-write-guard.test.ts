import { describe, expect, test } from 'bun:test';
import {
  PLANNING_GUARD_DIRS,
  PlanningWriteBlockedError,
  countLines,
  createPlanningWriteGuardHook,
  isManagedPlanningPath,
} from './planning-write-guard';
import path from 'node:path';

const ROOT = '/ws/proj';

function makeHook(files: Record<string, string>) {
  const statuses: Array<[string, Record<string, unknown> | undefined]> = [];
  const hook = createPlanningWriteGuardHook({
    root: ROOT,
    readFileImpl: async (p) => {
      const rel = path.relative(ROOT, p);
      if (!(rel in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files[rel];
    },
    onStatus: (status, data) => statuses.push([status, data]),
  });
  return { hook, statuses };
}

describe('isManagedPlanningPath / countLines', () => {
  test('受管目录命中，目录外与越界路径放行', () => {
    expect(isManagedPlanningPath(path.join(ROOT, '.oceanus/plan/a.md'), ROOT)).toBe(true);
    expect(isManagedPlanningPath(path.join(ROOT, '.oceanus/spec/x.md'), ROOT)).toBe(true);
    expect(isManagedPlanningPath(path.join(ROOT, '.oceanus/review/deep/nested.md'), ROOT)).toBe(true);
    expect(isManagedPlanningPath(path.join(ROOT, 'src/a.ts'), ROOT)).toBe(false);
    expect(isManagedPlanningPath(path.join(ROOT, '.oceanus/media/x.png'), ROOT)).toBe(false);
    expect(isManagedPlanningPath(path.resolve(ROOT, '../other/.oceanus/plan/a.md'), ROOT)).toBe(false);
  });

  test('PLANNING_GUARD_DIRS 覆盖六类 curated 目录', () => {
    expect(PLANNING_GUARD_DIRS).toEqual([
      '.oceanus/spec',
      '.oceanus/plan',
      '.oceanus/progress',
      '.oceanus/review',
      '.oceanus/findings',
      '.oceanus/learnings',
    ]);
  });

  test('countLines 基本行为', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('one')).toBe(1);
    expect(countLines('a\nb\nc')).toBe(3);
    expect(countLines('a\nb\n')).toBe(3);
  });
});

describe('createPlanningWriteGuardHook：execute.before 行为', () => {
  const bigDoc = `${Array.from({ length: 100 }, (_, i) => `line-${i}`).join('\n')}`;
  const halfDoc = `${Array.from({ length: 60 }, (_, i) => `kept-${i}`).join('\n')}`;

  test('#973 场景：读小窗口后整写覆盖大文档 → 阻断并携带行数证据', async () => {
    const { hook, statuses } = makeHook({ '.oceanus/plan/big.md': bigDoc });
    let err: unknown;
    try {
      await hook['tool.execute.before']({
        tool: 'write',
        input: { path: '.oceanus/plan/big.md', content: 'only the window I read' },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PlanningWriteBlockedError);
    const blocked = err as PlanningWriteBlockedError;
    expect(blocked.oldLines).toBe(100);
    expect(blocked.newLines).toBe(1);
    expect(blocked.message).toContain('edit');
    expect(blocked.message).toContain('disabled_hooks');
    expect(statuses[0]?.[0]).toBe('blocked');
  });

  test('等量/增长覆盖与非缩减持仓放行', async () => {
    const { hook, statuses } = makeHook({ '.oceanus/plan/big.md': bigDoc });
    await hook['tool.execute.before']({
      tool: 'write',
      input: { path: '.oceanus/plan/big.md', content: `${bigDoc}\nmore` },
    });
    await hook['tool.execute.before']({
      tool: 'write',
      input: { path: '.oceanus/plan/big.md', content: halfDoc },
    });
    expect(statuses.map(([s]) => s)).toEqual(['allowed', 'allowed']);
  });

  test('小文档（< 阈值）缩减不拦：避免噪声', async () => {
    const { hook, statuses } = makeHook({ '.oceanus/spec/tiny.md': 'a\nb\nc\nd\ne' });
    await hook['tool.execute.before']({
      tool: 'write',
      input: { path: '.oceanus/spec/tiny.md', content: 'x' },
    });
    expect(statuses[0]?.[0]).toBe('allowed');
  });

  test('新建文件与受管目录外写入放行', async () => {
    const { hook, statuses } = makeHook({ '.oceanus/plan/exists.md': bigDoc });
    await hook['tool.execute.before']({
      tool: 'write',
      input: { path: '.oceanus/plan/new.md', content: 'x' },
    });
    await hook['tool.execute.before']({
      tool: 'write',
      input: { path: 'src/generated.ts', content: 'x' },
    });
    expect(statuses.map(([s]) => s)).toEqual(['new_file', 'unmanaged']);
  });

  test('edit / 非对象入参 / 缺字段：不处理', async () => {
    const { hook } = makeHook({ '.oceanus/plan/big.md': bigDoc });
    await hook['tool.execute.before']({
      tool: 'edit',
      input: { path: '.oceanus/plan/big.md', oldString: 'a', newString: 'b' },
    });
    await hook['tool.execute.before']({ tool: 'write', input: null });
    await hook['tool.execute.before']({ tool: 'write', input: { path: '.oceanus/plan/big.md' } });
  });

  test('readFileImpl 抛非 ENOENT 类异常时 fail-open 放行', async () => {
    const hook = createPlanningWriteGuardHook({
      root: ROOT,
      readFileImpl: async () => {
        throw new Error('EACCES: permission denied');
      },
    });
    await expect(
      hook['tool.execute.before']({
        tool: 'write',
        input: { path: '.oceanus/plan/big.md', content: 'x' },
      }),
    ).resolves.toBeUndefined();
  });
});
