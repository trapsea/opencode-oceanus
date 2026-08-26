import * as fs from 'node:fs';
import * as path from 'node:path';
import { getConfigSearchDirs } from './paths';
import { PluginConfigSchema, type PluginConfig } from './schema';

/** 去除 JSONC 注释与尾逗号 */
export function stripJsonComments(json: string): string {
  const commentPattern = /\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g;
  const trailingCommaPattern = /\\"|"(?:\\"|[^"])*"|(,)(\s*[}\]])/g;

  return json
    .replace(commentPattern, (match, commentGroup) =>
      commentGroup ? '' : match,
    )
    .replace(trailingCommaPattern, (match, comma, closing) =>
      comma ? closing : match,
    );
}

function findConfigPath(basePath: string): string | null {
  const jsoncPath = `${basePath}.jsonc`;
  const jsonPath = `${basePath}.json`;

  if (fs.existsSync(jsoncPath)) {
    return jsoncPath;
  }
  if (fs.existsSync(jsonPath)) {
    return jsonPath;
  }
  return null;
}

function findConfigPathInDirs(
  configDirs: string[],
  baseName: string,
): string | null {
  for (const configDir of configDirs) {
    const configPath = findConfigPath(path.join(configDir, baseName));
    if (configPath) {
      return configPath;
    }
  }
  return null;
}

function loadConfigFromPath(
  configPath: string,
): PluginConfig | null {
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    let rawConfig: unknown;
    try {
      const stripped = stripJsonComments(content);
      rawConfig = JSON.parse(stripped);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[opencode-oceanus] Invalid JSON in ${configPath}:`, message);
      return null;
    }

    const result = PluginConfigSchema.safeParse(rawConfig);
    if (!result.success) {
      console.warn(`[opencode-oceanus] Invalid config at ${configPath}:`);
      console.warn(result.error.format());
      return null;
    }

    return result.data;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code !== 'ENOENT'
    ) {
      console.warn(
        `[opencode-oceanus] Error reading config from ${configPath}:`,
        error.message,
      );
    }
    return null;
  }
}

function deepMerge<T extends Record<string, unknown>>(
  base?: T,
  override?: T,
): T | undefined {
  if (!base) return override;
  if (!override) return base;

  const result = { ...base } as T;
  for (const key of Object.keys(override) as (keyof T)[]) {
    const baseVal = base[key];
    const overrideVal = override[key];

    if (
      typeof baseVal === 'object' &&
      baseVal !== null &&
      typeof overrideVal === 'object' &&
      overrideVal !== null &&
      !Array.isArray(baseVal) &&
      !Array.isArray(overrideVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>,
      ) as T[keyof T];
    } else {
      result[key] = overrideVal;
    }
  }
  return result;
}

export interface ConfigLoadOptions {
  directory?: string;
}

/**
 * 加载插件配置。
 * 优先级：项目配置 > 用户配置。
 * 用户配置目录：~/.config/opencode/opencode-oceanus.{json,jsonc}
 * 项目配置目录：<directory>/.opencode/opencode-oceanus.{json,jsonc}
 */
export function loadPluginConfig(options?: ConfigLoadOptions): PluginConfig {
  const userConfigPath = findConfigPathInDirs(
    getConfigSearchDirs(),
    'opencode-oceanus',
  );

  let config: PluginConfig = userConfigPath
    ? (loadConfigFromPath(userConfigPath) ?? {})
    : {};

  if (options?.directory) {
    const projectConfigBasePath = path.join(
      options.directory,
      '.opencode',
      'opencode-oceanus',
    );
    const projectConfigPath = findConfigPath(projectConfigBasePath);
    if (projectConfigPath) {
      const projectConfig = loadConfigFromPath(projectConfigPath);
      if (projectConfig) {
        config = {
          ...config,
          ...projectConfig,
          agents: deepMerge(
            config.agents as Record<string, unknown> | undefined,
            projectConfig.agents as Record<string, unknown> | undefined,
          ) as PluginConfig['agents'],
        };
      }
    }
  }

  return config;
}
