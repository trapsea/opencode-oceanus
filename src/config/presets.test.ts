import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  getUserPresetConfigPath,
  readUserConfig,
  resolveSessionModelRef,
  updateUserPreset,
} from './presets';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'oceanus-presets-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('用户级 preset 配置', () => {
  test('优先选择已有 jsonc，其次选择已有 json', async () => {
    const directory = await temporaryDirectory();
    const base = join(directory, 'opencode-oceanus');

    expect(getUserPresetConfigPath(directory)).toBe(`${base}.jsonc`);
    await writeFile(`${base}.json`, '{}');
    expect(getUserPresetConfigPath(directory)).toBe(`${base}.json`);
    await writeFile(`${base}.jsonc`, '{}');
    expect(getUserPresetConfigPath(directory)).toBe(`${base}.jsonc`);
  });

  test('读取 JSONC，并在更新时保留其它顶层配置', async () => {
    const directory = await temporaryDirectory();
    const file = join(directory, 'opencode-oceanus.jsonc');
    await writeFile(
      file,
      '{\n  // keep this comment-compatible config\n  "agents": {"fixer": {"model": "x"}},\n  "presets": {"fast": {"explorer": {"model": "y"}}},\n}\n',
    );

    expect(readUserConfig(file)).toEqual({
      agents: { fixer: { model: 'x' } },
      presets: { fast: { explorer: { model: 'y' } } },
    });
    updateUserPreset('fast', { configDir: directory });
    expect(readUserConfig(file)).toEqual({
      preset: 'fast',
      agents: { fixer: { model: 'x' } },
      presets: { fast: { explorer: { model: 'y' } } },
    });
  });

  test('新文件写入用户目录，并只改变顶层 preset', async () => {
    const directory = await temporaryDirectory();
    await mkdir(join(directory, 'nested'), { recursive: true });

    const result = updateUserPreset('balanced', { configDir: join(directory, 'nested') });
    expect(result.path).toBe(
      join(directory, 'nested', 'opencode-oceanus.jsonc'),
    );
    expect(JSON.parse(await readFile(result.path, 'utf8'))).toEqual({
      preset: 'balanced',
    });
  });
});

describe('resolveSessionModelRef（#variant 分离，P1-1 回归）', () => {
  test('字符串内嵌 #variant 被分离，不再混入 model id', () => {
    expect(resolveSessionModelRef({ model: 'zai/glm-5.3#flash' })).toEqual({
      providerID: 'zai',
      id: 'glm-5.3',
      variant: 'flash',
    });
  });

  test('字符串无 #variant + 顶层 variant 回落填充', () => {
    expect(resolveSessionModelRef({ model: 'zai/glm-5.3', variant: 'flash' })).toEqual({
      providerID: 'zai',
      id: 'glm-5.3',
      variant: 'flash',
    });
  });

  test('字符串无 #variant 且无顶层 variant 时不携带 variant 字段', () => {
    expect(resolveSessionModelRef({ model: 'zai/glm-5.3' })).toEqual({
      providerID: 'zai',
      id: 'glm-5.3',
    });
  });

  test('数组字符串首项按字符串语义解析', () => {
    expect(resolveSessionModelRef({ model: ['deepseek/reasoner#thinking'] })).toEqual({
      providerID: 'deepseek',
      id: 'reasoner',
      variant: 'thinking',
    });
  });

  test('数组对象首项：id 解析且对象项 variant 生效', () => {
    expect(resolveSessionModelRef({ model: [{ id: 'zai/glm-5.3', variant: 'flash' }] })).toEqual({
      providerID: 'zai',
      id: 'glm-5.3',
      variant: 'flash',
    });
  });

  test('内嵌 #variant 优先于顶层 override.variant', () => {
    expect(resolveSessionModelRef({ model: 'zai/glm-5.3#flash', variant: 'thinking' })).toEqual({
      providerID: 'zai',
      id: 'glm-5.3',
      variant: 'flash',
    });
  });

  test('对象项 variant 优先于顶层 override.variant', () => {
    expect(
      resolveSessionModelRef({ model: [{ id: 'zai/glm-5.3', variant: 'flash' }], variant: 'thinking' }),
    ).toEqual({
      providerID: 'zai',
      id: 'glm-5.3',
      variant: 'flash',
    });
  });

  test('对象项显式 variant 字段优先于 id 内嵌 #variant', () => {
    expect(
      resolveSessionModelRef({ model: [{ id: 'zai/glm-5.3#flash', variant: 'thinking' }] }),
    ).toEqual({
      providerID: 'zai',
      id: 'glm-5.3',
      variant: 'thinking',
    });
  });

  test('无效输入返回 undefined：无斜杠、空 variant、空数组、缺失 model', () => {
    expect(resolveSessionModelRef({ model: 'glm-5.3' })).toBeUndefined();
    expect(resolveSessionModelRef({ model: 'zai/glm-5.3#' })).toBeUndefined();
    expect(resolveSessionModelRef({ model: 'zai/glm-5.3#flash#extra' })).toBeUndefined();
    expect(resolveSessionModelRef({ model: [] })).toBeUndefined();
    expect(resolveSessionModelRef({})).toBeUndefined();
    expect(resolveSessionModelRef(undefined)).toBeUndefined();
  });
});
