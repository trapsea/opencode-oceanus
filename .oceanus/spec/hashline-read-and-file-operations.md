# Hashline Read 与文件操作增强设计

## 目标

对齐 oh-my-openagent 的核心使用链路：`read` 成功读取文本后提供稳定的行号/hash 锚点，Fixer 可据此调用 `hashline_edit`；同时补充受约束的文件删除和重命名能力。

## 已确认决策

- 采用 RED→GREEN 测试策略。
- 使用当前共享工作区；所有并行任务严格遵守文件所有权，不执行 git/index/worktree 操作。
- read 只增强成功的文本内容；错误、媒体、二进制和非文本内容保持不变。
- read 输出必须保留真实文件行号，不能因 offset/limit 从 1 重新编号。
- delete/rename 是破坏性操作，禁止与普通内容编辑混合。
- rename 默认拒绝覆盖已存在目标，源/目标都必须位于当前工作区。
- 不伪称真实模型 E2E；无 Host 时使用 mock Host 集成测试并明确边界。

## Metis 分析

### 需求缺口

- 需要固定 read hook 的事件和文本内容处理范围。
- 需要固定 delete/rename 字段、目标路径和失败行为。
- 需要区分 Agent 定义/权限测试与真实 Host/模型 E2E。

### 风险

- offset、CRLF、BOM、末尾换行可能造成 hash 锚点错位。
- hook 与截断 hook 的顺序可能破坏行标识或输出上限。
- 路径穿越、符号链接逃逸、rename 覆盖和部分成功风险。

### 边界与非目标

- 不重实现宿主 read，不处理图片/PDF/二进制。
- 不改变既有 replace/append/prepend 兼容行为。
- 不支持工作区外路径、目录操作、覆盖 rename 目标或混合事务操作。

### 反例与边界条件

- 空文件、空行、CRLF/BOM、无末尾换行。
- read 错误、内容数组、重复 hook、截断文本。
- `../outside`、外部绝对路径、外部符号链接。
- delete/rename 缺字段、源不存在、目标存在、目标父目录不存在。

### 验收标准

- read 文本行输出稳定为 `N#XX|内容`，N 为真实行号，XX 与内容匹配。
- 从 read 输出复制锚点后能成功编辑；stale anchor 拒绝写入。
- delete/rename 对 malformed、越界、覆盖目标输入返回结构化错误。
- 普通编辑行为不回归；Agent 权限矩阵保持只读 Agent 禁止写入。
- 通过相关 Bun 测试、typecheck 和 build。
