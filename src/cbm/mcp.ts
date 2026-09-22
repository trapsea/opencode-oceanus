import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginConfig } from '../config/schema';
import {
  getCodebaseMemoryConfig,
  isCodebaseMemoryAutoDownloadEnabled,
  type CodebaseMemoryResolvedConfig,
} from '../config/utils';
import type { MCPDomainLike, MCPServerConfigLike, MCPLocalConfigLike } from '../runtime/types';
import { getPlatformKey, resolveCbmPlatform } from './constants';
import { getCacheRoot } from './paths';
import { ensureInstalled, type ProvisionOptions } from './provision';

/**
 * codebase-memory-mcp（CBM）的本地 MCP server 注册器（CBM-08）。
 *
 * 通过 `ctx.mcp.transform` 注入名称固定为 `codebase-memory-mcp` 的 local server：
 * - `command` 为参数数组（真实 `McpDraft` 形状），绝不启用 shell；
 * - 注入环境变量白名单（含 `CBM_CACHE_DIR` 与 Oceanus 管理 marker），不继承
 *   provider token；
 * - 二进制尚不可用且允许自动下载时，先注入 `disabled: true` 占位配置，安装成功
 *   后更新 command/environment 并置 `disabled: false`，`reload()` 最多一次；
 * - 安装失败保留占位（disabled），fail-open，不影响 CLI 兜底；
 * - 同名未知配置绝不覆盖（只操作带管理 marker 的 server）；
 * - `mcp=false` 时只移除由 Oceanus 管理的 server，保留 CLI 兜底。
 */
export interface McpRegistrationResult {
  server: string;
  /** 当前 draft 中存在由 Oceanus 管理的 server 配置。 */
  registered: boolean;
  /** server 当前是否为 disabled（占位/未安装）。 */
  disabled: boolean;
  /** 存在同名未知配置，Oceanus 已跳过（不覆盖）。 */
  skippedUnknown: boolean;
  /** 是否已执行过一次 `ctx.mcp.reload()`。 */
  reloaded: boolean;
  /** 安装是否成功完成（二进制就绪）。 */
  installed: boolean;
  /** 是否对 draft 做出了变更（set 或 remove）。 */
  mutated: boolean;
  /**
   * 目标配置与 draft 中现有 managed 配置语义一致，因此跳过 set 与 reload。
   * 宿主会反复重放插件 transform（plugin reconciliation），跳过无变化写入可
   * 避免无谓关闭/重建 stdio MCP 连接（重建窗口内的工具调用会报 Connection closed）。
   */
  unchanged: boolean;
}

export interface McpRegisterOptions extends ProvisionOptions {
  logger?: (message: string, meta?: Record<string, unknown>) => void;
  /** 共享安装实现；由 wiring 注入以复用同一 Promise。 */
  ensureInstalled?: (options?: ProvisionOptions) => Promise<string | null>;
  /** 已有二进制的可注入健康检查；未通过时视为不可用。 */
  healthCheck?: (binary: string) => Promise<boolean>;
  /**
   * 安装完成、启用 server 前的 daemon 就绪钩子（fail-open）：宿主 reload 后
   * 将 spawn stdio MCP server，先确保 permanent daemon 可接受新客户端，避免
   * 首个连接落在 daemon 冷启动窗口。缺省 no-op。
   */
  ensureDaemonReady?: (binary: string, cacheRoot: string) => Promise<unknown>;
}

/** 注入的 MCP server 固定名称。 */
export const MCP_SERVER_NAME = 'codebase-memory-mcp';

/** 环境变量白名单：子进程只继承这些项 + CBM_CACHE_DIR + 管理 marker。 */
export const MCP_ENV_WHITELIST: readonly string[] = [
  'CBM_CACHE_DIR',
  'RUST_LOG',
  'RUST_BACKTRACE',
  'NO_COLOR',
  'CLICOLOR',
  'TERM',
  'HOME',
  'USER',
  'USERNAME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'XDG_CACHE_HOME',
  'LOCALAPPDATA',
  'APPDATA',
  'PATH',
  'OCEANUS_CBM_MANAGED',
];

/** 管理 marker 环境变量名：用于识别由 Oceanus 托管的 server，避免误删用户配置。 */
export const CBM_MANAGED_MARKER_ENV = 'OCEANUS_CBM_MANAGED';
export const CBM_MANAGED_MARKER_VALUE = '1';

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 判断一个 MCP server 配置是否由 Oceanus 托管。 */
export function isCbmManaged(config?: MCPServerConfigLike | undefined): boolean {
  return Boolean(
    config &&
      config.type === 'local' &&
      config.environment?.[CBM_MANAGED_MARKER_ENV] === CBM_MANAGED_MARKER_VALUE,
  );
}

/** 从白名单构建子进程环境（含 CBM_CACHE_DIR 与管理 marker）。 */
export function buildMcpEnvironment(cacheDir: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of MCP_ENV_WHITELIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.CBM_CACHE_DIR = cacheDir;
  env[CBM_MANAGED_MARKER_ENV] = CBM_MANAGED_MARKER_VALUE;
  return env;
}

/**
 * 解析预期二进制路径：显式 binaryPath 优先；否则按缓存布局
 * `<cache>/versions/<version>/<platform>/<binaryName>` 推导。
 */
export function resolveExpectedBinaryPath(
  cfg: CodebaseMemoryResolvedConfig,
  cacheDir: string,
): string {
  if (cfg.binaryPath) return cfg.binaryPath;
  const platform = resolveCbmPlatform();
  const platformKey = getPlatformKey(platform);
  return join(cacheDir, 'versions', cfg.version, platformKey, platform.binaryName);
}

/**
 * 构造本地 MCP server 配置（真实 `McpDraft` 形状，command 为数组）。
 *
 * `codemode: false`：direct MCP 工具（search_graph/trace_path/...）进入会话
 * 直接工具目录，全部 agent 可按名称直接调用（2026-09 用户决策，修复
 * 「提示词要求 direct 优先但 Code Mode 调用摩擦导致实际全走 cbm_* wrapper」）。
 * 写入型 MCP 工具（delete_project 等）由 createDirectMcpWriteGuard 运行时拦截。
 */
export function buildLocalConfig(
  cfg: CodebaseMemoryResolvedConfig,
  binary: string,
  disabled: boolean,
  cacheDir: string,
): MCPLocalConfigLike {
  return {
    type: 'local',
    command: [binary],
    environment: buildMcpEnvironment(cacheDir),
    disabled,
    codemode: false,
  };
}

/**
 * 判断现有 managed 本地配置与目标配置是否语义一致。
 *
 * 用途（根因回归）：宿主会反复重放插件 transform（plugin reconciliation）。
 * 若每次把内容相同的配置写回 draft 并触发 `ctx.mcp.reload()`，宿主会关闭并
 * 重建该 instance 的 stdio MCP 连接；落在重建窗口内的 CBM 工具调用即报
 * `Connection closed`。配置未变时跳过写入即可消除这一我方放大项
 * （fail-open 语义不变，仅减少无谓重建）。
 */
export function isSameManagedLocalConfig(
  existing: MCPServerConfigLike | undefined,
  target: MCPLocalConfigLike,
): boolean {
  if (!existing || existing.type !== 'local' || !isCbmManaged(existing)) return false;
  if (existing.disabled !== target.disabled) return false;
  if (existing.codemode !== target.codemode) return false;
  if (existing.command.length !== target.command.length) return false;
  if (existing.command.some((part, i) => part !== target.command[i])) return false;
  const a = existing.environment ?? {};
  const b = target.environment ?? {};
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

/**
 * 注册（或按需移除）Oceanus 托管的 codebase-memory-mcp 本地 server。
 * transform / reload / 安装失败一律 fail-open，绝不抛异常。
 */
export async function registerCbmMcp(
  ctx: { mcp: MCPDomainLike },
  config: PluginConfig | undefined,
  opts: McpRegisterOptions = {},
): Promise<McpRegistrationResult> {
  const cfg = getCodebaseMemoryConfig(config);
  const log = opts.logger ?? (() => {});
  const res: McpRegistrationResult = {
    server: MCP_SERVER_NAME,
    registered: false,
    disabled: false,
    skippedUnknown: false,
    reloaded: false,
    installed: false,
    mutated: false,
    unchanged: false,
  };

  const cacheDir = cfg.cacheDir ?? opts.cacheRoot ?? process.env.CBM_CACHE_DIR ?? getCacheRoot();
  const expected = resolveExpectedBinaryPath(cfg, cacheDir);
  const hasBinary = existsSync(expected) &&
    (opts.healthCheck ? await opts.healthCheck(expected).catch(() => false) : true);
  const canAuto = isCodebaseMemoryAutoDownloadEnabled(config);

  let installPromise: Promise<string | null> | null = null;

  await ctx.mcp.transform((draft) => {
    const existing = draft.get(MCP_SERVER_NAME);
    if (existing && !isCbmManaged(existing)) {
      // 同名未知配置：绝不覆盖、绝不删除。
      res.skippedUnknown = true;
      return;
    }
    if (!cfg.enabled || !cfg.mcp) {
      // MCP 关闭：只移除 Oceanus 托管的 server，保留 CLI 兜底与用户配置。
      if (existing && isCbmManaged(existing)) {
        draft.remove(MCP_SERVER_NAME);
        res.mutated = true;
      }
      return;
    }
    if (hasBinary) {
      const target = buildLocalConfig(cfg, expected, false, cacheDir);
      res.registered = true;
      if (isSameManagedLocalConfig(existing, target)) {
        // 配置未变：不写 draft、不触发 reload，避免无谓重建 stdio 连接。
        res.unchanged = true;
        return;
      }
      draft.set(MCP_SERVER_NAME, target);
      res.mutated = true;
      return;
    }
    if (canAuto) {
      // 占位：disabled 配置，避免 MCP catalog 长时间缺失。
      const target = buildLocalConfig(cfg, expected, true, cacheDir);
      res.registered = true;
      res.disabled = true;
      if (isSameManagedLocalConfig(existing, target)) {
        res.unchanged = true;
      } else {
        draft.set(MCP_SERVER_NAME, target);
        res.mutated = true;
      }
      installPromise = (opts.ensureInstalled ?? ensureInstalled)({
        ...opts,
        cacheRoot: cacheDir,
        version: cfg.version,
      });
    }
    // 无二进制且不自动下载：跳过（fail-open）。
  });

  if (installPromise) {
    let bin: string | null = null;
    try {
      bin = await installPromise;
    } catch (e) {
      log(`[oceanus] CBM install failed: ${messageOf(e)}`);
    }
    if (bin) {
      // 首次安装完成：宿主 reload 后将 spawn stdio MCP server。先确保
      // permanent daemon 就绪（前台等待，fail-open），使首个连接
      // connect-to-warm，避免落在 daemon 冷启动窗口内失败。
      if (opts.ensureDaemonReady) {
        await opts.ensureDaemonReady(bin, cacheDir).catch(() => {});
      }
      let updated = false;
      await ctx.mcp.transform((draft) => {
        const existing = draft.get(MCP_SERVER_NAME);
        if (existing && isCbmManaged(existing)) {
          const target = buildLocalConfig(cfg, bin, false, cacheDir);
          if (isSameManagedLocalConfig(existing, target)) {
            // 安装完成后目标配置与现状一致：无需再次 set/reload。
            res.unchanged = true;
            return;
          }
          draft.set(MCP_SERVER_NAME, target);
          updated = true;
        }
      });
      if (updated) {
        res.registered = true;
        res.disabled = false;
        res.installed = true;
        res.mutated = true;
        // 占位路径可能已置 unchanged=true；此处发生了真实写入与 reload，
        // 必须复位，避免日志同时出现 unchanged 与 mutated/reloaded 的自相矛盾。
        res.unchanged = false;
      }
    }
    // 安装失败：保留 disabled 占位，fail-open。
  }

  if (res.mutated) {
    try {
      await ctx.mcp.reload();
      res.reloaded = true;
    } catch (e) {
      log(`[oceanus] CBM mcp reload failed: ${messageOf(e)}`);
    }
  } else if (res.registered) {
    // 配置未变：明确记录「跳过 reload」，便于把真实连接失败与「无变化未重连」
    // 区分开（宿主 reconciliation 会反复重放 transform）。
    log('[oceanus] CBM mcp 配置未变，跳过 reload', {
      server: MCP_SERVER_NAME,
      unchanged: true,
      disabled: res.disabled,
    });
  }
  return res;
}

/**
 * cleanup：仅移除由 Oceanus 托管的 codebase-memory-mcp server，
 * 不删除用户自有配置。返回是否发生移除。
 */
export async function removeCbmMcp(
  ctx: { mcp: MCPDomainLike },
  opts: Pick<McpRegisterOptions, 'logger'> = {},
): Promise<boolean> {
  const log = opts.logger ?? (() => {});
  let removed = false;
  await ctx.mcp.transform((draft) => {
    const existing = draft.get(MCP_SERVER_NAME);
    if (existing && isCbmManaged(existing)) {
      draft.remove(MCP_SERVER_NAME);
      removed = true;
    }
  });
  if (removed) {
    try {
      await ctx.mcp.reload();
    } catch (e) {
      log(`[oceanus] CBM mcp cleanup reload failed: ${messageOf(e)}`);
    }
  }
  return removed;
}
