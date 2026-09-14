import { describe, expect, test } from 'bun:test';
import {
  READONLY_DEFAULT_PERMISSION,
  READONLY_SHELL_PERMISSION,
} from './constants';

/**
 * shell 权限护栏的语义级回归（Windows 兼容修复）。
 *
 * 背景：宿主 shell 工具的权限键——OpenCode 2.0（beta-19507+）为 'shell'，
 * beta 宿主为 'bash'（插件双写覆盖两代宿主）。命令 pattern 由 tree-sitter +
 * BashArity 前缀生成，评估走 `Wildcard.match(pattern, rule.pattern)` 且
 * findLast 后声明优先。2.0.3 宿主源码（@opencode/core）核实：evaluate 语义
 * `rulesets.flat().findLast(match(action) && match(resource)) ?? {effect:'ask'}`
 * 与 wildcard match（win32 大小写不敏感）同 beta 一致，复刻仍准确。
 * 本文件复刻宿主 wildcard.ts 与 evaluate 语义做表驱动断言：
 * - 复刻函数与宿主实现存在漂移风险，宿主升级时需同步（见注释引用）；
 * - pattern 样本按宿主 BashArity 语义构造：cmdlet/cmd/未知名取首 token，
 *   已知 arity 命令取前缀 token（git→2、npm→2、bun→2），重定向场景
 *   pattern 为含重定向的完整命令文本（source 取 redirected_statement）。
 */

/** 复刻宿主 @opencode-ai/core/util/wildcard 的 match（保持语义一致）。 */
function matchLikeHost(input: string, pattern: string, win32: boolean): boolean {
  const normalized = input.replaceAll('\\', '/');
  let escaped = pattern
    .replaceAll('\\', '/')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  if (escaped.endsWith(' .*')) escaped = escaped.slice(0, -3) + '( .*)?';
  return new RegExp('^' + escaped + '$', win32 ? 'si' : 's').test(normalized);
}

/** 复刻宿主 evaluate：findLast 命中的规则生效，未命中回落 allow 基线。 */
function evaluatePermission(
  commandPattern: string,
  win32: boolean,
): 'allow' | 'deny' {
  const entries = Object.entries(READONLY_SHELL_PERMISSION);
  const hit = entries.findLast(([key]) => matchLikeHost(commandPattern, key, win32));
  return (hit?.[1] ?? 'allow') as 'allow' | 'deny';
}

describe('READONLY_SHELL_PERMISSION 结构契约', () => {
  test("'*': 'allow' 必须是首键——所有 deny 位于其后（findLast 后声明优先）", () => {
    const keys = Object.keys(READONLY_SHELL_PERMISSION);
    expect(keys[0]).toBe('*');
    expect(READONLY_SHELL_PERMISSION['*']).toBe('allow');
    for (const [index, key] of keys.entries()) {
      if (index === 0) continue;
      expect(READONLY_SHELL_PERMISSION[key]).toBe('deny');
    }
  });

  test('默认权限表挂 shell 主键（OpenCode 2.0 action 名）并保留 bash 兼容双写', () => {
    expect(READONLY_DEFAULT_PERMISSION.shell).toBe(READONLY_SHELL_PERMISSION);
    expect(READONLY_DEFAULT_PERMISSION.bash).toBe(READONLY_SHELL_PERMISSION);
  });
});

describe('只读 shell 护栏：POSIX 动词（win32=false）', () => {
  const cases: Array<[string, 'allow' | 'deny']> = [
    ['rm -rf dist', 'deny'],
    ['mv a.txt b.txt', 'deny'],
    ['cp a.txt b.txt', 'deny'],
    ['mkdir out', 'deny'],
    ['tee out.txt', 'deny'],
    ['sudo tee out.txt', 'deny'],
    ['sed -i s/a/b/ f.txt', 'deny'],
    ['git add .', 'deny'],
    ['git commit -m x', 'deny'],
    ['git push origin main', 'deny'],
    ['npm install lodash', 'deny'],
    ['npm update', 'deny'],
    ['bun install', 'deny'],
    ['echo hi > file.txt', 'deny'],
    ['echo hi >> file.txt', 'deny'],
    // 只读诊断放行
    ['git status', 'allow'],
    ['git diff --stat', 'allow'],
    ['ls -la', 'allow'],
    ['node --version', 'allow'],
    ['bun test', 'allow'],
    ['bun run typecheck', 'allow'],
  ];
  test.each(cases)('%s → %s', (pattern, expected) => {
    expect(evaluatePermission(pattern, false)).toBe(expected);
  });
});

describe('只读 shell 护栏：cmd.exe 动词', () => {
  const cases: Array<[string, 'allow' | 'deny']> = [
    ['del foo.txt', 'deny'],
    ['del /q foo.txt', 'deny'],
    ['erase foo.txt', 'deny'],
    ['rd temp', 'deny'],
    ['ren a.txt b.txt', 'deny'],
    ['rename a.txt b.txt', 'deny'],
    ['move a.txt b.txt', 'deny'],
    ['copy a.txt b.txt', 'deny'],
    ['md out', 'deny'],
    // 读取类放行
    ['type readme.txt', 'allow'],
    ['dir', 'allow'],
    ['where cmd', 'allow'],
  ];
  test.each(cases)('%s → %s', (pattern, expected) => {
    // cmd 命令通常小写；win32 与非 win32 均应一致
    expect(evaluatePermission(pattern, true)).toBe(expected);
    expect(evaluatePermission(pattern, false)).toBe(expected);
  });
});

describe('只读 shell 护栏：PowerShell cmdlet（PascalCase 与小写双写）', () => {
  const pascalCases: Array<[string, 'allow' | 'deny']> = [
    ['Remove-Item -Recurse foo', 'deny'],
    ['Copy-Item a.txt b.txt', 'deny'],
    ['Move-Item a.txt b.txt', 'deny'],
    ['New-Item -ItemType Directory -Path out', 'deny'],
    ['Rename-Item a.txt b.txt', 'deny'],
    ['Set-Content file.txt hi', 'deny'],
    ['Add-Content file.txt hi', 'deny'],
    ['Clear-Content file.txt', 'deny'],
    ['Set-Item -Path x -Value y', 'deny'],
    ['Out-File file.txt', 'deny'],
    ['Tee-Object -FilePath out.txt', 'deny'],
    ['Compress-Archive -Path dist -DestinationPath dist.zip', 'deny'],
    ['Expand-Archive dist.zip -DestinationPath out', 'deny'],
    ['Start-Process notepad', 'deny'],
    // 管道右侧命令节点单独评估（宿主按 command 节点生成 pattern，不含 |）
    ['Out-File file.txt', 'deny'],
    // 只读 cmdlet 放行
    ['Get-Content package.json', 'allow'],
    ['Get-ChildItem', 'allow'],
    ['Select-String TODO', 'allow'],
    ['Test-Path -LiteralPath foo', 'allow'],
    ['Get-Item package.json', 'allow'],
  ];
  test.each(pascalCases)('PascalCase（非 win32 大小写敏感）：%s → %s', (pattern, expected) => {
    expect(evaluatePermission(pattern, false)).toBe(expected);
  });

  const lowerCases: Array<[string, 'allow' | 'deny']> = [
    ['remove-item foo', 'deny'],
    ['copy-item a b', 'deny'],
    ['move-item a b', 'deny'],
    ['new-item out', 'deny'],
    ['set-content f x', 'deny'],
    ['out-file f', 'deny'],
    ['tee-object f', 'deny'],
    ['start-process notepad', 'deny'],
    ['get-content package.json', 'allow'],
    ['select-string TODO', 'allow'],
  ];
  test.each(lowerCases)('小写（win32 与非 win32 双覆盖）：%s → %s', (pattern, expected) => {
    expect(evaluatePermission(pattern, true)).toBe(expected);
    expect(evaluatePermission(pattern, false)).toBe(expected);
  });
});

describe('只读 shell 护栏：PowerShell 重定向变体', () => {
  const cases: Array<[string]> = [
    ['Write-Output hi > file.txt'],
    ['Write-Output hi >file.txt'],
    ['Write-Output hi >> file.txt'],
    ['Write-Output hi *> file.txt'],
    ['Write-Output hi *>>file.txt'],
  ];
  test.each(cases)('%s → deny', (pattern) => {
    expect(evaluatePermission(pattern, true)).toBe('deny');
    expect(evaluatePermission(pattern, false)).toBe('deny');
  });
});
