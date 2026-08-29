/** 一个可选初始化阶段及其执行函数。 */
export type OptionalStage = {
  name: string;
  run: () => void | Promise<void>;
};

export type StageOutcome =
  | { name: string; status: 'succeeded' }
  | { name: string; status: 'failed'; error: unknown };

export type ErrorReporter = (stage: string, error: unknown) => void;

/** 顺序执行阶段；单个阶段失败不会阻断其它阶段。 */
export async function runOptionalStages(
  stages: readonly OptionalStage[],
  report?: ErrorReporter,
): Promise<StageOutcome[]> {
  const outcomes: StageOutcome[] = [];

  for (const stage of stages) {
    try {
      await stage.run();
      outcomes.push({ name: stage.name, status: 'succeeded' });
    } catch (error) {
      try {
        report?.(stage.name, error);
      } catch {
        // reporter 错误不能覆盖阶段错误或阻断后续阶段。
      }
      outcomes.push({ name: stage.name, status: 'failed', error });
    }
  }

  return outcomes;
}

export type Cleanup = () => void | Promise<void>;

export type CleanupRunner = {
  add(stage: string, cleanup: Cleanup): void;
  run(): Promise<void>;
  readonly done: Promise<void>;
};

/** 管理 cleanup，并以逆序等待执行；cleanup 之间相互隔离错误。 */
export function createCleanupRunner(report?: ErrorReporter): CleanupRunner {
  const cleanups: Array<{ stage: string; cleanup: Cleanup }> = [];
  let done: Promise<void> = Promise.resolve();

  const run = async (): Promise<void> => {
    // 取快照，避免执行期间新增的 cleanup 改变本轮顺序。
    const pending = cleanups.splice(0).reverse();
    for (const item of pending) {
      try {
        await item.cleanup();
      } catch (error) {
        try {
          report?.(item.stage, error);
        } catch {
          // reporter 错误不能覆盖 cleanup 错误或阻断后续 cleanup。
        }
      }
    }
  };

  return {
    add(stage, cleanup) {
      cleanups.push({ stage, cleanup });
    },
    run() {
      done = run();
      return done;
    },
    get done() {
      return done;
    },
  };
}

/** 提供给 host 的同步 cleanup 入口，异步工作通过 runner.done 观察。 */
export function createHostCleanup(runner: CleanupRunner): () => void {
  return () => {
    void runner.run();
  };
}
