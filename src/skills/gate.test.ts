import { describe, expect, test } from 'bun:test';
import { OCEANUS_DISCUSS_SKILL } from './oceanus-discuss';
import { OCEANUS_INTAKE_SKILL } from './oceanus-intake';
import { OCEANUS_PLAN_SKILL } from './oceanus-plan';
import { OCEANUS_DEBUGGING_SKILL } from './oceanus-debugging';
import { OCEANUS_EXECUTE_SKILL } from './oceanus-execute';
import { OCEANUS_REVIEW_SKILL } from './oceanus-review';
import { OCEANUS_FINISH_SKILL } from './oceanus-finish';
import { buildOceanusPrompt } from '../agents/oceanus';

const content = OCEANUS_PLAN_SKILL.content;
const intakeContent = OCEANUS_INTAKE_SKILL.content;
const brainstormContent = OCEANUS_DISCUSS_SKILL.content;
const debuggingContent = OCEANUS_DEBUGGING_SKILL.content;
const executeContent = OCEANUS_EXECUTE_SKILL.content;
const reviewContent = OCEANUS_REVIEW_SKILL.content;

describe('Plan impact_estimate 与 advisory 契约', () => {
  test('调试 Skill 强制根因调查、单一假设与三轮升级', () => {
    expect(debuggingContent).toContain('没有完成根因调查，不得提出修复');
    expect(debuggingContent).toContain('根因调查');
    expect(debuggingContent).toContain('模式分析');
    expect(debuggingContent).toContain('单一假设验证');
    expect(debuggingContent).toContain('修复与防御');
    expect(debuggingContent).toContain('第 3 轮仍失败');
  });

  test('Execute 覆盖 TDD 双路径与反馈核验', () => {
    expect(executeContent).toMatch(/TDD 开启[\s\S]*RED[\s\S]*GREEN[\s\S]*REFACTOR/);
    expect(executeContent).toContain('TDD 关闭');
    expect(executeContent).toContain('characterization test');
    expect(executeContent).toContain('oceanus-debugging');
    expect(executeContent).toContain('不得因为反馈来自专家就直接照单全收');
  });

  test('Execute 要求修改后按项目约定格式化并核验换行', () => {
    expect(executeContent).toContain('## 源代码格式化');
    expect(executeContent).toContain('识别项目约定的 formatter 和格式化命令');
    expect(executeContent).toContain('不得为了减少输出把多条语句、多个 import 或整个方法压缩到同一行');
    expect(executeContent).toContain('不得假称已完成格式化');
  });

  test('Review 覆盖完成声明验证门和反馈技术核验', () => {
    expect(reviewContent).toMatch(/IDENTIFY[\s\S]*RUN[\s\S]*READ[\s\S]*VERIFY[\s\S]*CLAIM/);
    expect(reviewContent).toContain('测试通过不等于构建通过');
    expect(reviewContent).toContain('验证技术事实');
    expect(reviewContent).toContain('worker 报告成功 ≠ 文件范围正确');
  });

  test('Review 独立核验代码格式并要求格式证据', () => {
    expect(reviewContent).toContain('代码格式审查');
    expect(reviewContent).toContain('formatter 或 `format:check` 命令');
    expect(reviewContent).toContain('完整输出与退出码');
    expect(reviewContent).toContain('无可用 formatter');
    expect(reviewContent).toContain('作为 **BLOCKER** 列入回退清单');
    expect(reviewContent).toContain('代码格式审查、以及测试、构建、real-surface 证据');
  });

  test('Review 持对抗性立场：假设未达成、go-soft 清单与发现分级', () => {
    expect(reviewContent).toContain('假设目标未达成，直到代码证据证明相反');
    expect(reviewContent).toContain('占位实现满足存在性但不满足行为');
    expect(reviewContent).toContain('审查者变软的失效模式');
    expect(reviewContent).toContain('**BLOCKER**');
    expect(reviewContent).toContain('**WARNING**');
    expect(reviewContent).toContain('**INFO**');
    expect(reviewContent).toMatch(/UNCERTAIN[\s\S]{0,60}请求用户决策/);
    expect(reviewContent).toContain('锁定决策（D-ID 覆盖核验');
  });

  test('决策 ID 追溯链：discuss 三分类登记，plan 任务标注与四源审计', () => {
    expect(brainstormContent).toContain('决策 ID 化');
    expect(brainstormContent).toContain('锁定决策');
    expect(brainstormContent).toContain('自由裁量');
    expect(brainstormContent).toContain('排除项（Deferred Ideas）');
    expect(content).toContain('Decisions: <覆盖的锁定决策 D-ID 列表');
    expect(content).toContain('四源覆盖审计');
    expect(content).toContain('无 D-ID 可追溯');
  });

  test('澄清协议：灰区识别、提问节奏与范围守卫', () => {
    expect(brainstormContent).toContain('灰区识别与结构化澄清');
    expect(brainstormContent).toContain('领域边界陈述');
    expect(brainstormContent).toContain('已决查重');
    expect(brainstormContent).toContain('代码上下文标注');
    expect(brainstormContent).toContain('范围蔓延守卫');
    expect(brainstormContent).toContain('canonical refs');
    expect(brainstormContent).toContain('问前研究');
    expect(brainstormContent).toContain('权衡伙伴');
    expect(brainstormContent).toContain('可逆性评级');
    expect(brainstormContent).toContain('one-way');
  });

  test('discuss 优先处理复杂灰区，并要求其他灰区先做方案对比', () => {
    expect(brainstormContent).toMatch(/优先级排序[\s\S]*高优先级或复杂灰区/);
    expect(brainstormContent).toMatch(/默认灰区先讨论[\s\S]*至少 2 个真实可行方案/);
    expect(brainstormContent).toMatch(/选择其他灰区[\s\S]*多选/);
    expect(brainstormContent).toMatch(/逐区讨论[\s\S]*歧义、2–3 个具体方案及对比/);
  });

  test('计划协议：范围缩减禁令、Tracer-First、verify 接地与 truths', () => {
    expect(content).toContain('范围缩减禁令');
    expect(content).toContain('上下文成本');
    expect(content).toContain('绝不静默带缺口定稿');
    expect(content).toContain('Tracer-First 垂直切片');
    expect(content).toContain('架构缺口不允许');
    expect(content).toContain('验证命令接地规则');
    expect(content).toContain('grep 卫生');
    expect(content).toContain('注释文本纪律');
    expect(content).toContain('Preconditions（可选');
    expect(content).toContain('可观察行为（truths）');
    expect(content).toContain('调研深度分级');
    expect(reviewContent).toContain('可观察行为（truths 逐条核验');
  });

  test('轻量适配：spot-check 兜底、检查点与 ledger 摘要', () => {
    expect(buildOceanusPrompt()).toContain('完成通知缺失时');
    expect(OCEANUS_EXECUTE_SKILL.content).toContain('检查点与恢复');
    expect(OCEANUS_EXECUTE_SKILL.content).toContain('stopped_at');
    expect(OCEANUS_EXECUTE_SKILL.content).toContain('state_head');
    expect(OCEANUS_FINISH_SKILL.content).not.toContain('经验沉淀');
    expect(OCEANUS_FINISH_SKILL.content).not.toContain('.oceanus/learnings/');
    expect(content).toContain('state_head');
  });

  test('Trivial 轻量路径支持显式质量升级', () => {
    expect(intakeContent).toContain('升级单项质量保障');
  });

  test('执行配置批问归属 Intake，discuss 只消费配置并执行方案批准', () => {
    expect(intakeContent).toContain('执行配置批问（一问二项');
    expect(intakeContent).toContain('execution_config');
    expect(intakeContent).not.toContain('Oracle 审查');
    expect(intakeContent).toContain('SDD');
    expect(intakeContent).toContain('TDD');
    expect(brainstormContent).toContain('主流程必须有 `intake_report`');
    expect(brainstormContent).toContain('方案总批准');
    expect(brainstormContent).not.toContain('执行配置批问');
  });

  test('批问默认全关，且非实现类任务跳过批问', () => {
    expect(intakeContent).toContain('默认推荐均关闭');
    expect(intakeContent).toContain('非实现类，**跳过批问**');
    expect(intakeContent).toContain('not_asked: non-implementation');
    expect(intakeContent).not.toContain('每阶段结束停顿汇报');
    // 配置项名称不再使用「Oracle 门禁审核」。
    expect(intakeContent).not.toContain('Oracle 门禁审核');
  });

  test('三个 Skill 文本不再引用 metis/momus', () => {
    for (const text of [intakeContent, brainstormContent, content]) {
      expect(text).not.toContain('Metis');
      expect(text).not.toContain('Momus');
      expect(text).not.toContain('@metis');
      expect(text).not.toContain('@momus');
    }
  });

  test('Plan 说明使用中文自然语言', () => {
    expect(content).not.toMatch(/Plan changes after approval|re-run the @oracle/);
  });
  test('覆盖四种人工状态与 question 闭环', () => {
    expect(content).toContain('已批准');
    expect(content).toContain('自查完成');
  });

  test('固定记录 Gate Status 字段', () => {
    expect(content).toContain('计划状态');
    expect(content).toContain('Oracle advisory');
  });

  test('Sisyphus 先做 impact_estimate 且处理缺失覆盖不足', () => {
    expect(content).toContain('impact_estimate');
    expect(content).toContain('影响面使用 CBM/grep/read 自查');
    expect(content).toContain('计划自查');
  });

  test('Plan 变化按需求与验收变化重新规划', () => {
    expect(content).toMatch(/需求或验收标准变化/);
    expect(content).toMatch(/重新确认并修订 spec\/plan/);
  });

  test('需求澄清包含结构化上下文、歧义评分与硬阻塞', () => {
    expect(intakeContent).toContain('requirements_context');
    expect(intakeContent).toContain('需求清晰度门禁');
    expect(intakeContent).toContain('关键字段缺失');
    expect(intakeContent).toContain('assumptions[]');
    expect(intakeContent).toContain('consequence_if_wrong');
  });

  test('discuss 包含假设纠偏、边界探针与双向设计契约', () => {
    expect(brainstormContent).toContain('结构化假设与边界探针');
    expect(brainstormContent).toContain('specified');
    expect(brainstormContent).toContain('backstop');
    expect(brainstormContent).toContain('works_when');
    expect(brainstormContent).toContain('fails_when');
    expect(brainstormContent).toContain('prohibitions');
  });

  test('Plan 包含 Oracle advisory、schema 门禁和三轮修订闭环', () => {
    expect(content).toContain('关键字段 schema 门禁');
    expect(content).toContain('独立 Oracle advisory');
    expect(content).toContain('三轮修订闭环');
    expect(content).toContain('required_property');
  });

  test('Review 复用边界、truths 与 prohibitions 矩阵', () => {
    expect(reviewContent).toContain('edge_coverage');
    expect(reviewContent).toContain('prohibitions');
    expect(reviewContent).toContain('不重新发明验收口径');
  });
});
