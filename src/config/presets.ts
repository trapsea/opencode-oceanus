import * as fs from 'node:fs';
import * as path from 'node:path';
import { getConfigDir } from './paths';

export type UserConfig = Record<string, unknown>;

export interface UserPresetOptions {
  /** 覆盖默认的用户配置目录，主要用于测试或嵌入式调用。 */
  configDir?: string;
  /** 指定配置文件；未指定时按 jsonc、json 的优先级选择。 */
  configPath?: string;
}

export interface UpdatedUserPreset {
  path: string;
  config: UserConfig;
}

function stripJsonc(source: string): string {
  const comments = /\\"|"(?:\\"|[^"\\])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g;
  const trailingCommas = /\\"|"(?:\\"|[^"\\])*"|(,)(\s*[}\]])/g;

  return source
    .replace(comments, (match, comment: string | undefined) =>
      comment ? '' : match,
    )
    .replace(trailingCommas, (match, comma: string | undefined, closing: string) =>
      comma ? closing : match,
    );
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/** 选择用户级配置文件：已有 jsonc 优先于 json，新配置默认使用 jsonc。 */
export function getUserPresetConfigPath(configDir = getConfigDir()): string {
  const basePath = path.join(configDir, 'opencode-oceanus');
  const jsoncPath = `${basePath}.jsonc`;
  const jsonPath = `${basePath}.json`;

  if (isFile(jsoncPath)) return jsoncPath;
  if (isFile(jsonPath)) return jsonPath;
  return jsoncPath;
}

/** 读取一个用户配置文件；不存在的文件按空配置处理。 */
export function readUserConfig(configPath = getUserPresetConfigPath()): UserConfig {
  if (!isFile(configPath)) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonc(fs.readFileSync(configPath, 'utf8')));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无法解析用户配置 ${configPath}: ${message}`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`用户配置 ${configPath} 必须是 JSON 对象`);
  }
  return parsed as UserConfig;
}

/**
 * 原子更新用户配置的顶层 preset 字段。
 * 先完整读取并校验旧文件，再写入同目录临时文件并 rename，避免半写入配置。
 */
export function updateUserPreset(
  preset: string | null | undefined,
  options: UserPresetOptions = {},
): UpdatedUserPreset {
  const configPath = options.configPath ?? getUserPresetConfigPath(options.configDir);
  const configDir = path.dirname(configPath);
  const config = readUserConfig(configPath);

  if (preset === null || preset === undefined) {
    delete config.preset;
  } else {
    if (!preset.trim()) throw new Error('preset 不能为空');
    config.preset = preset;
  }

  fs.mkdirSync(configDir, { recursive: true });
  const temporaryPath = path.join(
    configDir,
    `.${path.basename(configPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  const mode = isFile(configPath) ? fs.statSync(configPath).mode & 0o777 : 0o600;

  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: 'utf8',
      mode,
    });
    fs.renameSync(temporaryPath, configPath);
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // 保留原始写入错误。
    }
    throw error;
  }

  return { path: configPath, config };
}

// 便于调用方使用更语义化的名称，同时保持单一实现。
export const selectUserConfigPath = getUserPresetConfigPath;
export const setUserPreset = updateUserPreset;
