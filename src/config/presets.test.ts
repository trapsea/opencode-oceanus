import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  getUserPresetConfigPath,
  readUserConfig,
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
