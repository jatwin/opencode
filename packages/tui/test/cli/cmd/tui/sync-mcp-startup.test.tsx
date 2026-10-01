/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { tmpdir } from "../../../fixture/fixture"
import { json, mount, wait } from "./sync-fixture"

test.each(["/mcp", "/command", "/experimental/resource"])(
  "startup completes while %s is still pending",
  async (path) => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const pending = Promise.withResolvers<Response>()
    const requested = new Set<string>()
    const mounted = mount((url) => {
      requested.add(url.pathname)
      if (url.pathname === path) return pending.promise
      return undefined
    }, tmp.path)

    try {
      const { app, sync } = await mounted
      try {
        expect(requested.has(path)).toBe(true)
        expect(sync.status).toBe("complete")
        expect(sync.ready).toBe(true)
        if (path === "/mcp") expect(sync.data.mcp_loading).toBe(true)
        const data =
          path === "/mcp"
            ? { delayed: { status: "needs_auth" } }
            : path === "/command"
              ? [{ name: "delayed", template: "MCP prompt" }]
              : { delayed: { name: "delayed", uri: "test://resource", client: "delayed" } }
        pending.resolve(json(data))
        await wait(() => {
          if (path === "/mcp") return sync.data.mcp.delayed?.status === "needs_auth"
          if (path === "/command") return sync.data.command[0]?.name === "delayed"
          return sync.data.mcp_resource.delayed?.uri === "test://resource"
        })
        expect(sync.status).toBe("complete")
        if (path === "/mcp") expect(sync.data.mcp_loading).toBe(false)
      } finally {
        app.renderer.destroy()
      }
    } finally {
      pending.resolve(json(path === "/command" ? [] : {}))
    }
  },
)

test("startup completes when all MCP hydration requests fail", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const { app, sync } = await mount((url) => {
    if (["/mcp", "/command", "/experimental/resource"].includes(url.pathname)) {
      return json({ message: "MCP unavailable" }, { status: 503 })
    }
    return undefined
  }, tmp.path)

  try {
    expect(sync.status).toBe("complete")
    await wait(() => !sync.data.mcp_loading)
    expect(sync.data.mcp).toEqual({})
    expect(sync.data.command).toEqual([])
    expect(sync.data.mcp_resource).toEqual({})
  } finally {
    app.renderer.destroy()
  }
})

test("late MCP responses from a previous bootstrap are ignored", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const paths = ["/mcp", "/command", "/experimental/resource"]
  const pending = paths.map((path) => ({ path, ...Promise.withResolvers<Response>() }))
  const requested = new Map<string, number>()
  const { app, emit, sync } = await mount((url) => {
    const deferred = pending.find((item) => item.path === url.pathname)
    if (!deferred) return undefined
    const count = (requested.get(url.pathname) ?? 0) + 1
    requested.set(url.pathname, count)
    if (count === 1) return deferred.promise
    if (url.pathname === "/mcp") return json({ current: { status: "connected" } })
    if (url.pathname === "/command") return json([{ name: "current", template: "current" }])
    return json({ current: { name: "current", uri: "test://current", client: "current" } })
  }, tmp.path)

  try {
    expect(sync.data.mcp_loading).toBe(true)
    emit({
      directory: "/tmp/opencode/packages/tui",
      project: "proj_test",
      payload: {
        id: "evt_disposed",
        type: "server.instance.disposed",
        properties: { directory: "/tmp/opencode/packages/tui" },
      },
    })
    await wait(
      () =>
        sync.data.mcp.current?.status === "connected" &&
        sync.data.command[0]?.name === "current" &&
        sync.data.mcp_resource.current?.uri === "test://current",
    )
    for (const item of pending) {
      item.resolve(json(item.path === "/command" ? [{ name: "stale", template: "stale" }] : {}))
    }
    await Bun.sleep(30)
    expect(sync.data.mcp).toEqual({ current: { status: "connected" } })
    expect(sync.data.command[0]?.name).toBe("current")
    expect(sync.data.mcp_resource.current?.uri).toBe("test://current")
    expect(sync.data.mcp_loading).toBe(false)
  } finally {
    pending.forEach((item) => item.resolve(json(item.path === "/command" ? [] : {})))
    app.renderer.destroy()
  }
})
