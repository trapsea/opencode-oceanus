# Hashline Read 与文件操作增强计划

## 策略

- TDD：先添加失败测试，再实现，再运行定向测试和全量验证。
- 工作区：共享工作区；已有未提交改动不得覆盖。并行任务不能修改相同文件或共享生成物；worker 不执行 git add/commit/reset、branch/worktree 操作，也不修改声明范围外文件。
- CBM：已按计划查询，但因 active account daemon 使用不同 `CBM_CACHE_DIR` 启动失败；按规则降级为 grep/read。

## 任务图

### HL-00（Wave 0）建立基线快照

- Depends on: 无
- Files: 无代码文件；仅 `/tmp/opencode/baseline-hashline-*`
- 目标：在任何 writer 启动前保存 `git status --porcelain=v1`、`git diff --binary HEAD`、tracked/untracked 文件清单与 sha256，以及 `dist` 清单与 sha256；由主 agent 串行完成。写完后计算快照自身 sha256 并 chmod 0444，后续任务不得覆盖。
- 验证：快照文件存在、权限为只读且自身 sha256 可复核；HL-04 先验证其自身哈希未变化。

### HL-01（Wave 2）Read hashline enhancer

- Depends on: HL-00, HL-03A；HL-03A RED 是实现 writer 的 barrier
- Files（唯一写入者）：`src/hooks/hashline-read-enhancer.ts`, `src/hooks/index.ts`, `src/hooks/hashline-read-enhancer.test.ts`；该 hook 始终启用，不新增配置字段，禁用全部 hooks 的既有测试由 HL-03 更新为保留该固定 hook
- 目标：注册 `execute.after` hook，仅当 `event.tool === 'read'`、`event.status === 'completed'` 且 `event.result.content` 为字符串时处理；其它状态、错误、数组/媒体内容原样返回，并保留 `event.result` 的其它字段。`event.input.offset` 缺省为 0；仅接受有限的非负整数，非法值按 0 处理；按宿主 0-based 行偏移，以 `offset + 1` 为首行号，`limit` 缺省/Infinity/负数/NaN/非整数/null/字符串/布尔值不截断，0 输出空内容，有限非负整数取前 N 行，超 EOF 取全部。BOM 作为文件编码标记保留但不计入首行 hash 内容。先剥离可选 BOM，再要求所有非空行（允许空行）完整匹配有效 `N#XX|内容`；仅满足时幂等，否则整段重新格式化，最后恢复 BOM；limit=0 输出严格空字符串。hook 放在 json-error-recovery 之后、tool-output-truncator 之前，并保留后续 hook 顺序。
- TDD/验证：先创建上述测试并运行 `bun test src/hooks/hashline-read-enhancer.test.ts` 记录 RED，再实现并运行同一命令记录 GREEN；`limit` 缺省/Infinity/负数/NaN/非整数不截断，0 输出空内容，有限非负整数取前 N 行，超过 EOF 取全部。覆盖空文件、空行、CRLF/BOM、无末尾换行、offset/limit、重复 hook、截断/非文本结果；after hook 数量/位置断言由 HL-03 更新。

### HL-02（Wave 2）Delete/rename 核心与注册

- Depends on: HL-00, HL-03A；HL-03A RED 是实现 writer 的 barrier
- Files（唯一写入者）：`src/tools/hashline-edit/types.ts`, `src/tools/hashline-edit/text.ts`, `src/tools/hashline-edit/executor.ts`, `src/tools/hashline-edit/index.ts`, `src/tools/hashline-edit/executor.test.ts`, `src/tools/index.ts`
- 目标：工具 schema 固定 `filePath` 必填、`edits` 可选、`delete` 可选 boolean、`rename` 可选 string、既有 `maxFileBytes` 可选 number，顶层与 edit 项均 `additionalProperties:false`；普通编辑要求 edits 非空且无 delete:true/非空 rename，且缺失文件仅在可由 BOF/EOF 无锚点插入创建时允许，否则 `NOT_FOUND`；删除/重命名规则不变。成功字段固定。运行时失败统一为 `{ok:false,path:可归一化源相对路径或 null,changed:false,errorCode,error}`；宿主 schema 校验失败属于宿主拒绝，工具 execute 的 malformed/normalize/parse/锚点越界/重叠/非法 maxFileBytes/互斥失败均 `INVALID_INPUT`。检查优先级固定：输入→root lstat/realpath→源路径 lexical/realpath 越界→源父级 symlink→源存在性/源 symlink→源类型→目标路径 lexical/realpath 越界→目标父级存在/类型/symlink→目标存在/类型/同路径→大小/hash/编辑应用→IO；对应错误码依次为 `INVALID_INPUT|OUTSIDE_WORKSPACE|SYMLINK|NOT_FOUND|DIRECTORY|OUTSIDE_WORKSPACE|NOT_FOUND|SYMLINK|TARGET_EXISTS|DIRECTORY|TARGET_EXISTS|FILE_TOO_LARGE|HASH_MISMATCH|NOOP|IO_ERROR`。成功：delete=`{ok:true,path:源相对路径,changed:true,deleted:true}`，rename=`{ok:true,path:目标相对路径,from:源相对路径,to:目标相对路径,changed:true,renamed:true}`。executor 固定接收 `{root,operation}`，所有检查完成后才操作；普通编辑仍返回 diff/统计。不改变既有行为。测试先 RED 再实现。
- 验证：先创建上述测试并运行 `bun test src/tools/hashline-edit/executor.test.ts` 记录 RED，再实现并运行同一命令记录 GREEN；覆盖 malformed/schema unknown fields、成功字段与 errorCode、源不存在、目标存在/父目录不存在、源目标相同、目录/源和父级/dangling symlink、外部越界、root 缺失/非目录/自身 symlink、混合操作，并断言错误字段和失败后源/目标字节均未改变。注册 schema 测试归 HL-03。

HL-02 固定判定表：所有组件先 lstat，symlink 一律 `SYMLINK`，再做 realpath 越界检查。root 缺失=`NOT_FOUND`/path=null，root 非目录=`DIRECTORY`/path=null；源路径非法/越界=`OUTSIDE_WORKSPACE`/path=null，源父目录缺失=`NOT_FOUND`/源相对路径，源缺失（普通编辑仅无锚点 BOF/EOF insert 时允许创建、delete/rename 一律失败）=`NOT_FOUND`/源相对路径，源目录=`DIRECTORY`/源相对路径；目标路径越界=`OUTSIDE_WORKSPACE`/源相对路径，目标父目录缺失=`NOT_FOUND`/源相对路径，目标父级 symlink=`SYMLINK`/源相对路径，目标目录=`DIRECTORY`/源相对路径，源目标同路径=`TARGET_EXISTS`/源相对路径，目标普通文件或 dangling symlink=`TARGET_EXISTS`/源相对路径；四种组合 `edits+delete:true`、`edits+rename`、`delete:true+rename`、三者同时存在均在输入阶段无条件 `INVALID_INPUT`，不执行任何检查或写入；schema/malformed/normalize/parse/非法 maxFileBytes/互斥/锚点越界/重叠=`INVALID_INPUT`/源相对路径或 null，超限=`FILE_TOO_LARGE`/源相对路径，stale=`HASH_MISMATCH`/源相对路径，无变化=`NOOP`/源相对路径，竞态或其它 fs=`IO_ERROR`/源相对路径。表从左到右首个命中；缺失目标父目录绝不自动创建。`src/tools/index.ts` 移除旧式 root/路径早退，统一通过 executor/错误工厂返回 `ToolResult.content` 中 `{ok:false,path,changed:false,errorCode,error}`；宿主 schema 拒绝发生在 execute 前，不承诺自定义 errorCode。`maxFileBytes` 必须为有限正整数。普通编辑写入采用同目录临时文件、fsync 后原子 rename 替换，失败清理临时文件且原文件字节不变；rename/delete 失败不改变源/目标。

### HL-03A（Wave 1）先行集成测试

- Depends on: HL-00
- Files（Wave 1 唯一写入者）：`src/tooling-integration.test.ts`, `src/tooling-registration.test.ts`, `src/agents/index.test.ts`, `src/smoke/host-smoke.test.ts`
- 目标：只新增集成测试并运行 RED；覆盖 `registersOptionalFileOperationSchema`、`readAnchorCanEditFile`、`preservesReadOffsetAndHookOrder`、`keepsReadonlyAgentsFromFileOperations`、`registersDeleteAndRenameOperations`，以及固定标识为 `hashline_read_enhancer` 的 enhancer 忽略 disabled_hooks 与 hooks.enabled:false 的断言；不修改实现文件。
- 验证：上述测试因功能未实现而失败并记录 RED；仅称 mock Host 集成。

### HL-03B（Wave 2）集成 GREEN 与既有回归

- Depends on: HL-01, HL-02, HL-03A
- Files（交接后唯一写入者）：同 HL-03A 文件列表；HL-03A 终止后交接
- 目标：更新 after hook 数量/索引（全禁用时保留 1 个固定 enhancer），运行并修正测试至 GREEN；断言完整 read→edit、BOM+CRLF+offset/limit、元数据、delete/rename 每个成功字段和全部 errorCode、普通编辑回归。发现实现缺陷则阻塞 HL-04 并新增修复任务。
- 验证：`bun test src/tooling-integration.test.ts src/tooling-registration.test.ts src/agents/index.test.ts src/smoke/host-smoke.test.ts` 全部通过；仅称 mock Host 集成。

### HL-04（Wave 3）最终验证与审计

- Depends on: HL-00, HL-03B
- Files: 无代码文件；仅验证工作区 diff 和命令输出
- 目标：运行全量测试、typecheck、build，确认既有未提交改动未被覆盖，并完成验收矩阵。
- 验证：只读取且不覆盖 HL-00 不可变快照；dist 存在则 tar 完整备份，不存在则写 ABSENT 标记；先运行 bun test/typecheck/diff-check，再运行 build，trap/finally 在成功或失败时恢复 dist（缺失则删除新 dist），所有命令完成且恢复后才生成 final 快照并逐项 sha256 比较。

## Momus 状态

第一轮：REJECT。已修订测试所有权、API schema、边界断言、命令和基线检查。
第二轮：REJECT。已进一步明确 read 事件/offset/hook 顺序、delete/rename 契约、安全实现位置和验收方式，待重新执行独立计划审查。
第三轮：REJECT。已补齐注册 schema 归属、read 输入与重复/BOM规则、realpath 算法、返回字段、精确测试名和基线快照方式，待重新执行独立计划审查。
第四轮：REJECT。已补齐 Wave 0 基线、limit 语义、schema 严格性、目录操作和返回字段，待重新执行独立计划审查。
第五轮：REJECT。已进一步补齐全局 barrier、TDD 阶段、limit 归一化、schema 保留 maxFileBytes、操作返回字段和最终快照隔离。
第六轮：REJECT。已拆分 HL-03A/HL-03B，并补充固定 hook、错误结果、BOM 幂等和 dist 恢复协议。
第七轮：REJECT。Oracle 复审发现 rename 部分成功、CRLF 双换行、错误码/字段/schema/大小边界问题；扩大 HL-02 至 text.ts，待修复后复审。
