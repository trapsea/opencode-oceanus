/**
 * ast-grep CLI 可用性的稳健探测（tooling-11-regression smoke 用）。
 *
 * 为什么需要独立的 `--version` 验证：
 * - `findSgCliPathSync()` 会在 PATH 上寻找 `ast-grep` / `sg`，并把满足体积下限的
 *   候选当作可用二进制。某些 Linux 环境里 PATH 上的 `sg` 是 GNU `newgrp` 的别名
 *   （如 Debian/Ubuntu 的 `/usr/bin/sg -> newgrp`），会被 `findSgCliPathSync()`
 *   误判为 ast-grep，造成“环境缺少 ast-grep 却误报可用”的问题。
 * - 因此本探测在拿到候选后，再独立执行一次 `candidate --version`，并断言输出含
 *   `ast-grep`。只有通过该验证才视为真正可用。
 *
 * 约束：本模块只用于测试侧的 skip/diagnostic 判定，**不修改**核心检测逻辑
 * （`findSgCliPathSync` / `runSg` 保持原样）。当环境缺少真正可用的 ast-grep 时，
 * 测试必须明确跳过并给出诊断，而不是把环境缺失误报为产品失败。
 */
import { spawnSync } from 'node:child_process';
import { findSgCliPathSync } from '../tools/ast-grep/constants';

export interface AstGrepProbeResult {
  /** 是否确认有真正可用的 ast-grep 二进制。 */
  available: boolean;
  /** 候选二进制路径（即使不可用也可能非空，含误报候选）。 */
  path: string | null;
  /** 解析出的版本号（若有）。 */
  version?: string;
  /** 人类可读诊断，供测试日志输出。 */
  diagnostic: string;
}

/**
 * 稳健探测 ast-grep 可用性。默认给候选二进制 3s 的 `--version` 超时，避免挂起。
 */
export function probeAstGrep(timeoutMs = 3000): AstGrepProbeResult {
  let candidate: string | null;
  try {
    candidate = findSgCliPathSync();
  } catch (e) {
    return {
      available: false,
      path: null,
      diagnostic: `findSgCliPathSync 抛错: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!candidate) {
    return {
      available: false,
      path: null,
      diagnostic:
        'ast-grep binary not found（已搜索 AST_GREP_BIN、缓存目录、@ast-grep/cli 包、平台专属包、PATH）。' +
        '安装方式：bun add -D @ast-grep/cli 或 cargo install ast-grep，或设置 AST_GREP_BIN。',
    };
  }

  // 独立验证：运行 `candidate --version`，输出必须包含 "ast-grep"。
  let stdout = '';
  let stderr = '';
  let exitedCleanly = true;
  try {
    const res = spawnSync(candidate, ['--version'], {
      encoding: 'utf8',
      timeout: timeoutMs,
    });
    stdout = (res.stdout ?? '') as string;
    stderr = (res.stderr ?? '') as string;
  } catch (e) {
    exitedCleanly = false;
    stderr = e instanceof Error ? e.message : String(e);
  }

  const versionText = `${stdout}\n${stderr}`.trim();
  if (/ast-grep/i.test(versionText)) {
    const versionMatch = versionText.match(/\d+\.\d+\.\d+/);
    return {
      available: true,
      path: candidate,
      version: versionMatch ? versionMatch[0] : undefined,
      diagnostic: `ast-grep CLI 可用: ${candidate}${versionMatch ? ` v${versionMatch[0]}` : ''}`,
    };
  }

  return {
    available: false,
    path: candidate,
    diagnostic:
      `候选二进制 ${candidate} 未通过 ast-grep 验证（误报候选，可能是其它名为 sg 的程序，` +
      `如 GNU newgrp）。--version 输出: ${exitedCleanly ? (versionText || '(空)') : `无法运行: ${stderr}`}`,
  };
}
