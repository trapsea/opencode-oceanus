import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { resolveOpenCodeInstallContext } from './cache';

/** 清理结果：removed 为已删除的时间戳目录名，skipped 为候选但保留的（含原因）。 */
export interface CleanupResult {
  /** 终止原因（无安装上下文 / 布局未知）；正常执行完成时缺省。 */
  reason?: 'no-context' | 'layout-unknown';
  removed: string[];
  skipped: string[];
}

export interface CleanupDeps {
  /** 当前插件模块路径（默认 import.meta.url）；决定活跃目录判定基准。 */
  modulePath?: string;
  /** 目录删除实现，默认 rmSync(recursive, force)；测试可注入。 */
  rm?: (path: string) => void;
  /** 日志回调；默认无操作。 */
  log?: (event: Record<string, unknown>) => void;
}

/** OpenCode 宿主的时间戳缓存目录名（epoch 秒~毫秒量级，数值 < 2^53 比较安全）。 */
function isTimestampDir(name: string): boolean {
  return /^\d{10,16}$/.test(name);
}

/** 校验目标目录确实是 opencode-oceanus 的安装布局，防止误删未知结构。 */
function looksLikeOceanusInstall(dir: string): boolean {
  try {
    const pkg = JSON.parse(
      readFileSync(join(dir, 'node_modules', 'opencode-oceanus', 'package.json'), 'utf8'),
    );
    return pkg?.name === 'opencode-oceanus';
  } catch {
    return false;
  }
}

/**
 * 幂等清扫历史版本目录（fail-open，绝不抛错）。
 *
 * 背景事实：宿主路径更新（POST /api/plugin/update）会写入新时间戳缓存目录并
 * 保留旧目录，宿主自身无任何清理机制，长期累积每版本约 110MB。
 *
 * 防护链（全部通过才删除，任何一环失败只跳过该目录）：
 * 1. 仅在当前进程所在的 identity 目录（如 opencode-oceanus@latest/）内扫描，
 *    绝不触碰其他 identity（pinned 入口可能正被其他配置使用）与其他插件；
 * 2. 活跃目录名本身必须是纯数字时间戳，否则视为宿主布局变化，整体放弃；
 * 3. 目标必须是纯数字时间戳目录且数值上更旧（并发保护：比当前活跃更新的
 *    目录——例如另一实例刚被宿主更新——一律保留）；
 * 4. 目标内 node_modules/opencode-oceanus/package.json 的 name 必须校验通过。
 */
export function cleanupStaleVersions(deps: CleanupDeps = {}): CleanupResult {
  const result: CleanupResult = { removed: [], skipped: [] };
  const rm = deps.rm ?? ((p: string) => rmSync(p, { recursive: true, force: true }));
  try {
    const context = resolveOpenCodeInstallContext(deps.modulePath);
    if (!context) {
      result.reason = 'no-context';
      return result;
    }
    const active = basename(context.installRoot);
    if (!isTimestampDir(active)) {
      result.reason = 'layout-unknown';
      return result;
    }
    const identityDir = dirname(context.installRoot);
    let entries: string[];
    try {
      entries = readdirSync(identityDir);
    } catch {
      return result;
    }
    const activeTs = Number(active);
    for (const entry of entries) {
      // 非时间戳目录（staging-*、lock 等）不属于清理对象，静默忽略。
      if (entry === active || !isTimestampDir(entry)) continue;
      if (Number(entry) >= activeTs) {
        result.skipped.push(entry);
        continue;
      }
      const target = join(identityDir, entry);
      if (!looksLikeOceanusInstall(target)) {
        result.skipped.push(entry);
        continue;
      }
      try {
        rm(target);
        result.removed.push(entry);
      } catch (error) {
        result.skipped.push(entry);
        deps.log?.({
          event: 'auto_update_cleanup',
          error: error instanceof Error ? error.message : String(error),
          dir: entry,
        });
      }
    }
    if (result.removed.length > 0 || result.skipped.length > 0) {
      deps.log?.({
        event: 'auto_update_cleanup',
        removed: result.removed.length,
        skipped: result.skipped.length,
      });
    }
  } catch (error) {
    deps.log?.({
      event: 'auto_update_cleanup',
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return result;
}
