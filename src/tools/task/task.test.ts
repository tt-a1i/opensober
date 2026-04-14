import { describe, expect, it } from "bun:test"
import type { ResolvedAgent } from "../../config/extends"
import type { ResolvedConfig } from "../../config/types"
import { ToolPermissionError } from "../common/guards"
import type { ToolDependencies } from "../index"
import { BackgroundTaskManager } from "./manager"
import { createTaskTool, formatTaskNotification } from "./task"

function makeConfig(agents: Record<string, Partial<ResolvedAgent>>): ResolvedConfig {
  const full: Record<string, ResolvedAgent> = {}
  for (const [name, partial] of Object.entries(agents)) {
    full[name] = {
      readonly: false,
      can_delegate: true,
      model: "test/model",
      ...partial,
    }
  }
  return {
    version: 1,
    agents: full,
    tools: { disabled: [] },
    hooks: { disabled: [] },
    mcp: { disabled: [] },
    skills: { disabled: [], paths: [] },
    claude_code: { commands: true, skills: true, agents: true, mcp: true, hooks: true },
    logging: { level: "info" },
    experimental: {},
  }
}

function fakeCtx(agent: string) {
  return {
    sessionID: "parent-session",
    messageID: "m",
    agent,
    directory: "/tmp",
    worktree: "/tmp",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

/**
 * Mock client that simulates a successful child session.
 * Status goes busy → idle. Messages return one assistant text.
 */
function makeMockDeps(text = "child agent output"): ToolDependencies {
  let statusCalls = 0
  // biome-ignore lint/suspicious/noExplicitAny: test mock needs flexible shape
  const client: any = {
    session: {
      create: async () => ({ data: { id: "child-test-id" } }),
      promptAsync: async () => ({ data: undefined }),
      status: async () => {
        statusCalls++
        return { data: { "child-test-id": { type: statusCalls >= 2 ? "idle" : "busy" } } }
      },
      messages: async () => ({
        data: [
          {
            info: {
              role: "assistant",
              modelID: "test-model",
              providerID: "test-provider",
              cost: 0.001,
              tokens: { input: 100, output: 50 },
            },
            parts: [{ type: "text", text }],
          },
        ],
      }),
      abort: async () => ({ data: undefined }),
    },
  }
  return { client, backgroundManager: new BackgroundTaskManager(client, { pollIntervalMs: 50 }) }
}

/**
 * Mock deps with a background manager that has a pre-registered task.
 */
function makeMockDepsWithTask(
  taskOverrides: {
    status?: "running" | "completed" | "error" | "timeout" | "cancelled"
    result?: string
    model?: string
    error?: string
  } = {},
): ToolDependencies {
  const deps = makeMockDeps()
  // Directly manipulate the manager to register a task for testing query/cancel.
  const manager = deps.backgroundManager
  // Launch a task so it exists in the manager.
  manager.launch("bg-task-1", "parent-session", "explore")
  // Override status/result if needed.
  const task = manager.getTask("bg-task-1")
  if (task) {
    if (taskOverrides.status) task.status = taskOverrides.status
    if (taskOverrides.result !== undefined) task.result = taskOverrides.result
    if (taskOverrides.model !== undefined) task.model = taskOverrides.model
    if (taskOverrides.error !== undefined) task.error = taskOverrides.error
    if (taskOverrides.status && taskOverrides.status !== "running") {
      task.durationMs = 5000
    }
  }
  return deps
}

describe("createTaskTool — permission checks (guard layer)", () => {
  describe("#given readonly caller and writable target", () => {
    it("#when invoked #then ToolPermissionError before any session call", async () => {
      // given
      const task = createTaskTool(
        makeConfig({
          reviewer: { readonly: true, can_delegate: true },
          orchestrator: { readonly: false },
        }),
        makeMockDeps(),
      )
      // when / then
      await expect(
        task.execute({ agent: "orchestrator", prompt: "escape" }, fakeCtx("reviewer")),
      ).rejects.toThrow(ToolPermissionError)
    })
  })

  describe("#given caller with can_delegate=false", () => {
    it("#when invoked #then ToolPermissionError", async () => {
      // given
      const task = createTaskTool(
        makeConfig({
          explore: { can_delegate: false },
          orchestrator: { readonly: false },
        }),
        makeMockDeps(),
      )
      // when / then
      await expect(
        task.execute({ agent: "orchestrator", prompt: "oops" }, fakeCtx("explore")),
      ).rejects.toThrow(/cannot delegate/)
    })
  })

  describe("#given unknown target", () => {
    it("#when invoked #then ToolPermissionError", async () => {
      // given
      const task = createTaskTool(
        makeConfig({ orchestrator: { readonly: false, can_delegate: true } }),
        makeMockDeps(),
      )
      // when / then
      await expect(
        task.execute({ agent: "ghost", prompt: "?" }, fakeCtx("orchestrator")),
      ).rejects.toThrow(/target/)
    })
  })
})

describe("createTaskTool — successful execution", () => {
  describe("#given writable caller and writable target with mock client", () => {
    it("#when invoked #then returns structured 'task completed' output with child text", async () => {
      // given
      const task = createTaskTool(
        makeConfig({
          orchestrator: { readonly: false, can_delegate: true },
          other: { readonly: false },
        }),
        makeMockDeps("hello from child"),
      )
      // when
      const out = await task.execute(
        { agent: "other", prompt: "do a thing" },
        fakeCtx("orchestrator"),
      )
      // then
      expect(out).toContain("task completed")
      expect(out).toContain("caller")
      expect(out).toContain("orchestrator")
      expect(out).toContain("target")
      expect(out).toContain("other")
      expect(out).toContain("child session")
      expect(out).toContain("child-test-id")
      expect(out).toContain("hello from child")
    })
  })

  describe("#given readonly caller and readonly target", () => {
    it("#when invoked #then succeeds (readonly taint preserved)", async () => {
      // given
      const task = createTaskTool(
        makeConfig({
          reviewer: { readonly: true, can_delegate: true },
          "security-review": { readonly: true },
        }),
        makeMockDeps("audit result"),
      )
      // when
      const out = await task.execute(
        { agent: "security-review", prompt: "audit this" },
        fakeCtx("reviewer"),
      )
      // then
      expect(out).toContain("task completed")
      expect(out).toContain("audit result")
    })
  })
})

describe("createTaskTool — background launch", () => {
  describe("#given background=true", () => {
    it("#when invoked #then returns immediately with task_id", async () => {
      // given
      const task = createTaskTool(
        makeConfig({
          orchestrator: { readonly: false, can_delegate: true },
          explore: { readonly: false },
        }),
        makeMockDeps(),
      )
      // when
      const out = await task.execute(
        { agent: "explore", prompt: "find files", background: true },
        fakeCtx("orchestrator"),
      )
      // then
      expect(out).toContain("background task launched")
      expect(out).toContain("task_id")
      expect(out).toContain("child-test-id")
      expect(out).toContain("explore")
      expect(out).toContain("notified when it completes")
    })
  })

  describe("#given background=true with model override", () => {
    it("#when invoked #then model is parsed and included in output", async () => {
      // given
      let capturedBody: Record<string, unknown> = {}
      const deps = makeMockDeps()
      // biome-ignore lint/suspicious/noExplicitAny: test mock override
      ;(deps.client as any).session.promptAsync = async (opts: {
        body: Record<string, unknown>
      }) => {
        capturedBody = opts.body
        return { data: undefined }
      }
      const task = createTaskTool(
        makeConfig({
          orchestrator: { readonly: false, can_delegate: true },
          explore: { readonly: false },
        }),
        deps,
      )
      // when
      const out = await task.execute(
        {
          agent: "explore",
          prompt: "find files",
          background: true,
          model: "anthropic/claude-sonnet-4-6",
        },
        fakeCtx("orchestrator"),
      )
      // then
      expect(out).toContain("anthropic/claude-sonnet-4-6")
      expect(capturedBody.model).toEqual({
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
      })
    })
  })
})

describe("createTaskTool — query mode", () => {
  describe("#given a running background task", () => {
    it("#when queried #then returns running status with elapsed time", async () => {
      // given
      const deps = makeMockDepsWithTask({ status: "running" })
      const task = createTaskTool(
        makeConfig({ orchestrator: { readonly: false, can_delegate: true } }),
        deps,
      )
      // when
      const out = await task.execute({ task_id: "bg-task-1" }, fakeCtx("orchestrator"))
      // then
      expect(out).toContain("background task status")
      expect(out).toContain("bg-task-1")
      expect(out).toContain("running")
    })
  })

  describe("#given a completed background task", () => {
    it("#when queried #then returns result text", async () => {
      // given
      const deps = makeMockDepsWithTask({
        status: "completed",
        result: "found 42 test files",
        model: "anthropic/claude-sonnet-4-6",
      })
      const task = createTaskTool(
        makeConfig({ orchestrator: { readonly: false, can_delegate: true } }),
        deps,
      )
      // when
      const out = await task.execute({ task_id: "bg-task-1" }, fakeCtx("orchestrator"))
      // then
      expect(out).toContain("background task status")
      expect(out).toContain("completed")
      expect(out).toContain("found 42 test files")
      expect(out).toContain("anthropic/claude-sonnet-4-6")
    })
  })

  describe("#given an unknown task_id", () => {
    it("#when queried #then throws error", async () => {
      // given
      const task = createTaskTool(
        makeConfig({ orchestrator: { readonly: false, can_delegate: true } }),
        makeMockDeps(),
      )
      // when / then
      await expect(
        task.execute({ task_id: "nonexistent" }, fakeCtx("orchestrator")),
      ).rejects.toThrow(/unknown task_id/)
    })
  })
})

describe("createTaskTool — cancel mode", () => {
  describe("#given a running background task", () => {
    it("#when cancel=true #then returns success message", async () => {
      // given
      const deps = makeMockDepsWithTask({ status: "running" })
      const task = createTaskTool(
        makeConfig({ orchestrator: { readonly: false, can_delegate: true } }),
        deps,
      )
      // when
      const out = await task.execute(
        { task_id: "bg-task-1", cancel: true },
        fakeCtx("orchestrator"),
      )
      // then
      expect(out).toContain("bg-task-1 cancelled")
    })
  })

  describe("#given a non-running background task", () => {
    it("#when cancel=true #then returns not found or already finished", async () => {
      // given
      const deps = makeMockDepsWithTask({ status: "completed", result: "done" })
      const task = createTaskTool(
        makeConfig({ orchestrator: { readonly: false, can_delegate: true } }),
        deps,
      )
      // when
      const out = await task.execute(
        { task_id: "bg-task-1", cancel: true },
        fakeCtx("orchestrator"),
      )
      // then
      expect(out).toContain("not found or already finished")
    })
  })
})

describe("createTaskTool — invalid args", () => {
  describe("#given no agent and no task_id", () => {
    it("#when invoked #then throws validation error", async () => {
      // given
      const task = createTaskTool(
        makeConfig({ orchestrator: { readonly: false, can_delegate: true } }),
        makeMockDeps(),
      )
      // when / then
      await expect(task.execute({}, fakeCtx("orchestrator"))).rejects.toThrow()
    })
  })
})

describe("createTaskTool — model parse error", () => {
  describe("#given invalid model string without slash", () => {
    it("#when invoked #then throws error about format", async () => {
      // given
      const task = createTaskTool(
        makeConfig({
          orchestrator: { readonly: false, can_delegate: true },
          explore: { readonly: false },
        }),
        makeMockDeps(),
      )
      // when / then
      await expect(
        task.execute(
          { agent: "explore", prompt: "test", model: "no-slash-here" },
          fakeCtx("orchestrator"),
        ),
      ).rejects.toThrow(/invalid model format/)
    })
  })

  describe("#given model string with empty provider", () => {
    it("#when invoked #then throws error about format", async () => {
      // given
      const task = createTaskTool(
        makeConfig({
          orchestrator: { readonly: false, can_delegate: true },
          explore: { readonly: false },
        }),
        makeMockDeps(),
      )
      // when / then
      await expect(
        task.execute(
          { agent: "explore", prompt: "test", model: "/model-only" },
          fakeCtx("orchestrator"),
        ),
      ).rejects.toThrow(/invalid model format/)
    })
  })
})

describe("createTaskTool — arg validation (tightened)", () => {
  const makeTask = () =>
    createTaskTool(
      makeConfig({ orchestrator: { readonly: false, can_delegate: true }, explore: {} }),
      makeMockDeps(),
    )

  it("rejects task_id with model", async () => {
    await expect(
      makeTask().execute(
        { task_id: "x", model: "anthropic/claude-sonnet-4-6" },
        fakeCtx("orchestrator"),
      ),
    ).rejects.toThrow(/only 'task_id' and 'cancel'/)
  })

  it("rejects task_id with background=true", async () => {
    await expect(
      makeTask().execute({ task_id: "x", background: true }, fakeCtx("orchestrator")),
    ).rejects.toThrow(/only 'task_id' and 'cancel'/)
  })

  it("rejects task_id with agent", async () => {
    await expect(
      makeTask().execute({ task_id: "x", agent: "explore" }, fakeCtx("orchestrator")),
    ).rejects.toThrow(/only 'task_id' and 'cancel'/)
  })

  it("rejects cancel without task_id", async () => {
    await expect(
      makeTask().execute(
        { agent: "explore", prompt: "test", cancel: true },
        fakeCtx("orchestrator"),
      ),
    ).rejects.toThrow(/'cancel' requires 'task_id'/)
  })
})

describe("createTaskTool — query running task includes cancel hint", () => {
  it("shows 'To cancel:' for running tasks", async () => {
    const deps = makeMockDepsWithTask({ status: "running" })
    const task = createTaskTool(
      makeConfig({ orchestrator: { readonly: false, can_delegate: true } }),
      deps,
    )
    const out = await task.execute({ task_id: "bg-task-1" }, fakeCtx("orchestrator"))
    expect(out).toContain("To cancel:")
    expect(out).toContain("bg-task-1")
  })
})

describe("formatTaskNotification", () => {
  it("says '[Background task completed]' for completed tasks", () => {
    const out = formatTaskNotification({
      childSessionID: "c1",
      parentSessionID: "p1",
      targetAgent: "explore",
      startedAt: Date.now() - 5000,
      status: "completed",
      result: "found 10 files",
      model: "anthropic/claude-sonnet-4-6",
      durationMs: 5000,
    })
    expect(out).toContain("[Background task completed]")
    expect(out).toContain("anthropic/claude-sonnet-4-6")
    expect(out).toContain('task({ task_id: "c1" })')
    expect(out).not.toContain("found 10 files")
  })

  it("says '[Background task error]' for error tasks", () => {
    const out = formatTaskNotification({
      childSessionID: "c2",
      parentSessionID: "p1",
      targetAgent: "explore",
      startedAt: Date.now() - 3000,
      status: "error",
      error: "provider auth failed",
      durationMs: 3000,
    })
    expect(out).toContain("[Background task error]")
    expect(out).toContain("provider auth failed")
  })

  it("says '[Background task timeout]' for timed-out tasks", () => {
    const out = formatTaskNotification({
      childSessionID: "c3",
      parentSessionID: "p1",
      targetAgent: "explore",
      startedAt: Date.now() - 900000,
      status: "timeout",
      error: "exceeded 900s timeout",
      durationMs: 900000,
    })
    expect(out).toContain("[Background task timeout]")
    expect(out).toContain("exceeded 900s timeout")
  })
})
