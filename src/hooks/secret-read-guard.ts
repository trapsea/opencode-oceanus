/**
 * 秘密文件读取守卫（借鉴 gsd-core gsd-secret-read-guard，issue #4221）。
 *
 * 背景：`.env` / `.env.<suffix>` / `.secrets` 通常持有 provider token、数据库
 * 凭据等秘密。任何把它们的内容带入对话的读取（无论有意还是 glob 误命中）都会
 * 让秘密进入上下文与日志。prose 提示无法可靠阻止这一行为，因此在工具层强制。
 *
 * 行为（execute.before，fail-closed on match）：
 * - `read`：入参 path / file_path 的任一路径段命中秘密 basename → 抛错阻断。
 * - `grep`：path / file 命中秘密 basename，或 include glob 去通配符后命中
 *   秘密命名空间（如 `*.env`、`.env*`）→ 抛错阻断。
 * - `bash` / `shell`：command 文本中出现秘密文件 token（含 `cat .env`、
 *   `$(cat .env)`、`source .env.local` 等形态）→ 抛错阻断。
 * - 工具名不在清单内、入参缺失或非对象 → 放行（fail-open，不误伤）。
 *
 * 本实现只提供 hook 逻辑，不做注册；注册见 src/hooks/index.ts。
 */

/** 受守卫约束的工具名（宿主侧 bash；个别运行时叫 shell，两者都拦）。 */
export const SECRET_READ_TOOLS: Record<string, true> = {
  read: true,
  grep: true,
  bash: true,
  shell: true,
};

/** 秘密 basename：.env、.env.<suffix>、.secrets（大小写不敏感）。 */
const SECRET_BASENAME_RE = /^\.env(?:\.[\w.-]+)?$|^\.secrets$/i;

/**
 * bash 命令文本中的秘密文件 token。用非路径字符做边界，避免命中
 * `foo.env`、`.environment`、`my-secrets-dir` 等普通名称；带引号、
 * 命令替换、重定向等上下文均可命中。
 */
const SECRET_COMMAND_TOKEN_RE =
  /(?:^|[^\w.-])\.(?:env(?:\.[\w.-]+)?|secrets)(?=$|[^\w-])/;

/** basename 是否为秘密文件名。 */
export function isSecretBasename(basename: string): boolean {
  return SECRET_BASENAME_RE.test(basename);
}

/** 路径字符串（绝对/相对、正/反斜杠分隔）是否指向秘密文件。 */
export function isSecretPathValue(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  const segments = value.split(/[\\/]+/).filter((s) => s.length > 0);
  return segments.some((seg) => isSecretBasename(seg));
}

// glob 字符串（如 *.env、.env*、双星路径下的 .env.local）是否选择秘密命名空间。
export function isSecretGlob(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  return value.split(/[\\/]+/).some((seg) => {
    const stripped = seg.replace(/[*?{}[\]]/g, '');
    if (stripped.length === 0) return false;
    // 去通配符后要么本身是秘密 basename，要么形如 xxx.env / xxx.secrets。
    return (
      isSecretBasename(stripped) || /\.(?:env|secrets)$/i.test(stripped)
    );
  });
}

/** bash 命令文本是否把秘密文件当作操作对象。 */
export function mentionsSecretFile(command: unknown): boolean {
  if (typeof command !== 'string' || command.length === 0) return false;
  return SECRET_COMMAND_TOKEN_RE.test(command);
}

/** v2 execute.before 事件的最小结构。 */
export interface SecretReadGuardEvent {
  tool: string;
  input: unknown;
}

export type SecretReadGuardStatus = 'blocked' | 'allowed' | 'failopen';

export interface SecretReadGuardOptions {
  /** 观测回调（测试注入 spy / 生产注入 logger）。 */
  onStatus?: (status: SecretReadGuardStatus, data?: Record<string, unknown>) => void;
}

/** 守卫专用的阻断错误，便于上层区分“有意阻断”与“内部意外”。 */
export class SecretReadBlockedError extends Error {
  constructor(
    public readonly tool: string,
    public readonly detail: string,
  ) {
    super(
      `[oceanus] 秘密文件守卫：${detail}。禁止把 .env / .secrets 内容读入对话；` +
        '如确需某个配置值，请让用户直接提供该键值或脱敏占位符。' +
        '确认为误报时可用配置 disabled_hooks: ["secret_read_guard"] 关闭本守卫。',
    );
    this.name = 'SecretReadBlockedError';
  }
}

/**
 * 构造 v2 execute.before Hook。
 * 匹配秘密目标 → 抛 SecretReadBlockedError（fail-closed 阻断）；
 * 入参形状异常或非受管工具 → 静默放行（fail-open）。
 */
export function createSecretReadGuardHook(
  options: SecretReadGuardOptions = {},
): { 'tool.execute.before': (event: SecretReadGuardEvent) => Promise<void> } {
  const onStatus = options.onStatus ?? (() => {});

  const block = (tool: string, detail: string): never => {
    onStatus('blocked', { tool, detail });
    throw new SecretReadBlockedError(tool, detail);
  };

  return {
    'tool.execute.before': async (event): Promise<void> => {
      try {
        if (!event || typeof event.tool !== 'string') return;
        if (!SECRET_READ_TOOLS[event.tool]) return;
        const input = event.input;
        if (!input || typeof input !== 'object') return;
        const rec = input as Record<string, unknown>;

        if (event.tool === 'read') {
          if (isSecretPathValue(rec.path) || isSecretPathValue(rec.file_path)) {
            block('read', 'read 的目标路径是秘密文件');
          }
        } else if (event.tool === 'grep') {
          if (isSecretPathValue(rec.path) || isSecretPathValue(rec.file)) {
            block('grep', 'grep 的目标路径是秘密文件');
          }
          if (isSecretGlob(rec.include)) {
            block('grep', 'grep 的 include 命中秘密文件命名空间');
          }
        } else {
          // bash / shell
          if (mentionsSecretFile(rec.command)) {
            block(event.tool, '命令文本引用了秘密文件（.env / .secrets）');
          }
        }
        onStatus('allowed', { tool: event.tool });
      } catch (error) {
        if (error instanceof SecretReadBlockedError) throw error;
        // 内部意外一律放行：守卫自身故障不能 wedge 全部工具调用。
        onStatus('failopen', { error: String(error) });
      }
    },
  };
}
