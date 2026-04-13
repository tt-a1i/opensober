import { describe, expect, it } from "bun:test"
import type { ResolvedAgent } from "../../config/extends"
import type { ResolvedConfig } from "../../config/types"
import { ToolPermissionError } from "../common/guards"
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
    tools: {},
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
    sessionID: "s",
    messageID: "m",
    agent,
    directory: "/tmp",
    worktree: "/tmp",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

describe("createTaskTool — permission matrix", () => {
  describe("#given writable caller and writable target", () => {
    it("#when invoked #then stub acknowledgement is returned with structured fields", async () => {
      // given
      const task = createTaskTool(
        makeConfig({
          orchestrator: { readonly: false, can_delegate: true },
          other: { readonly: false },
        }),
      )
      // when
      const out = await task.execute(
        { agent: "other", prompt: "do a thing" },
        fakeCtx("orchestrator"),
      )
      // then
      expect(out).toContain("task (stub")
      expect(out).toContain("caller:          orchestrator")
      expect(out).toContain("target:          other")
      expect(out).toContain(`prompt:          "do a thing"`)
      expect(out).toContain("permission:      passed")
      expect(out).toContain("readonly taint:  respected")
      expect(out).toContain("Do NOT assume the work was done")
    })
  })

  describe("#given a long prompt", () => {
    it("#when invoked #then the prompt preview is truncated with an ellipsis", async () => {
      // given
      const task = createTaskTool(
        makeConfig({
          orchestrator: { readonly: false, can_delegate: true },
          other: { readonly: false },
        }),
      )
      const longPrompt = "a".repeat(200)
      // when
      const out = await task.execute(
        { agent: "other", prompt: longPrompt },
        fakeCtx("orchestrator"),
      )
      // then
      expect(out).toContain("…")
      // First 80 chars of the prompt should appear verbatim.
      expect(out).toContain("a".repeat(80))
    })
  })

  describe("#given writable caller and readonly target", () => {
    it("#when invoked #then succeeds (writable -> readonly is allowed)", async () => {
      // given
      const task = createTaskTool(
        makeConfig({
          orchestrator: { readonly: false, can_delegate: true },
          explore: { readonly: true },
        }),
      )
      // when / then
      await expect(
        task.execute({ agent: "explore", prompt: "read stuff" }, fakeCtx("orchestrator")),
      ).resolves.toContain("target:          explore")
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
      )
      // when / then
      await expect(
        task.execute({ agent: "security-review", prompt: "audit this" }, fakeCtx("reviewer")),
      ).resolves.toContain("task (stub")
    })
  })

  describe("#given readonly caller and WRITABLE target", () => {
    it("#when invoked #then ToolPermissionError (readonly cannot be escaped)", async () => {
      // given
      const task = createTaskTool(
        makeConfig({
          reviewer: { readonly: true, can_delegate: true },
          orchestrator: { readonly: false },
        }),
      )
      // when / then
      await expect(
        task.execute({ agent: "orchestrator", prompt: "escape" }, fakeCtx("reviewer")),
      ).rejects.toThrow(ToolPermissionError)
    })
  })

  describe("#given caller with can_delegate=false", () => {
    it("#when invoked #then ToolPermissionError regardless of target", async () => {
      // given
      const task = createTaskTool(
        makeConfig({
          explore: { can_delegate: false },
          orchestrator: { readonly: false },
        }),
      )
      // when / then
      await expect(
        task.execute({ agent: "orchestrator", prompt: "oops" }, fakeCtx("explore")),
      ).rejects.toThrow(/cannot delegate/)
    })
  })

  describe("#given an unknown target", () => {
    it("#when invoked #then ToolPermissionError mentioning 'target'", async () => {
      // given
      const task = createTaskTool(
        makeConfig({ orchestrator: { readonly: false, can_delegate: true } }),
      )
      // when / then
      await expect(
        task.execute({ agent: "ghost", prompt: "?" }, fakeCtx("orchestrator")),
      ).rejects.toThrow(/target/)
    })
  })
})
