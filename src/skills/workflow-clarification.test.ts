import { describe, expect, test } from 'bun:test';
import { OCEANUS_SKILLS } from './index';
import { OCEANUS_FINISH_SKILL, decideFinish, type FinishInput } from './oceanus-finish';
import { createSisyphusAgent } from '../agents/sisyphus';
import { createOracleAgent } from '../agents/oracle';
import { REVIEW_SCENES } from '../review/scenes';

const skill = (name: string) => OCEANUS_SKILLS.find((item) => item.name === name)!;

describe('Sisyphus 工作流澄清契约', () => {
  test('Skill 注册对象包含分类，阶段与支持型 Skill 可区分', () => {
    for (const item of OCEANUS_SKILLS) expect(item.category).toBeDefined();
    expect(skill('oceanus-intake').category).toBe('phase');
    expect(skill('oceanus-debugging').category).toBe('support');
  });

  test('调度协议由 Agent 常驻 prompt 提供，不注册调度 Skill', () => {
    expect(skill('oceanus-orchestration')).toBeUndefined();
  });

  test('TypeScript description 与 frontmatter 保持同步', () => {
    for (const item of OCEANUS_SKILLS) {
      expect(item.content.match(/^description:\s*(.+)$/m)?.[1]).toBe(item.description);
    }
  });

  test('六阶段总契约已内置到 Sisyphus，不注册 workflow Skill', () => {
    const prompt = createSisyphusAgent().system!;
    expect(skill('oceanus-workflow')).toBeUndefined();
    expect(prompt).toContain('phase_handoff');
    expect(prompt).toContain('current_phase');
    expect(prompt).toContain('next_action');
  });

  test('phase_handoff 使用统一 Markdown 结果外壳', () => {
    const prompt = createSisyphusAgent().system!;
    for (const section of [
      '# 结果',
      '## 状态',
      '## 摘要',
      '## 详情',
      '## 证据',
      '## 验证',
      '## 未确认项',
      '## 负向发现',
      '## 剩余风险',
      '### 阶段交接',
      '#### current_phase',
      '#### input_sources',
      '#### completed',
      '#### next_action',
      '#### updated',
      '其中 `status`、`current_phase`、`input_sources`、`completed`、`open_questions`、`next_action`、`risks`、`evidence`、`updated` 为强制语义字段',
    ]) {
      expect(prompt).toContain(section);
    }
    expect(prompt).toContain('不得使用 XML/HTML 标签、JSON/YAML、数组字面量或管道分隔的伪表格');
  });

  test('Sisyphus 阶段完成后自主续航，暂停必须以带推荐和自定义入口的问题建立边界', () => {
    const prompt = createSisyphusAgent().system!;
    const intake = skill('oceanus-intake').content;
    expect(prompt).toContain('自主续航与暂停边界');
    expect(prompt).toContain('completed` 不是等待下一条用户消息的信号');
    expect(prompt).toContain('不得仅汇报交接结果后无故停止');
    expect(prompt).toContain('从第一个未终态动作继续');
    expect(prompt).toContain('仅当缺少会改变范围、验收、方案方向或不可逆操作的用户决策');
    expect(prompt).toContain('必须调用 `question` 工具建立阻塞边界');
    expect(prompt).toContain('明确标注推荐项及理由');
    expect(prompt).toContain('“其他/自定义”入口');
    expect(prompt).toContain('不得长期保持无解释的 `pending`');
    expect(intake).toContain('必须以 `question` 交还用户');
    expect(intake).toContain('推荐项及“其他/自定义”入口');
  });

  test('Review BLOCKER 处置由 review_loop 双模式控制', () => {
    const review = skill('oceanus-review').content;
    const execute = skill('oceanus-execute').content;
    const system = createSisyphusAgent().system!;
    // 总契约声明双模式开关与默认快速路径
    expect(system).toContain('BLOCKER 处置由执行配置 review_loop 控制');
    expect(system).toContain('不重新 Review');
    // Review：完整清单 + 循环/直通双分支
    expect(review).toContain('BLOCKER 处置（执行配置 review_loop 控制）');
    expect(review).toContain('不得等待用户再次提示');
    expect(review).toContain('全部 blocker 任务');
    expect(review).toContain('修复后直接 Finish');
    expect(review).toContain('review_loop: off');
    // Execute：双去向
    expect(execute).toContain('自动重新进入 Review');
    expect(execute).toContain('BLOCKER 清单');
    expect(execute).toContain('不重新 Review');
    // 循环上限、UNCERTAIN 全模式阻塞与 off 路径 accepted 显式映射
    expect(review).toContain('最多自动运行三轮');
    expect(system).toContain('任何模式下都阻塞');
    expect(review).toContain('记为 accepted');
  });

  test('Review 分级路由契约：双信号路由 + Brief 路径化 + 底线不变量', () => {
    const review = skill('oceanus-review').content;
    const oracleSystem = createOracleAgent().system!;
    const formalChecks = REVIEW_SCENES['review']!.checks;
    const lightChecks = REVIEW_SCENES['diff-review']!.checks;
    // 双信号路由：docs-only → light；trivial → scoped；standard/architecture → full
    expect(review).toContain('分级路由正式委派给 @oracle');
    expect(review).toContain('docs-only diff');
    expect(review).toContain('intake complexity=trivial');
    expect(review).toContain('review_intensity: light');
    expect(review).toContain('review_intensity: scoped');
    expect(review).toContain('review_intensity: full');
    // 判据缺失回落 full（fail-safe）
    expect(review).toContain('判据缺失/不可判定');
    // 底线不变量：graded + fresh-session + 无零审查放行
    expect(review).toContain('不存在零审查放行路径');
    // 场景注册表与 oracle prompt 同步分级语义
    expect(formalChecks).toContain('scoped（intake complexity=trivial 时）');
    expect(lightChecks).toContain('review_intensity: light');
    expect(oracleSystem).toContain('按分级路由使用场景');
    // Brief 路径化三要素
    expect(review).toContain('路径引用与不超过 3 行的短摘要');
    expect(oracleSystem).toContain('内联每字段不超过 3 行');
    // 全量口径不被削弱（full 路径仍禁止跳过维度）
    expect(formalChecks).toContain('不得因某维度未在需求中明确提及而跳过');
  });

  test('CBM 区分 Intake 首次初始化与 Review 刷新', () => {
    expect(createSisyphusAgent().system).toContain('首次初始化');
    expect(createSisyphusAgent().system).toContain('代码调研开始前');
    expect(createSisyphusAgent().system).toContain('刷新');
    expect(skill('oceanus-review').content).toContain('刷新');
  });

  test('Intake CBM 初始化先于代码调研：步骤 1 预判触发 + 步骤 7 分类修正', () => {
    const intake = skill('oceanus-intake').content;
    expect(intake).toContain('CBM 预判初始化');
    expect(intake).toContain('先于任何代码调研');
    expect(intake).toContain('触发后不等待完成');
    expect(intake).toContain('补触发首次');
    expect(intake).toContain('不回滚，如实记录偏差');
    // 非代码任务不因普通文本工作触发索引的规则保留
    expect(intake).toContain('非代码任务不索引');
    // 步骤 10 核对语义与 cbm 字段触发时机枚举
    expect(intake).toContain('核对 CBM 初始化与记录');
    expect(intake).toContain('未触发及原因');
    // 技术环境调研步骤存在且产出 tech_context 字段
    expect(intake).toContain('技术环境调研');
    expect(intake).toContain('tech_context');
    // 步骤编号从 1 开始连续递增（1-12），无步骤 0 残留
    const stepNumbers = [...intake.matchAll(/^\d+\.\s/gm)].map((m) =>
      Number(m[0].replace(/[.\s]/g, '')),
    );
    expect(stepNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(intake).not.toContain('步骤 0');
  });

  test('Finish 不要求人工批准且不写入经验文件', () => {
    const complete: FinishInput = {
      review: 'accepted', completion: 'green', ledger: 'complete', evidence: 'fresh',
    };
    expect(decideFinish(complete)).toEqual({ complete: true, gaps: [] });
    expect(OCEANUS_FINISH_SKILL.content).not.toContain('human（APPROVED）');
    expect(OCEANUS_FINISH_SKILL.content).not.toContain('learnings/');
  });

  test('discuss 主流程要求 Intake，允许只读调研但禁止写入 worker', () => {
    const content = skill('oceanus-discuss').content;
    expect(content).toContain('主流程必须有 `intake_report`');
    expect(content).toContain('只读调研');
    expect(content).toContain('写入 worker');
    expect(content).toContain('多选');
  });
});
