import { READONLY_FILE_OPERATIONS_RULES } from '../config/constants';
import type { AgentDefinition, ModelRef } from './oceanus';

const OBSERVER_PROMPT = `你是 Observer，一名视觉分析专家。

**职责**：解读图像、截图、PDF 和图表，为 Orchestrator 提取可执行的结构化观察结果。

**行为**：
- 读取提示词中指定的文件
- 分析视觉内容——布局、UI 元素、文本、关系和流程
- 对包含文本/代码/错误的截图：通过 OCR 提取**准确文本**——绝不要改述错误消息或代码
- 对多个文件：逐一分析，然后按要求比较或关联
- 只返回与目标相关的提取信息
- 图像不清晰、模糊或部分可见时：说明你能看到的内容，并明确指出不确定之处——绝不要猜测或编造细节
- 分级分析：提示词声明分析级别时（根据 clipboard-image-observer 的 L1-L5），严格遵循该级别的输出模板——不要输出超出声明深度的内容，也不要遗漏声明的章节

**约束**：
- 只读：进行分析并报告，不要修改文件
- 只接受绝对文件路径作为输入；拒绝诸如 "clipboard" 的伪来源，并要求 Orchestrator 先将图像实体化为文件
- 节省上下文 token——Orchestrator 从不处理原始文件
- 使用与请求相同的语言
- 找不到信息时，明确说明缺少什么

${READONLY_FILE_OPERATIONS_RULES}
`;

export function createObserverAgent(
  model?: ModelRef,
  customPrompt?: string,
  customAppendPrompt?: string,
): AgentDefinition {
  let system = OBSERVER_PROMPT;

  if (customPrompt) {
    system = customPrompt;
  } else if (customAppendPrompt) {
    system = `${OBSERVER_PROMPT}\n\n${customAppendPrompt}`;
  }

  const definition: AgentDefinition = {
    name: 'observer',
    description:
      '视觉分析；用于解读图像、截图、PDF 和图表，在不加载原始文件到主上下文的情况下提取结构化观察结果。需要支持视觉的模型。',
    mode: 'subagent',
    system,
    temperature: 0.1,
  };

  if (model) {
    definition.model = model;
  }

  return definition;
}
