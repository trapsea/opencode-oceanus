/**
 * 规划产物写入守卫（借鉴 gsd-core gsd-write-guard，issue #973）。
 *
 * 背景：agent 常只读取大文档的一个窗口（例如 292 行 ROADMAP.md 中的 16 行），
 * 随后用 write 整文件覆盖写回窗口内容——三个 milestone 的历史被一次静默摧毁。
 * 对模型的 prose 告诫只能降低概率、无法阻止（gsd #973 记录了 agent 读到
 * advisory、判定其无约束力、带着对 write 语义的错误心智继续覆盖的全过程），
 * 因此在工具层用代码强制。
 *
 * 行为（execute.before，仅拦截 write 工具的整文件覆盖）：
 * - 目标位于 `.oceanus/{spec,plan,progress,review,findings,learnings}` 且
 *   磁盘上已存在 → 读取现有内容并比较行数。
 * - 旧行数 >= 阈值 且 新行数 < 旧行数 × 比例 → 抛错阻断（灾难性缩减）。
 * - 新建文件、行数不缩、不在受管目录、读取失败 → 放行（fail-open）。
 * - edit / apply_patch 是局部修改，不拦截（apply_patch 另有路径边界 hook）。
 *
 * 保障边界与 gsd 相同：阻止的是“意外/单次塌缩”，不是蓄意规避；要绕过守卫
 * 需要改用局部编辑工具——那是可见、可审计的替代路径，而非静默覆盖。
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** 受保护的 .planning 目录段（相对于工作区根）。 */
export const PLANNING_GUARD_DIRS: readonly string[] = [
  '.oceanus/spec',
  '.oceanus/plan',
  '.oceanus/progress',
  '.oceanus/review',
  '.oceanus/findings',
  '.oceanus/learnings',
];

/** 旧内容行数达到该值才启用缩减保护（过小文件不拦，避免噪声）。 */
export const PLANNING_GUARD_MIN_LINES = 10;

/** 新行数低于旧行数 × 该比例视为灾难性缩减。 */
export const PLANNING_GUARD_SHRINK_RATIO = 0.5;

/** v2 execute.before 事件的最小结构。 */
export interface PlanningWriteGuardEvent {
  tool: string;
  input: unknown;
}

export type PlanningWriteGuardStatus =
  | 'blocked'
  | 'allowed'
  | 'new_file'
  | 'unmanaged'
  | 'failopen';

export interface PlanningWriteGuardOptions {
  /** 工作区根目录（canonical）。 */
  root: string;
  /** 读文件函数，默认 node:fs/promises readFile（utf-8）；测试可注入。 */
  readFileImpl?: (p: string) => Promise<string>;
  /** 观测回调。 */
  onStatus?: (status: PlanningWriteGuardStatus, data?: Record<string, unknown>) => void;
}

/** 阻断错误：携带旧/新行数与替代做法指引。 */
export class PlanningWriteBlockedError extends Error {
  constructor(
    public readonly target: string,
    public readonly oldLines: number,
    public readonly newLines: number,
  ) {
    super(
      `[oceanus] 规划产物写入守卫：检测到对既有文档 ${target} 的灾难性缩减覆盖` +
        `（现有 ${oldLines} 行 → 覆盖后 ${newLines} 行）。若确属有意精简，请改用 edit 做局部修改，` +
        '或先向用户说明并确认；整文件 write 覆盖会静默摧毁未读取窗口内的历史内容。' +
        '确认为误报时可用配置 disabled_hooks: ["planning_write_guard"] 关闭本守卫。',
    );
    this.name = 'PlanningWriteBlockedError';
  }
}

/** 目标绝对路径是否落在受管 .oceanus 子目录内。 */
export function isManagedPlanningPath(absolutePath: string, root: string): boolean {
  const rel = path.relative(root, absolutePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const normalized = rel.split(path.sep).join('/');
  return PLANNING_GUARD_DIRS.some(
    (dir) => normalized === dir || normalized.startsWith(`${dir}/`),
  );
}

/** 计行数（与 gsd 一致按换行计；空串算 0 行）。 */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split('\n').length;
}

/**
 * 构造 v2 execute.before Hook（只管 write 工具）。
 * 阻断 = 抛 PlanningWriteBlockedError；判定过程任何读取/形状异常 → 放行。
 */
export function createPlanningWriteGuardHook(
  options: PlanningWriteGuardOptions,
): { 'tool.execute.before': (event: PlanningWriteGuardEvent) => Promise<void> } {
  const { root } = options;
  const readFileImpl = options.readFileImpl ?? ((p: string) => readFile(p, 'utf-8'));
  const onStatus = options.onStatus ?? (() => {});

  return {
    'tool.execute.before': async (event): Promise<void> => {
      if (!event || event.tool !== 'write') return;
      const input = event.input;
      if (!input || typeof input !== 'object') return;
      const rec = input as Record<string, unknown>;
      const rawPath = typeof rec.path === 'string' ? rec.path : rec.file_path;
      const content = typeof rec.content === 'string' ? rec.content : undefined;
      if (typeof rawPath !== 'string' || rawPath.length === 0 || content === undefined) {
        return;
      }

      const absolute = path.resolve(root, rawPath);
      if (!isManagedPlanningPath(absolute, root)) {
        onStatus('unmanaged', { path: rawPath });
        return;
      }

      let existing: string;
      try {
        existing = await readFileImpl(absolute);
      } catch {
        // 读不到 = 文件不存在（新建）或权限问题；新建放行，权限问题交由写入自身报错。
        onStatus('new_file', { path: rawPath });
        return;
      }

      const oldLines = countLines(existing);
      const newLines = countLines(content);
      if (
        oldLines >= PLANNING_GUARD_MIN_LINES &&
        newLines < oldLines * PLANNING_GUARD_SHRINK_RATIO
      ) {
        onStatus('blocked', { path: rawPath, oldLines, newLines });
        throw new PlanningWriteBlockedError(rawPath, oldLines, newLines);
      }
      onStatus('allowed', { path: rawPath, oldLines, newLines });
    },
  };
}
