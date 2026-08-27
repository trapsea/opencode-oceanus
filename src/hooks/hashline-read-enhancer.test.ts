import { describe, expect, test } from 'bun:test'
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
})
