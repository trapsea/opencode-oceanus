import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandDefinition, CommandInvocation } from '../commands/types';
import type { IndexerHandle, IndexerOutcome } from './indexer';
import type { McpRegisterOptions, McpRegistrationResult } from './mcp';
import { getCacheRoot } from './paths';
import type { ProvisionOptions } from './provision';
import type { UiOptions, UiStatus } from './ui';

/**
 * /cbm 命令族（CBM-10）。
 *
 * 通过 `createCbmCommand(handlers)` 构造一个名为 `cbm` 的 command，解析子命令：
 * - （空）/ status   —— 报告安装与 UI 状态（只读，不触发安装）；
 * - install          —— 后台启动安装，**非阻塞**，安装成功后 fire-and-forget 刷新 MCP；
 * - repair           —— 等待修复完成并回写结果，成功后同步刷新 MCP；
 * - index            —— 触发索引器 ensureIndexed；
 * - ui               —— 启动 UI 并回写 URL；
 * - ui stop          —— 停止由本插件持有的 UI；
 * - uninstall        —— 只移除 Oceanus 管理的资源（stopUi + removeMcp），
 *                        绝不删除源码或用户索引。
 *
 * 依赖全部通过 handlers 注入（provision / MCP / indexer / UI / status / reply），
 * 保持 preset command 的依赖注入与 reply 语义一致，不直接持有插件 ctx。
 * 所有子命令 fail-open：handler 抛错或依赖缺失时仅回写失败消息，绝不向
 * `execute` 抛异常。
 */

/** 归一化的安装状态（status 只读用，不触发安装）。 */
export interface CbmInstallStatus {
  installed: boolean;
  binaryPath?: string;
  version?: string;
  platform?: string;
}

/**
 * /cbm 命令所需的外部依赖集合。
 *
 * 各能力为可选（缺失时对应子命令 fail-open 回写）；`reply` 必填。
 */
export interface CbmCommandHandlers {
  /**
   * 读取当前安装状态（来自 current manifest / 二进制存在性），**不触发安装**。
   * 缺省实现读取缓存根目录的 current.json。
   */
  getInstallStatus?: (cacheRoot: string) => CbmInstallStatus;
  /**
   * 后台启动安装（非阻塞）。实现方应返回共享的安装 Promise，`execute` 不等待其
   * 完成即回写。前台阻塞变体 {@link ensureInstalled} 保留给调用方按需使用。
   */
  startBackgroundInstall?: (opts?: ProvisionOptions) => Promise<string | null>;
  /** provision 前台阻塞变体（安装完成后返回二进制路径，失败返回 null）。 */
  ensureInstalled?: (opts?: ProvisionOptions) => Promise<string | null>;
  /** 强制修复并重新安装（等待完成），成功返回二进制路径，失败返回 null。 */
  repair?: (opts?: ProvisionOptions) => Promise<string | null>;
  /** MCP 注册/更新（安装或修复成功后调用，fail-open）。 */
  registerMcp?: (opts?: McpRegisterOptions) => Promise<McpRegistrationResult>;
  /** MCP 移除（仅移除 Oceanus 管理 server，保留用户配置）。 */
  removeMcp?: () => Promise<boolean>;
  /** 索引器（/cbm index）。 */
  indexer?: IndexerHandle;
  /** UI 启动。 */
  startUi?: (opts?: UiOptions) => Promise<UiStatus>;
  /** UI 停止（只停本插件持有的进程）。 */
  stopUi?: (opts?: UiOptions) => UiStatus;
  /** UI 状态。 */
  getUiStatus?: (opts?: UiOptions) => UiStatus;
  /** 缓存根目录（缺省 getCacheRoot()）。 */
  getCacheRoot?: () => string;
  /** 工作区根目录（/cbm index 用，缺省 process.cwd()）。 */
  getWorkspaceRoot?: () => string;
  /** 向当前 session 回写文本反馈（只透传 sessionID / text / delivery）。 */
  reply: (text: string, invocation: CommandInvocation) => Promise<void>;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/* ------------------------------------------------------------------ */
/* 缺省实现                                                            */
/* ------------------------------------------------------------------ */

/** 从缓存根目录读取 current.json 推导安装状态（只读，失败视为未安装）。 */
export function defaultInstallStatus(cacheRoot: string): CbmInstallStatus {
  try {
    const p = join(cacheRoot, 'current.json');
    if (!existsSync(p)) return { installed: false };
    const data = JSON.parse(readFileSync(p, 'utf8')) as {
      version?: string;
      platform?: string;
      binaryPath?: string;
    };
    if (!data.version || !data.platform) return { installed: false };
    const isWin =
      data.platform.startsWith('win32') || process.platform === 'win32';
    const binaryName =
      data.binaryPath ?? (isWin ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp');
    const bin = join(
      cacheRoot,
      'versions',
      data.version,
      data.platform,
      binaryName,
    );
    if (!existsSync(bin)) {
      return { installed: false, version: data.version, platform: data.platform };
    }
    return {
      installed: true,
      binaryPath: bin,
      version: data.version,
      platform: data.platform,
    };
  } catch {
    return { installed: false };
  }
}

/** 索引器结果的用户可读文案。 */
function indexOutcomeText(outcome: IndexerOutcome, root: string): string {
  switch (outcome.kind) {
    case 'indexed':
      return `已确认索引: ${root}`;
    case 'index_started':
      return `已触发首次索引: ${root}`;
    case 'indexing':
      return `索引进行中: ${root}`;
    case 'skipped_auto_index_disabled':
      return `自动索引已关闭，已跳过: ${root}`;
    case 'skipped_no_project':
      return '未提供有效项目路径，已跳过索引。';
    case 'degraded':
      return `索引/状态检查降级（${outcome.reason}${
        outcome.message ? `: ${outcome.message}` : ''
      }）。已允许回退原生工具。`;
    default:
      return `索引结果未知: ${root}`;
  }
}

/* ------------------------------------------------------------------ */
/* 子命令实现                                                          */
/* ------------------------------------------------------------------ */

async function statusCmd(handlers: CbmCommandHandlers, invocation: CommandInvocation) {
  const cacheRoot = handlers.getCacheRoot?.() ?? getCacheRoot();
  const install =
    handlers.getInstallStatus?.(cacheRoot) ?? defaultInstallStatus(cacheRoot);
  const lines = [
    `CBM cache: ${cacheRoot}`,
    `installed: ${install.installed ? 'yes' : 'no'}${
      install.version ? ` (v${install.version})` : ''
    }${install.platform ? ` [${install.platform}]` : ''}`,
  ];
  if (install.binaryPath) lines.push(`binary: ${install.binaryPath}`);
  if (handlers.getUiStatus) {
    const ui = handlers.getUiStatus();
    lines.push(
      ui.running
        ? `ui: running at ${ui.url} (pid ${ui.pid})`
        : `ui: not running (port ${ui.port})`,
    );
  }
  lines.push('安装/修复可用 /cbm install 或 /cbm repair；UI 用 /cbm ui。');
  await handlers.reply(lines.join('\n'), invocation);
}

async function installCmd(handlers: CbmCommandHandlers, invocation: CommandInvocation) {
  if (!handlers.startBackgroundInstall) {
    await handlers.reply(
      'cbm install 不可用：未注入 startBackgroundInstall 依赖。',
      invocation,
    );
    return;
  }
  // 即使调用方提供了冲突 opts，接线层也会以该快照 root 为准；显式传递可
  // 让仅暴露 getCacheRoot 的命令接线保持同一缓存根。
  const cacheRoot = handlers.getCacheRoot?.() ?? getCacheRoot();
  const installPromise = handlers.startBackgroundInstall({ cacheRoot });
  await handlers.reply(
    'CBM 安装已在后台启动，不阻塞当前会话。可稍后运行 /cbm status 查看进度。',
    invocation,
  );
  // 安装完成后 fire-and-forget 刷新 MCP（非阻塞，fail-open）。
  if (handlers.registerMcp) {
    installPromise
      .then(async (bin) => {
        if (bin) {
          try {
             await handlers.registerMcp?.({ cacheRoot });
          } catch {
            /* fail-open */
          }
        }
      })
      .catch(() => {
        /* fail-open */
      });
  }
}

async function repairCmd(handlers: CbmCommandHandlers, invocation: CommandInvocation) {
  if (!handlers.repair) {
    await handlers.reply('cbm repair 不可用：未注入 repair 依赖。', invocation);
    return;
  }
  const cacheRoot = handlers.getCacheRoot?.() ?? getCacheRoot();
  const bin = await handlers.repair({ cacheRoot });
  if (bin) {
    if (handlers.registerMcp) {
      try {
        await handlers.registerMcp({ cacheRoot });
      } catch {
        /* fail-open */
      }
    }
    await handlers.reply(`CBM 已修复并安装: ${bin}`, invocation);
    return;
  }
  await handlers.reply('CBM 修复失败（未获得可用二进制）。', invocation);
}

async function indexCmd(handlers: CbmCommandHandlers, invocation: CommandInvocation) {
  if (!handlers.indexer) {
    await handlers.reply('cbm index 不可用：未注入 indexer 依赖。', invocation);
    return;
  }
  const root = handlers.getWorkspaceRoot?.() ?? process.cwd();
  const outcome = await handlers.indexer.ensureIndexed(root, {
    workspaceRoot: root,
    timeoutMs: 120_000,
  });
  await handlers.reply(indexOutcomeText(outcome, root), invocation);
}

async function uiStartCmd(handlers: CbmCommandHandlers, invocation: CommandInvocation) {
  if (!handlers.startUi) {
    await handlers.reply('cbm ui 不可用：未注入 startUi 依赖。', invocation);
    return;
  }
  const ui = await handlers.startUi();
  await handlers.reply(
    ui.running
      ? `CBM UI 已启动: ${ui.url} (pid ${ui.pid})`
      : 'CBM UI 未启动。',
    invocation,
  );
}

async function uiStopCmd(handlers: CbmCommandHandlers, invocation: CommandInvocation) {
  if (!handlers.stopUi) {
    await handlers.reply('cbm ui stop 不可用：未注入 stopUi 依赖。', invocation);
    return;
  }
  handlers.stopUi();
  await handlers.reply('CBM UI 已停止。', invocation);
}

async function uninstallCmd(handlers: CbmCommandHandlers, invocation: CommandInvocation) {
  const removed: string[] = [];
  let failed = false;
  if (handlers.stopUi) {
    try {
      handlers.stopUi();
      removed.push('ui');
    } catch {
      failed = true;
    }
  }
  if (handlers.removeMcp) {
    try {
      if (await handlers.removeMcp()) removed.push('mcp');
    } catch {
      failed = true;
    }
  }
  if (failed) {
    await handlers.reply(
      `cbm uninstall 部分失败（fail-open）。已移除 Oceanus 管理资源: ${removed.join(', ') || '无'}。源码与用户索引未删除。`,
      invocation,
    );
    return;
  }
  await handlers.reply(
    removed.length > 0
      ? `CBM 已卸载 Oceanus 管理资源: ${removed.join(', ')}。源码与用户索引未删除。`
      : '未发现可移除的 Oceanus 管理资源（MCP/UI）。源码与用户索引未删除。',
    invocation,
  );
}

/* ------------------------------------------------------------------ */
/* 工厂                                                                */
/* ------------------------------------------------------------------ */

/**
 * 构造 /cbm 命令。所有子命令 fail-open：解析或 handler 抛错时仅回写失败消息，
 * 不向 `execute` 抛异常。`install` 后台非阻塞。
 */
export function createCbmCommand(handlers: CbmCommandHandlers): CommandDefinition {
  return {
    name: 'cbm',
    description:
      '管理 codebase-memory-mcp（CBM）：status / install / repair / index / ui [stop] / uninstall',
    async execute(invocation) {
      const args = invocation.prompt.text.split(/\s+/).filter(Boolean);
      const sub = (args[0] ?? 'status').toLowerCase();
      try {
        switch (sub) {
          case 'status':
            await statusCmd(handlers, invocation);
            break;
          case 'install':
            await installCmd(handlers, invocation);
            break;
          case 'repair':
            await repairCmd(handlers, invocation);
            break;
          case 'index':
            await indexCmd(handlers, invocation);
            break;
          case 'ui':
            if (args[1]?.toLowerCase() === 'stop') {
              await uiStopCmd(handlers, invocation);
            } else {
              await uiStartCmd(handlers, invocation);
            }
            break;
          case 'uninstall':
            await uninstallCmd(handlers, invocation);
            break;
          default:
            await handlers.reply(
              `未知 cbm 子命令: ${sub}。可用：status / install / repair / index / ui [stop] / uninstall`,
              invocation,
            );
        }
      } catch (error) {
        await handlers.reply(`cbm ${sub} failed: ${messageOf(error)}`, invocation);
      }
    },
  };
}
