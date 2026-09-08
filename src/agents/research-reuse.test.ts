import { describe, expect, test } from 'bun:test';
import {
  RESEARCH_REUSE_PROTOCOL_VERSION,
  classifySceneReuse,
  computeResearchMetaKey,
  diffResearchSnapshot,
  isFormalReviewScene,
  type ResearchSnapshotMeta,
} from './research-reuse';

function baseMeta(overrides: Partial<ResearchSnapshotMeta> = {}): ResearchSnapshotMeta {
  return {
    taskKey: 'oracle-reuse',
    scene: 'oracle/analysis',
    stateHead: 'daa0123',
    changedFiles: ['src/agents/oracle.ts', 'src/review/scenes.ts'],
    decisionIds: ['D-01', 'D-02'],
    protocolVersion: RESEARCH_REUSE_PROTOCOL_VERSION,
    ...overrides,
  };
}

describe('computeResearchMetaKey', () => {
  test('相同元数据得到相同键；集合字段顺序无关', () => {
    const a = baseMeta();
    const b = baseMeta({
      changedFiles: ['src/review/scenes.ts', 'src/agents/oracle.ts'],
      decisionIds: ['D-02', 'D-01'],
    });
    expect(computeResearchMetaKey(a)).toBe(computeResearchMetaKey(b));
  });

  test('任一字段变化产生不同键（含去重）', () => {
    const base = computeResearchMetaKey(baseMeta());
    expect(computeResearchMetaKey(baseMeta({ stateHead: 'daa9999' }))).not.toBe(base);
    expect(computeResearchMetaKey(baseMeta({ taskKey: 'other' }))).not.toBe(base);
    // 重复条目不影响键（集合语义）
    expect(
      computeResearchMetaKey(baseMeta({ changedFiles: ['src/agents/oracle.ts', 'src/agents/oracle.ts', 'src/review/scenes.ts'] })),
    ).toBe(base);
  });
});

describe('diffResearchSnapshot', () => {
  test('快照一致 → 可复用', () => {
    const decision = diffResearchSnapshot(baseMeta(), baseMeta());
    expect(decision.reusable).toBe(true);
    expect(decision.staleReasons).toEqual([]);
  });

  test('state_head 变化 → state_head_changed', () => {
    const decision = diffResearchSnapshot(baseMeta(), baseMeta({ stateHead: 'bbbb444' }));
    expect(decision.reusable).toBe(false);
    expect(decision.staleReasons).toContain('state_head_changed');
  });

  test('变更文件集合变化 → changed_files_changed（顺序无关）', () => {
    const sameOrder = diffResearchSnapshot(
      baseMeta(),
      baseMeta({ changedFiles: ['src/review/scenes.ts', 'src/agents/oracle.ts'] }),
    );
    expect(sameOrder.reusable).toBe(true);

    const changed = diffResearchSnapshot(
      baseMeta(),
      baseMeta({ changedFiles: ['src/agents/oracle.ts'] }),
    );
    expect(changed.reusable).toBe(false);
    expect(changed.staleReasons).toContain('changed_files_changed');
  });

  test('用户决策变化 → decisions_changed', () => {
    const decision = diffResearchSnapshot(baseMeta(), baseMeta({ decisionIds: ['D-01'] }));
    expect(decision.reusable).toBe(false);
    expect(decision.staleReasons).toContain('decisions_changed');
  });

  test('协议版本变化 → protocol_version_changed', () => {
    const decision = diffResearchSnapshot(
      baseMeta(),
      baseMeta({ protocolVersion: '2' }),
    );
    expect(decision.reusable).toBe(false);
    expect(decision.staleReasons).toContain('protocol_version_changed');
  });

  test('多字段同时变化时逐条列出原因', () => {
    const decision = diffResearchSnapshot(
      baseMeta(),
      baseMeta({ scene: 'explorer', stateHead: 'cccc777', decisionIds: [] }),
    );
    expect(decision.reusable).toBe(false);
    expect(decision.staleReasons).toEqual(
      expect.arrayContaining(['scene_changed', 'state_head_changed', 'decisions_changed']),
    );
  });
});

describe('classifySceneReuse', () => {
  test('正式审查场景：仅事实线索，不直接复用结论', () => {
    for (const scene of ['review', 'diff-review', 'completion-audit', 'visual-acceptance']) {
      expect(isFormalReviewScene(scene)).toBe(true);
      expect(classifySceneReuse(scene)).toEqual({
        reuseFindings: false,
        formalReviewLeadsOnly: true,
      });
    }
  });

  test('顾问/分析/侦察场景：快照未失效即可复用', () => {
    for (const scene of ['consult', 'analysis', 'solution-analysis', 'plan-gate', 'explorer']) {
      expect(classifySceneReuse(scene)).toEqual({
        reuseFindings: true,
        formalReviewLeadsOnly: false,
      });
    }
  });
});
