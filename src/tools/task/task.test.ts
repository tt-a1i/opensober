import { describe, expect, it } from "bun:test"
import type { ResolvedAgent } from "../../config/extends"
import type { ResolvedConfig } from "../../config/types"
import { ToolPermissionError } from "../common/guards"
import type { ToolDependencies } from "../index"
import { createTaskTool } from "./task"

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
  return { client }
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
