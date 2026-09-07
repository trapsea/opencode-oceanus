import { describe, expect, test } from 'bun:test';
import {
  SECRET_READ_TOOLS,
  SecretReadBlockedError,
  createSecretReadGuardHook,
  isSecretBasename,
  isSecretGlob,
  isSecretPathValue,
  mentionsSecretFile,
} from './secret-read-guard';

describe('秘密 basename / 路径 / glob 判定', () => {
  test('isSecretBasename 覆盖 .env 家族与 .secrets，大小写不敏感', () => {
    for (const name of ['.env', '.env.local', '.env.production', '.ENV', '.Env.Vars', '.secrets', '.SECRETS']) {
      expect(isSecretBasename(name)).toBe(true);
    }
    for (const name of ['env', 'foo.env.md', '.environment', '.secrets-dir', '.envrc', 'readme']) {
      expect(isSecretBasename(name)).toBe(false);
    }
  });

  test('isSecretPathValue 按路径段判定，支持绝对/相对与反斜杠', () => {
    expect(isSecretPathValue('.env')).toBe(true);
    expect(isSecretPathValue('./config/.env.local')).toBe(true);
    expect(isSecretPathValue('/home/user/proj/.env')).toBe(true);
    expect(isSecretPathValue('C:\\proj\\.env.production')).toBe(true);
    expect(isSecretPathValue('src/config.ts')).toBe(false);
    expect(isSecretPathValue('docs/env-setup.md')).toBe(false);
    expect(isSecretPathValue(undefined)).toBe(false);
    expect(isSecretPathValue('')).toBe(false);
  });

  test('isSecretGlob 命中秘密命名空间，不误伤普通 glob', () => {
    expect(isSecretGlob('*.env')).toBe(true);
    expect(isSecretGlob('.env*')).toBe(true);
    expect(isSecretGlob('**/.env.local')).toBe(true);
    expect(isSecretGlob('*.env*')).toBe(true);
    expect(isSecretGlob('*.secrets')).toBe(true);
    expect(isSecretGlob('*.ts')).toBe(false);
    expect(isSecretGlob('src/**')).toBe(false);
    expect(isSecretGlob('*')).toBe(false);
    expect(isSecretGlob(undefined)).toBe(false);
  });

  test('mentionsSecretFile 覆盖直接/命令替换/source 形态，不误伤普通词', () => {
    expect(mentionsSecretFile('cat .env')).toBe(true);
    expect(mentionsSecretFile('cat ./config/.env.local | grep KEY')).toBe(true);
    expect(mentionsSecretFile('export $(cat .env)')).toBe(true);
    expect(mentionsSecretFile('source .env.production')).toBe(true);
    expect(mentionsSecretFile('git show HEAD:.env')).toBe(true);
    expect(mentionsSecretFile('jq . secrets.json')).toBe(false);
    expect(mentionsSecretFile('cat .environment')).toBe(false);
    expect(mentionsSecretFile('ls -la src/')).toBe(false);
    expect(mentionsSecretFile('cat package.json')).toBe(false);
    expect(mentionsSecretFile(undefined)).toBe(false);
  });
});

describe('createSecretReadGuardHook：execute.before 行为', () => {
  const hook = createSecretReadGuardHook();

  test('read 命中秘密路径：抛 SecretReadBlockedError 且消息含处置指引', async () => {
    let err: unknown;
    try {
      await hook['tool.execute.before']({ tool: 'read', input: { path: '.env' } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SecretReadBlockedError);
    expect((err as SecretReadBlockedError).tool).toBe('read');
    expect((err as Error).message).toContain('disabled_hooks');
    expect((err as Error).message).toContain('.env');
  });

  test('read 的 file_path 别名同样受保护', async () => {
    await expect(
      hook['tool.execute.before']({ tool: 'read', input: { file_path: 'conf/.env.local' } }),
    ).rejects.toBeInstanceOf(SecretReadBlockedError);
  });

  test('grep include 命中 *.env 被阻断；普通 include 放行', async () => {
    await expect(
      hook['tool.execute.before']({ tool: 'grep', input: { pattern: 'KEY', include: '*.env' } }),
    ).rejects.toBeInstanceOf(SecretReadBlockedError);
    await expect(
      hook['tool.execute.before']({ tool: 'grep', input: { pattern: 'KEY', include: '*.ts' } }),
    ).resolves.toBeUndefined();
  });

  test('bash 命令引用秘密文件被阻断；shell 工具名同样受管', async () => {
    await expect(
      hook['tool.execute.before']({ tool: 'bash', input: { command: 'cat .env' } }),
    ).rejects.toBeInstanceOf(SecretReadBlockedError);
    await expect(
      hook['tool.execute.before']({ tool: 'shell', input: { command: 'source .env.local' } }),
    ).rejects.toBeInstanceOf(SecretReadBlockedError);
    await expect(
      hook['tool.execute.before']({ tool: 'bash', input: { command: 'bun test' } }),
    ).resolves.toBeUndefined();
  });

  test('非受管工具、非对象入参、缺失工具名：fail-open 放行', async () => {
    await expect(
      hook['tool.execute.before']({ tool: 'glob', input: { pattern: '**/.env' } }),
    ).resolves.toBeUndefined();
    await expect(
      hook['tool.execute.before']({ tool: 'read', input: null }),
    ).resolves.toBeUndefined();
    await expect(
      hook['tool.execute.before']({ tool: 'read' } as never),
    ).resolves.toBeUndefined();
  });

  test('onStatus 观测：blocked 与 allowed 各自上报', async () => {
    const seen: string[] = [];
    const obs = createSecretReadGuardHook({
      onStatus: (status, data) => seen.push(`${status}:${String(data?.tool)}`),
    });
    await obs['tool.execute.before']({ tool: 'read', input: { path: 'src/a.ts' } });
    await expect(
      obs['tool.execute.before']({ tool: 'grep', input: { include: '.env*' } }),
    ).rejects.toBeInstanceOf(SecretReadBlockedError);
    expect(seen).toEqual(['allowed:read', 'blocked:grep']);
  });

  test('SECRET_READ_TOOLS 清单稳定（read/grep/bash/shell）', () => {
    expect(Object.keys(SECRET_READ_TOOLS).sort()).toEqual(['bash', 'grep', 'read', 'shell']);
  });
});
