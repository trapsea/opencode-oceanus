import { describe, expect, test } from "bun:test"
import { registerAutoUpdate } from "./index"

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function context(events: unknown[]) {
  let index = 0
  let returned = false
  const iterator = {
    async next() {
      if (index < events.length) return { done: false, value: events[index++] }
      await new Promise<void>(() => {})
      return { done: true, value: undefined }
    },
    async return() { returned = true; return { done: true, value: undefined } },
  }
  const iterable = { [Symbol.asyncIterator]: () => iterator }
  return {
    ctx: { event: { subscribe: () => iterable } },
    iterator,
    wasReturned: () => returned,
  }
}

const managedEntry = { file: "/tmp/opencode.json", path: "plugins.0", value: { package: "opencode-oceanus", version: "1.0.0" }, kind: "object" as const, managed: true }
const deps = (overrides: Record<string, unknown> = {}) => ({
  getCacheRoot: () => "/tmp/auto-update-test",
  now: () => 1_000,
  storage: { read: async () => null, write: async () => {} },
  currentVersion: () => "1.0.0",
  checker: async () => "1.1.0",
  discover: () => [managedEntry],
  ...overrides,
})

describe("registerAutoUpdate", () => {
  test("读取 v2 event.data，根会话触发而子会话不触发", async () => {
    const stream = context([
      { type: "session.created", data: { sessionID: "child", parentID: "root" } },
      { type: "session.created", data: { sessionID: "root" } },
    ])
    let checks = 0
    const cleanup = registerAutoUpdate(stream.ctx, undefined, deps({ checker: async () => { checks++; return "1.1.0" } }))
    await tick(); await tick(); await cleanup()
    expect(checks).toBe(1)
  })

  test("重复根会话事件只运行一次", async () => {
    const stream = context([
      { type: "session.created", data: { sessionID: "a" } },
      { type: "session.created", data: { sessionID: "b" } },
    ])
    let checks = 0
    const cleanup = registerAutoUpdate(stream.ctx, undefined, deps({ checker: async () => { checks++; return "1.1.0" } }))
    await tick(); await tick(); await cleanup()
    expect(checks).toBe(1)
  })

  test("disabled 时不订阅且不调用 checker", async () => {
    let subscribed = false; let checks = 0
    const cleanup = registerAutoUpdate({ event: { subscribe: () => { subscribed = true; return context([]).iterator } } }, { autoUpdate: { enabled: false } }, deps({ checker: async () => { checks++; return "1.1.0" } }))
    await tick(); cleanup()
    expect(subscribed).toBe(false); expect(checks).toBe(0)
  })

  test("无 managed pinned 入口时只记录 no_entry", async () => {
    let reads = 0; let checks = 0; let installs = 0
    const stream = context([{ type: "session.created", data: { sessionID: "root" } }])
    const cleanup = registerAutoUpdate(stream.ctx, undefined, deps({ discover: () => [], storage: { read: async () => { reads++; return null }, write: async () => {} }, checker: async () => { checks++; return "1.1.0" }, installer: async () => { installs++ } }))
    await tick(); await cleanup()
    expect(reads).toBe(0); expect(checks).toBe(0); expect(installs).toBe(0)
  })

  test("节流状态命中时不调用 checker", async () => {
    const stream = context([{ type: "session.created", data: { sessionID: "root" } }])
    let checks = 0
    const cleanup = registerAutoUpdate(stream.ctx, undefined, deps({ storage: { read: async () => JSON.stringify({ lastCheckedAt: 900 }), write: async () => {} }, checker: async () => { checks++; return "1.1.0" } }))
    await tick(); await tick(); await cleanup()
    expect(checks).toBe(0)
  })

  test("checker 失败 fail-open 并记录错误日志", async () => {
    const logs: Record<string, unknown>[] = []
    const stream = context([{ type: "session.created", data: { sessionID: "root" } }])
    const cleanup = registerAutoUpdate(stream.ctx, undefined, deps({ checker: async () => { throw new Error("网络失败") }, logger: (event) => logs.push(event) }))
    await tick(); await tick(); await cleanup()
    expect(logs).toContainEqual(expect.objectContaining({ decision: "check_failed", error: "网络失败" }))
  })

  test("update 决策调用 installer 并写入状态", async () => {
    const writes: string[] = []; const installed: string[] = []
    const stream = context([{ type: "session.created", data: { sessionID: "root" } }])
    const cleanup = registerAutoUpdate(stream.ctx, undefined, deps({ storage: { read: async () => null, write: async (_path, value) => writes.push(value) }, installer: async (version) => { installed.push(version) } }))
    await tick(); await tick(); await cleanup()
    expect(installed).toEqual(["1.1.0"])
    expect(JSON.parse(writes.at(-1)!)).toEqual({ lastCheckedAt: 1_000, lastResult: "update_installed" })
  })

  test("cleanup 调用 iterator.return", async () => {
    const stream = context([])
    const cleanup = registerAutoUpdate(stream.ctx, undefined, deps())
    await tick(); await cleanup(); await tick()
    expect(stream.wasReturned()).toBe(true)
  })
})
