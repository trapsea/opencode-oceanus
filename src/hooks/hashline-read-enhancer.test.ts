import { describe, expect, test } from 'bun:test'
import { computeLineHash, formatHashLine } from '../tools/hashline-edit/hash'
import { createHashlineReadEnhancer } from './hashline-read-enhancer'

describe('hashline read enhancer', () => {
  test('按 offset/limit 输出 hashline，保留元数据并去除 BOM', () => {
    const result = { content: '\ufefftwo\nthree', title: 'read', metadata: { x: 1 } }
    const event = { tool: 'read', status: 'completed', input: { offset: 1, limit: 1 }, result, sessionID: 's' }
    createHashlineReadEnhancer()(event as any)
    expect(event.result.content).toContain('2#')
    expect(event.result.content).toContain('|two')
    expect(event.result.content).not.toContain('three')
    expect(event.result.title).toBe('read')
    expect(event.result.metadata).toEqual({ x: 1 })
  })

  test('幂等，不重复增强', () => {
    const event = { tool: 'read', status: 'completed', input: {}, result: { content: 'one\ntwo' } }
    const hook = createHashlineReadEnhancer()
    hook(event as any); const once = event.result.content
    hook(event as any)
    expect(event.result.content).toBe(once)
  })

  test('仅处理 completed 的字符串 content，并保留其它字段', () => {
    const result = { content: 'one', extra: 1 }
    const event = { tool: 'read', status: 'error', result }
    createHashlineReadEnhancer()(event as any)
    expect(result.content).toBe('one')
    event.status = 'completed'
    createHashlineReadEnhancer()(event as any)
    expect(result.content).toContain('1#')
    expect(result.extra).toBe(1)
  })

  test('CRLF 与 BOM 只在文件开头规范化，非法数值不截断', () => {
    const event = { tool: 'read', status: 'completed', input: { offset: 3.8, limit: 2.9 },
      result: { content: '\ufeffa\r\nb\r\nc' } }
    createHashlineReadEnhancer()(event as any)
    expect(event.result.content).toMatch(/^\ufeff1#.*\|a\n2#.*\|b\n3#.*\|c$/)
  })

  test('部分 hashline 不视为已增强', () => {
    const event = { tool: 'read', status: 'completed', result: { content: '1#x|one\ntwo' } }
    createHashlineReadEnhancer()(event as any)
    expect(event.result.content).toMatch(/^1#.*\|1#x\|one\n2#.*\|two$/)
  })

  test('offset 为 0 或缺省时首行编号为 1', () => {
    for (const input of [{ offset: 0 }, {}]) {
      const event = { tool: 'read', status: 'completed', input, result: { content: 'one' } }
      createHashlineReadEnhancer()(event as any)
      expect(event.result.content).toMatch(/^1#.*\|one$/)
    }
  })

  test('limit=0 为空，非法 limit 不截断', () => {
    const empty = { tool: 'read', status: 'completed', input: { limit: 0 }, result: { content: 'one\ntwo' } }
    createHashlineReadEnhancer()(empty as any)
    expect(empty.result.content).toBe('')
    for (const limit of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, null, '1', true]) {
      const event = { tool: 'read', status: 'completed', input: { limit }, result: { content: 'one\ntwo' } }
      createHashlineReadEnhancer()(event as any)
      expect(event.result.content).toContain('|two')
    }
  })

  test('BOM 保留但不参与首行 hash', () => {
    const event = { tool: 'read', status: 'completed', input: {}, result: { content: '\ufeffone' } }
    createHashlineReadEnhancer()(event as any)
    expect(event.result.content).toMatch(/^\ufeff1#.*\|one$/)
  })

  test('纯空行内容不会被误判为已增强', () => {
    const event = { tool: 'read', status: 'completed', input: {}, result: { content: '\n\n' } }
    createHashlineReadEnhancer()(event as any)
    expect(event.result.content).toMatch(/^1#.*\|\n2#.*\|\n3#.*\|$/)
  })

  test('严格识别 hashline 格式，避免合法文本碰撞', () => {
    const event = { tool: 'read', status: 'completed', input: {}, result: { content: '1#x|one' } }
    createHashlineReadEnhancer()(event as any)
    expect(event.result.content).toMatch(/^1#.*\|1#x\|one$/)
  })

  test('BOM、CRLF 与 offset/limit 下重复执行保持首次结果不变', () => {
    const event = { tool: 'read', status: 'completed', input: { offset: 4, limit: 2 },
      result: { content: '\ufeffa\r\nb\r\nc' } }
    const hook = createHashlineReadEnhancer()
    hook(event as any)
    const once = event.result.content
    hook(event as any)
    expect(event.result.content).toBe(once)
    expect(once).toMatch(/^\ufeff5#.*\|a\n6#.*\|b$/)
  })

  test('无效 hashline 混合内容会整段重算', () => {
    const event = { tool: 'read', status: 'completed', input: {}, result: { content: '1#xx|one\n2#yy|two' } }
    createHashlineReadEnhancer()(event as any)
    expect(event.result.content).toMatch(/^1#.*\|1#xx\|one\n2#.*\|2#yy\|two$/)
  })

  test('兼容真实 Host 的 output 包装与 N: 行号', () => {
    const event = {
      tool: 'read', status: 'completed', result: {
        output: '<path>/tmp/demo.ts</path>\n<type>file</type>\n<content>\n1: alpha\n2: beta\n(End of file - total 2 lines)\n</content>',
        metadata: { lineStart: 1 },
      },
    }
    createHashlineReadEnhancer()(event as any)
    expect(event.result.output).toMatch(/<content>\n1#[^|]+\|alpha\n2#[^|]+\|beta\n\(End of file/)
    expect(event.result.metadata).toEqual({ lineStart: 1 })
  })

  test('兼容首行与 content 标签同行的输出', () => {
    const event = {
      tool: 'read', status: 'completed', result: {
        output: '<content>1: alpha\n2: beta</content>',
      },
    }
    createHashlineReadEnhancer()(event as any)
    expect(event.result.output).toMatch(/^<content>1#[^|]+\|alpha\n2#[^|]+\|beta<\/content>$/)
  })

  test('兼容 N| 格式、幂等，并跳过目录与截断文本', () => {
    const event = {
      tool: 'read', status: 'completed', result: {
        output: '<type>file</type>\n<content>\n00001| alpha\n00002| beta (line truncated to 2000 chars)\n</content>',
      },
    }
    const hook = createHashlineReadEnhancer()
    hook(event as any)
    const once = event.result.output
    hook(event as any)
    expect(event.result.output).toBe(once)
    expect(event.result.output).toMatch(/1#[^|]+\|alpha/)
    expect(event.result.output).toContain('00002| beta (line truncated to 2000 chars)')

    const directory = { tool: 'read', status: 'completed', result: { output: '<type>directory</type>\n<entries>\n1: file\n</entries>' } }
    createHashlineReadEnhancer()(directory as any)
    expect(directory.result.output).toContain('1: file')
  })
})

describe('hashline read enhancer：宿主真实格式补充', () => {
  test('input.offset 不影响 output 的宿主真实行号', () => {
    const result = { output: '<content>\n9: \n</content>' }
    const event = { tool: 'read', status: 'completed', input: { offset: 99, limit: 1 }, result }
    createHashlineReadEnhancer()(event as any)
    expect(result.output).toBe(`<content>\n9#${computeLineHash(9, '')}|\n</content>`)
  })

  test('裸 N: 行（无包装）按宿主行号增强，容忍结尾换行', () => {
    const result = { output: '10: \n11: eleven\n' }
    const event = { tool: 'read', status: 'completed', input: { offset: 9 }, result }
    createHashlineReadEnhancer()(event as any)
    expect(result.output).toBe(`${formatHashLine(10, '')}\n${formatHashLine(11, 'eleven')}`)
  })

  test('<file> 包装 + N| 前缀，分隔符后至多剥一个空格', () => {
    const result = { output: '<file path="/a/b.txt">\n5| five\n6|  six\n7|\n</file>' }
    const event = { tool: 'read', status: 'completed', input: {}, result }
    createHashlineReadEnhancer()(event as any)
    expect(result.output).toBe(
      `<file path="/a/b.txt">\n${formatHashLine(5, 'five')}\n${formatHashLine(6, ' six')}\n${formatHashLine(7, '')}\n</file>`
    )
  })

  test('行内容中的内联标签按字面保留', () => {
    const result = { output: '<content>\n1: has </content> inside\n2: <file> tag\n</content>' }
    const event = { tool: 'read', status: 'completed', input: {}, result }
    createHashlineReadEnhancer()(event as any)
    expect(result.output).toBe(
      `<content>\n${formatHashLine(1, 'has </content> inside')}\n${formatHashLine(2, '<file> tag')}\n</content>`
    )
  })

  test('非整行的 <content> 标签不误判（fail-open）', () => {
    const output = 'prefix <content>\n1: x\n</content>'
    const result = { output }
    const event = { tool: 'read', status: 'completed', input: {}, result }
    createHashlineReadEnhancer()(event as any)
    expect(result.output).toBe(output)
  })

  test('幂等：重复执行保持首次结果（output 与 content）', () => {
    const event = {
      tool: 'read', status: 'completed', input: {},
      result: { output: '<content>\n3: \n4: four\n</content>', content: '7: \n8: eight' }
    }
    const hook = createHashlineReadEnhancer()
    hook(event as any)
    const once = { output: event.result.output as string, content: event.result.content as string }
    hook(event as any)
    expect(event.result.output).toBe(once.output)
    expect(event.result.content).toBe(once.content)
  })

  test('目录列表与残缺/含未知行的输出整体 fail-open', () => {
    const dir = { tool: 'read', status: 'completed', input: {}, result: { output: 'src/\ndocs/\nREADME.md' } }
    createHashlineReadEnhancer()(dir as any)
    expect(dir.result.output).toBe('src/\ndocs/\nREADME.md')

    const broken = { tool: 'read', status: 'completed', input: {}, result: { output: '<content>\n1: a\n</file>' } }
    createHashlineReadEnhancer()(broken as any)
    expect(broken.result.output).toBe('<content>\n1: a\n</file>')

    const unknown = {
      tool: 'read', status: 'completed', input: {},
      result: { output: '<content>\n1: a\n2: b\n... truncated ...\n</content>' }
    }
    createHashlineReadEnhancer()(unknown as any)
    expect(unknown.result.output).toBe('<content>\n1: a\n2: b\n... truncated ...\n</content>')
  })

  test('非文本/空 output 不处理；纯文本 content 维持旧逻辑', () => {
    const objectOutput = {
      tool: 'read', status: 'completed', input: {},
      result: { output: { structured: true }, content: 'one' }
    }
    createHashlineReadEnhancer()(objectOutput as any)
    expect(objectOutput.result.output).toEqual({ structured: true })
    expect(objectOutput.result.content).toMatch(/^1#.*\|one$/)

    const emptyOutput = { tool: 'read', status: 'completed', input: {}, result: { output: '', content: 'one' } }
    createHashlineReadEnhancer()(emptyOutput as any)
    expect(emptyOutput.result.output).toBe('')
    expect(emptyOutput.result.content).toMatch(/^1#.*\|one$/)

    const arrayContent = {
      tool: 'read', status: 'completed', input: {},
      result: { content: [{ type: 'text', text: 'one' }] }
    }
    createHashlineReadEnhancer()(arrayContent as any)
    expect(arrayContent.result.content).toEqual([{ type: 'text', text: 'one' }])
  })

  test('文件 BOM 出现在首行内容时不参与 hash', () => {
    const result = { output: '<content>\n1: \ufefffirst\n2: \n</content>' }
    const event = { tool: 'read', status: 'completed', input: { offset: 1 }, result }
    createHashlineReadEnhancer()(event as any)
    expect(result.output).toBe(`<content>\n1#${computeLineHash(1, 'first')}|first\n2#${computeLineHash(2, '')}|\n</content>`)
  })

  test('content 为宿主格式时同样使用真实行号（忽略 input.offset/limit）', () => {
    const result = { content: '3: c\n4: ' }
    const event = { tool: 'read', status: 'completed', input: { offset: 0, limit: 1 }, result }
    createHashlineReadEnhancer()(event as any)
    expect(result.content).toBe(`${formatHashLine(3, 'c')}\n${formatHashLine(4, '')}`)
  })

  test('output 与 content 同时存在时分别增强', () => {
    const result = { output: '<content>\n2: two\n</content>', content: 'x' }
    const event = { tool: 'read', status: 'completed', input: { offset: 1, limit: 1 }, result }
    createHashlineReadEnhancer()(event as any)
    expect(result.output).toBe(`<content>\n${formatHashLine(2, 'two')}\n</content>`)
    expect(result.content).toMatch(/^2#.*\|x$/)
  })
})

describe('hashline read enhancer：真实 Host execute.after 数组 content', () => {
  const readTextEvent = (text: string, input: Record<string, unknown> = {}) => ({
    tool: 'read', status: 'completed', input, result: { content: [{ type: 'text', text }] },
  })
  const firstText = (event: { result: { content: unknown } }): string =>
    (event.result.content as Array<{ text: string }>)[0].text

  test('普通文件数组：保留 `Read file …` 首行，正文按真实行号转换', () => {
    const event = readTextEvent('Read file /tmp/demo.ts, lines 1-2\n1: alpha\n2: beta')
    createHashlineReadEnhancer()(event as any)
    expect(event.result.content).toEqual([
      { type: 'text', text: `Read file /tmp/demo.ts, lines 1-2\n${formatHashLine(1, 'alpha')}\n${formatHashLine(2, 'beta')}` },
    ])
  })

  test('替换式更新：保留 part 与 result 其他字段', () => {
    const result = { content: [{ type: 'text', text: 'Read file /tmp/x.ts, lines 1-1\n1: one', extra: 'keep' }], title: 'read' }
    const event = { tool: 'read', status: 'completed', input: {}, result }
    createHashlineReadEnhancer()(event as any)
    expect(event.result.title).toBe('read')
    expect(event.result.content).toEqual([
      { type: 'text', text: `Read file /tmp/x.ts, lines 1-1\n${formatHashLine(1, 'one')}`, extra: 'keep' },
    ])
  })

  test('分页读取按正文真实行号编号，忽略 input.offset/limit', () => {
    const event = readTextEvent('Read file /tmp/page.ts, lines 5-6\n5: five\n6: six', { offset: 4, limit: 2 })
    createHashlineReadEnhancer()(event as any)
    expect(firstText(event as any)).toBe(
      `Read file /tmp/page.ts, lines 5-6\n${formatHashLine(5, 'five')}\n${formatHashLine(6, 'six')}`
    )
  })

  test('输出截断提示行保留原样，其余正文行增强', () => {
    const event = readTextEvent(
      'Read file /tmp/big.txt, lines 1-2\n1: a\n2: b\n[Output truncated. Continue reading with offset: 3]'
    )
    createHashlineReadEnhancer()(event as any)
    expect(firstText(event as any)).toBe(
      `Read file /tmp/big.txt, lines 1-2\n${formatHashLine(1, 'a')}\n${formatHashLine(2, 'b')}\n[Output truncated. Continue reading with offset: 3]`
    )
  })

  test('单行截断行保留原样，不参与转换', () => {
    const event = readTextEvent('Read file /tmp/long.ts, lines 1-2\n1: aaaa (line truncated to 2000 chars)\n2: b')
    createHashlineReadEnhancer()(event as any)
    const text = firstText(event as any)
    expect(text).toContain('1: aaaa (line truncated to 2000 chars)')
    expect(text).toContain(formatHashLine(2, 'b'))
  })

  test('空文件与无正文输出 fail-open', () => {
    for (const text of ['Read file /tmp/empty.txt, lines 0-0', 'Read file /tmp/empty.txt']) {
      const event = readTextEvent(text)
      createHashlineReadEnhancer()(event as any)
      expect(firstText(event as any)).toBe(text)
    }
  })

  test('目录、图片多 part 与非文本 part fail-open', () => {
    const directory = readTextEvent('Directory /tmp/x\nsrc/\ndocs/\nREADME.md')
    createHashlineReadEnhancer()(directory as any)
    expect(firstText(directory as any)).toBe('Directory /tmp/x\nsrc/\ndocs/\nREADME.md')

    const multiPart = {
      tool: 'read', status: 'completed', input: {},
      result: { content: [
        { type: 'text', text: 'Read file /tmp/i.png, lines 1-1\n1: pixel' },
        { type: 'image', source: { media_type: 'image/png' } },
      ] },
    }
    createHashlineReadEnhancer()(multiPart as any)
    expect(firstText(multiPart as any)).toBe('Read file /tmp/i.png, lines 1-1\n1: pixel')

    const imageOnly = { tool: 'read', status: 'completed', input: {}, result: { content: [{ type: 'image', source: {} }] } }
    createHashlineReadEnhancer()(imageOnly as any)
    expect((imageOnly.result.content as Array<{ type: string }>)[0].type).toBe('image')
  })

  test('非 read 工具不处理数组 content', () => {
    const event = {
      tool: 'bash', status: 'completed', input: {},
      result: { content: [{ type: 'text', text: 'Read file /tmp/a.ts, lines 1-1\n1: a' }] },
    }
    createHashlineReadEnhancer()(event as any)
    expect(firstText(event as any)).toBe('Read file /tmp/a.ts, lines 1-1\n1: a')
  })

  test('异常正文格式 fail-open', () => {
    const event = readTextEvent('Read file /tmp/bad.ts, lines 1-2\n1: a\nnot numbered')
    createHashlineReadEnhancer()(event as any)
    expect(firstText(event as any)).toBe('Read file /tmp/bad.ts, lines 1-2\n1: a\nnot numbered')
  })

  test('幂等：重复执行保持首次增强结果', () => {
    const event = readTextEvent('Read file /tmp/idem.ts, lines 1-2\n1: a\n2: b')
    const hook = createHashlineReadEnhancer()
    hook(event as any)
    const once = firstText(event as any)
    hook(event as any)
    expect(firstText(event as any)).toBe(once)
    expect(once).toBe(`Read file /tmp/idem.ts, lines 1-2\n${formatHashLine(1, 'a')}\n${formatHashLine(2, 'b')}`)
  })

  test('冻结 part 时替换式更新不抛错且生效', () => {
    const part = Object.freeze({ type: 'text', text: 'Read file /tmp/frozen.ts, lines 1-1\n1: cold' })
    const event = { tool: 'read', status: 'completed', input: {}, result: { content: Object.freeze([part]) } }
    createHashlineReadEnhancer()(event as any)
    expect(event.result.content).toEqual([
      { type: 'text', text: `Read file /tmp/frozen.ts, lines 1-1\n${formatHashLine(1, 'cold')}` },
    ])
  })

  test('数组 content 不落入旧 offset/limit 逻辑', () => {
    const event = readTextEvent('Read file /tmp/no-limit.ts, lines 1-2\n1: a\n2: b', { limit: 0 })
    createHashlineReadEnhancer()(event as any)
    expect(firstText(event as any)).toBe(`Read file /tmp/no-limit.ts, lines 1-2\n${formatHashLine(1, 'a')}\n${formatHashLine(2, 'b')}`)
  })

  test('正文内括号注记行保留原样', () => {
    const event = readTextEvent('Read file /tmp/note.ts, lines 1-2\n1: a\n(End of file - total 2 lines)')
    createHashlineReadEnhancer()(event as any)
    expect(firstText(event as any)).toBe(
      `Read file /tmp/note.ts, lines 1-2\n${formatHashLine(1, 'a')}\n(End of file - total 2 lines)`
    )
  })
})
