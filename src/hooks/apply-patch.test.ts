import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  APPLY_PATCH_TOOLS,
  ApplyPatchError,
  assertAllTargetsInsideWorkspace,
  createApplyPatchHook,
  parsePatch,
  preparePatchText,
  rewritePatchConservatively,
  validateApplyPatchInput,
  verifyRewrite,
  writePatchInput,
  type ApplyPatchHookOptions,
  type ApplyPatchHookStatus,
} from './apply-patch';

/** beta 宿主工具名（双名键控的另一键为 OpenCode 2.0 的 `patch`，见 APPLY_PATCH_TOOLS）。 */
const APPLY_PATCH_TOOL = 'apply_patch' as const;

/**
 * 参考 oh-my-opencode-slim 的 apply-patch 算法思想，但适配 v2：
 * - 读写 `event.input`（不复制 v1 `output.args`）；
 * - 明确 fail-open（工作区外路径、只读 input）与 fail-closed
 *   （validation / verification / internal）策略。
 */

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'oceanus-apply-patch-'));
  temporaryDirectories.push(directory);
  return directory;
}

function canonicalPatch(): string {
  return [
    '*** Begin Patch',
    '*** Update File: src/a.ts',
    '@@',
    '-old',
    '+new',
    '*** End Patch',
  ].join('\n');
}

interface StatusSpy {
  events: Array<{ status: ApplyPatchHookStatus; data?: Record<string, unknown> }>;
  fn: ApplyPatchHookOptions['onStatus'];
}

function makeStatusSpy(): StatusSpy {
  const events: StatusSpy['events'] = [];
  return {
    events,
    fn: (status, data) => {
      events.push({ status, data });
    },
  };
}

function crlfPatch(): string {
  return canonicalPatch().split('\n').join('\r\n');
}

function heredocPatch(): string {
  return `<<'PATCH'\n${canonicalPatch()}\nPATCH`;
}

function backslashPathPatch(): string {
  return canonicalPatch().replace('src/a.ts', 'src\\a.ts');
}

describe('preparePatchText / 文本规范化', () => {
  test('CRLF 规整为 LF', () => {
    expect(preparePatchText(crlfPatch())).toBe(canonicalPatch());
  });

  test('剥离 heredoc 包裹', () => {
    expect(preparePatchText(heredocPatch())).toBe(canonicalPatch());
  });

  test('裁剪外层空白行', () => {
    const wrapped = `\n\n${canonicalPatch()}\n\n`;
    expect(preparePatchText(wrapped)).toBe(canonicalPatch());
  });
});

describe('parsePatch', () => {
  test('解析 Update / Add / Delete hunk', () => {
    const parsed = parsePatch(
      [
        '*** Begin Patch',
        '*** Update File: src/a.ts',
        '@@',
        '-old',
        '+new',
        '*** Add File: src/new.ts',
        '+line1',
        '+line2',
        '*** Delete File: src/gone.ts',
        '*** End Patch',
      ].join('\n'),
    );
    expect(parsed.hunks).toHaveLength(3);
    expect(parsed.hunks[0]).toMatchObject({
      type: 'update',
      path: 'src/a.ts',
      chunks: [{ oldLines: ['old'], newLines: ['new'] }],
    });
    expect(parsed.hunks[1]).toMatchObject({ type: 'add', path: 'src/new.ts', contents: 'line1\nline2' });
    expect(parsed.hunks[2]).toMatchObject({ type: 'delete', path: 'src/gone.ts' });
  });

  test('缺失 Begin/End 标记 → validation 错误', () => {
    expect(() => parsePatch('not a patch')).toThrow(ApplyPatchError);
    expect(() => parsePatch('not a patch')).toThrow(/Begin|End/i);
  });

  test('非法结构（hunk 外意外行）→ validation 错误', () => {
    const bad = ['*** Begin Patch', 'garbage line', '*** End Patch'].join('\n');
    expect(() => parsePatch(bad)).toThrow(ApplyPatchError);
  });
});

describe('路径边界', () => {
  test('工作区内路径通过', async () => {
    const root = await temporaryRoot();
    expect(() => assertAllTargetsInsideWorkspace(parsePatch(canonicalPatch()), root)).not.toThrow();
  });

  test('`..` 越界 → blocked/outside_workspace', async () => {
    const root = await temporaryRoot();
    const patch = canonicalPatch().replace('src/a.ts', '../outside.ts');
    expect(() => assertAllTargetsInsideWorkspace(parsePatch(patch), root)).toThrow(
      ApplyPatchError,
    );
    expect(() => assertAllTargetsInsideWorkspace(parsePatch(patch), root)).toThrow(
      /outside workspace/i,
    );
  });

  test('绝对路径越界 → blocked/outside_workspace', async () => {
    const root = await temporaryRoot();
    const patch = canonicalPatch().replace('src/a.ts', '/etc/passwd');
    expect(() => assertAllTargetsInsideWorkspace(parsePatch(patch), root)).toThrow(/outside/i);
  });

  test('move 目标越界同样被拒绝', async () => {
    const root = await temporaryRoot();
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/a.ts',
      '*** Move to: ../elsewhere.ts',
      '@@',
      '-old',
      '+new',
      '*** End Patch',
    ].join('\n');
    expect(() => assertAllTargetsInsideWorkspace(parsePatch(patch), root)).toThrow(/outside/i);
  });
});

describe('rewritePatchConservatively（保守重写）', () => {
  test('已规范文本：changed=false，内容不变', () => {
    const result = rewritePatchConservatively(canonicalPatch());
    expect(result.changed).toBe(false);
    expect(result.patchText).toBe(canonicalPatch());
  });

  test('CRLF 可修复：changed=true 且规整为 LF', () => {
    const result = rewritePatchConservatively(crlfPatch());
    expect(result.changed).toBe(true);
    expect(result.patchText).toBe(canonicalPatch());
  });

  test('heredoc 可修复：剥离包裹', () => {
    const result = rewritePatchConservatively(heredocPatch());
    expect(result.changed).toBe(true);
    expect(result.patchText).toBe(canonicalPatch());
  });

  test('反斜杠路径可修复：`\\`→`/`', () => {
    const result = rewritePatchConservatively(backslashPathPatch());
    expect(result.changed).toBe(true);
    expect(result.patchText).toBe(canonicalPatch());
  });

  test('内容行（空格/+/）不被改写', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/a.ts',
      '@@',
      ' keep  ',
      '-old  ',
      '+new',
      '*** End Patch',
    ].join('\n');
    const result = rewritePatchConservatively(patch);
    expect(result.changed).toBe(false);
    expect(result.patchText).toBe(patch);
  });
});

describe('verifyRewrite（等价校验）', () => {
  test('结构等价 → true', () => {
    const base = parsePatch(canonicalPatch());
    const candidate = parsePatch(backslashPathPatch().replace('\\', '/'));
    expect(verifyRewrite(base, candidate)).toBe(true);
  });

  test('hunk 数量不同 → false', () => {
    const base = parsePatch(canonicalPatch());
    const more = [
      '*** Begin Patch',
      '*** Update File: src/a.ts',
      '@@',
      '-old',
      '+new',
      '*** Add File: src/b.ts',
      '+x',
      '*** End Patch',
    ].join('\n');
    expect(verifyRewrite(base, parsePatch(more))).toBe(false);
  });

  test('内容行不同 → false', () => {
    const base = parsePatch(canonicalPatch());
    const changed = canonicalPatch().replace('-old', '-OLD');
    expect(verifyRewrite(base, parsePatch(changed))).toBe(false);
  });
});

describe('输入形状校验', () => {
  test('对象且含字符串 patchText → 通过', () => {
    expect(validateApplyPatchInput({ patchText: 'x' })).toBe('x');
  });

  test('非对象 → validation 错误', () => {
    expect(() => validateApplyPatchInput(undefined)).toThrow(ApplyPatchError);
    expect(() => validateApplyPatchInput(null)).toThrow(ApplyPatchError);
    expect(() => validateApplyPatchInput('str')).toThrow(ApplyPatchError);
  });

  test('缺失 patchText / 非字符串 → validation 错误', () => {
    expect(() => validateApplyPatchInput({})).toThrow(ApplyPatchError);
    expect(() => validateApplyPatchInput({ patchText: 42 })).toThrow(ApplyPatchError);
  });
});

describe('writePatchInput', () => {
  test('可写对象：原地 + 整体替换并写回', () => {
    const event = { tool: APPLY_PATCH_TOOL, input: { patchText: 'old' } };
    expect(writePatchInput(event, 'new-patch')).toBe(true);
    expect(event.input).toMatchObject({ patchText: 'new-patch' });
  });

  test('冻结（只读）对象 → false（fail-open 信号）', () => {
    const event = { tool: APPLY_PATCH_TOOL, input: Object.freeze({ patchText: 'x' }) };
    expect(writePatchInput(event, 'y')).toBe(false);
  });
});

describe('createApplyPatchHook（v2 execute.before）', () => {
  test('非补丁工具直接跳过，不改写、不抛、不发状态', async () => {
    const root = await temporaryRoot();
    const spy = makeStatusSpy();
    const hook = createApplyPatchHook({ root, onStatus: spy.fn });
    const event = { tool: 'edit', input: { patchText: canonicalPatch() } };

    await hook(event);

    expect(spy.events).toHaveLength(0);
    expect(event.input).toMatchObject({ patchText: canonicalPatch() });
  });

  test('工具名双键：OpenCode 2.0 名 patch 与 beta 名 apply_patch 均被处理', async () => {
    expect([...APPLY_PATCH_TOOLS]).toEqual(expect.arrayContaining(['apply_patch', 'patch']));
    const root = await temporaryRoot();
    const spy = makeStatusSpy();
    const hook = createApplyPatchHook({ root, onStatus: spy.fn });
    // 工作区外补丁：匹配键会走校验链并发 failopen 状态（证明 hook 生效），不匹配键零状态。
    const patch = canonicalPatch().replace('src/a.ts', '../outside.ts');
    for (const tool of APPLY_PATCH_TOOLS) {
      spy.events.length = 0;
      await hook({ tool, input: { patchText: patch } });
      expect(spy.events[0]?.status).toBe('failopen');
    }
    spy.events.length = 0;
    await hook({ tool: 'edit', input: { patchText: patch } });
    expect(spy.events).toHaveLength(0);
  });

  test('工作区外路径 → fail-open（不抛、不改写）', async () => {
    const root = await temporaryRoot();
    const spy = makeStatusSpy();
    const hook = createApplyPatchHook({ root, onStatus: spy.fn });
    const patch = canonicalPatch().replace('src/a.ts', '../outside.ts');
    const event = { tool: APPLY_PATCH_TOOL, input: { patchText: patch } };

    await expect(hook(event)).resolves.toBeUndefined();

    expect(spy.events[0]?.status).toBe('failopen');
    expect(event.input).toMatchObject({ patchText: patch });
  });

  test('可修复 patch（CRLF）→ rewritten，写回 event.input', async () => {
    const root = await temporaryRoot();
    const spy = makeStatusSpy();
    const hook = createApplyPatchHook({ root, onStatus: spy.fn });
    const event = { tool: APPLY_PATCH_TOOL, input: { patchText: crlfPatch() } };

    await hook(event);

    expect(spy.events[0]?.status).toBe('rewritten');
    expect(event.input).toMatchObject({ patchText: canonicalPatch() });
  });

  test('已规范 patch → unchanged，不改写', async () => {
    const root = await temporaryRoot();
    const spy = makeStatusSpy();
    const hook = createApplyPatchHook({ root, onStatus: spy.fn });
    const event = { tool: APPLY_PATCH_TOOL, input: { patchText: canonicalPatch() } };

    await hook(event);

    expect(spy.events[0]?.status).toBe('unchanged');
    expect(event.input).toMatchObject({ patchText: canonicalPatch() });
  });

  test('输入非对象 → validation，fail-closed（抛错）', async () => {
    const root = await temporaryRoot();
    const spy = makeStatusSpy();
    const hook = createApplyPatchHook({ root, onStatus: spy.fn });

    await expect(hook({ tool: APPLY_PATCH_TOOL, input: 'oops' as unknown })).rejects.toThrow(
      ApplyPatchError,
    );
    await expect(hook({ tool: APPLY_PATCH_TOOL, input: 'oops' as unknown })).rejects.toThrow(
      /input/i,
    );
  });

  test('patchText 非字符串 → validation，fail-closed', async () => {
    const root = await temporaryRoot();
    const spy = makeStatusSpy();
    const hook = createApplyPatchHook({ root, onStatus: spy.fn });

    await expect(
      hook({ tool: APPLY_PATCH_TOOL, input: { patchText: 42 } as unknown }),
    ).rejects.toThrow(ApplyPatchError);
    expect(spy.events[0]?.status).toBe('validation');
  });

  test('不可解析 patchText → validation，fail-closed', async () => {
    const root = await temporaryRoot();
    const spy = makeStatusSpy();
    const hook = createApplyPatchHook({ root, onStatus: spy.fn });

    await expect(
      hook({ tool: APPLY_PATCH_TOOL, input: { patchText: 'not a patch' } }),
    ).rejects.toThrow(ApplyPatchError);
    expect(spy.events[0]?.status).toBe('validation');
  });

  test('重写结果无法通过防御性校验 → verification，fail-closed', async () => {
    const root = await temporaryRoot();
    const spy = makeStatusSpy();
    // 注入一个返回不可解析文本的改写，模拟改写引入结构变化。
    const hook = createApplyPatchHook({
      root,
      onStatus: spy.fn,
      rewrite: () => ({ patchText: 'garbage not a patch', changed: true }),
    });

    await expect(
      hook({ tool: APPLY_PATCH_TOOL, input: { patchText: canonicalPatch() } }),
    ).rejects.toThrow(ApplyPatchError);
    await expect(
      hook({ tool: APPLY_PATCH_TOOL, input: { patchText: canonicalPatch() } }),
    ).rejects.toThrow(/verification/i);
  });

  test('重写抛内部异常 → internal，fail-closed', async () => {
    const root = await temporaryRoot();
    const spy = makeStatusSpy();
    const hook = createApplyPatchHook({
      root,
      onStatus: spy.fn,
      rewrite: () => {
        throw new Error('boom');
      },
    });

    await expect(
      hook({ tool: APPLY_PATCH_TOOL, input: { patchText: canonicalPatch() } }),
    ).rejects.toThrow(ApplyPatchError);
    await expect(
      hook({ tool: APPLY_PATCH_TOOL, input: { patchText: canonicalPatch() } }),
    ).rejects.toThrow(/internal/i);
  });

  test('只读 event.input 写回失败 → fail-open（不抛）', async () => {
    const root = await temporaryRoot();
    const spy = makeStatusSpy();
    const hook = createApplyPatchHook({ root, onStatus: spy.fn });
    const event = {
      tool: APPLY_PATCH_TOOL,
      input: Object.freeze({ patchText: crlfPatch() }),
    };

    await expect(hook(event)).resolves.toBeUndefined();

    expect(spy.events[0]?.status).toBe('failopen');
  });

  test('工作区外路径重写（注入）→ 防御性校验判定为 verification（非 fail-open）', async () => {
    const root = await temporaryRoot();
    const spy = makeStatusSpy();
    // 注入改写引入越界路径；即便重写成功，一旦决定改写，任何不一致都 fail-closed。
    const hook = createApplyPatchHook({
      root,
      onStatus: spy.fn,
      rewrite: () => ({
        patchText: canonicalPatch().replace('src/a.ts', '../evil.ts'),
        changed: true,
      }),
    });

    await expect(
      hook({ tool: APPLY_PATCH_TOOL, input: { patchText: canonicalPatch() } }),
    ).rejects.toThrow(/verification/i);
  });
});
