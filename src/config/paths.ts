import { homedir } from 'node:os';
import { join } from 'node:path';

function getDefaultOpenCodeConfigDir(): string {
  const userConfigDir = process.env.XDG_CONFIG_HOME
    ? process.env.XDG_CONFIG_HOME
    : join(homedir(), '.config');

  return join(userConfigDir, 'opencode');
}

function getCustomOpenCodeConfigDir(): string | undefined {
  const configDir = process.env.OPENCODE_CONFIG_DIR?.trim();
  return configDir || undefined;
}

/**
 * OpenCode 配置目录（写入/权威路径）。
 * 解析顺序：OPENCODE_CONFIG_DIR > XDG_CONFIG_HOME/opencode > ~/.config/opencode
 */
export function getConfigDir(): string {
  return getCustomOpenCodeConfigDir() ?? getDefaultOpenCodeConfigDir();
}

/**
 * OpenCode 配置目录（按查找优先级排列，去重）。
 * 插件配置文件的搜索基于这些目录。
 */
export function getConfigSearchDirs(): string[] {
  const dirs = [getCustomOpenCodeConfigDir(), getDefaultOpenCodeConfigDir()];

  return dirs.filter((dir, index): dir is string => {
    return Boolean(dir) && dirs.indexOf(dir) === index;
  });
}
