import { describe, expect, it } from "bun:test"
import type { ResolvedAgent } from "../../config/extends"
import type { ResolvedConfig } from "../../config/types"
import { assertCanDelegate, assertCanWrite, ToolPermissionError } from "./guards"

// A small fixture builder so tests stay readable without repeating the full ResolvedConfig
// shape. Defaults produce a "safe writable" agent; individual tests override what matters.
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

describe("assertCanWrite", () => {
  describe("#given a writable agent", () => {
    it("#when asserted #then passes silently", () => {
      // given
      const config = makeConfig({ orchestrator: { readonly: false } })
      // when / then
      expect(() => assertCanWrite("orchestrator", config)).not.toThrow()
    })
  })

  describe("#given a readonly agent", () => {
    it("#when asserted #then ToolPermissionError", () => {
      // given
      const config = makeConfig({ explore: { readonly: true } })
      // when / then
      expect(() => assertCanWrite("explore", config)).toThrow(ToolPermissionError)
      expect(() => assertCanWrite("explore", config)).toThrow(/readonly/)
    })
  })

  describe("#given an unknown caller agent", () => {
    it("#when asserted #then ToolPermissionError mentioning 'not found'", () => {
      // given
      const config = makeConfig({ orchestrator: {} })
      // when / then
      expect(() => assertCanWrite("ghost", config)).toThrow(/not found/)
    })
  })
})

describe("assertCanDelegate", () => {
  describe("#given a writable caller delegating to any agent", () => {
    it("#when target is writable #then passes", () => {
      // given
      const config = makeConfig({
        orchestrator: { readonly: false, can_delegate: true },
        other: { readonly: false },
      })
      // when / then
      expect(() => assertCanDelegate("orchestrator", "other", config)).not.toThrow()
    })

    it("#when target is readonly #then passes (writable caller may delegate anywhere)", () => {
      // given
      const config = makeConfig({
        orchestrator: { readonly: false, can_delegate: true },
        explore: { readonly: true },
      })
      // when / then
      expect(() => assertCanDelegate("orchestrator", "explore", config)).not.toThrow()
    })
  })

  describe("#given a caller with can_delegate=false", () => {
    it("#when asserted #then ToolPermissionError regardless of target", () => {
      // given
      const config = makeConfig({
        explore: { can_delegate: false },
        other: { readonly: false },
      })
      // when / then
      expect(() => assertCanDelegate("explore", "other", config)).toThrow(/cannot delegate/)
    })
  })

  describe("#given a readonly caller", () => {
    it("#when target is also readonly #then passes (readonly taint is preserved)", () => {
      // given
      const config = makeConfig({
        reviewer: { readonly: true, can_delegate: true },
        "security-review": { readonly: true },
      })
      // when / then
      expect(() => assertCanDelegate("reviewer", "security-review", config)).not.toThrow()
    })

    it("#when target is writable #then ToolPermissionError (readonly taint violated)", () => {
      // given
      const config = makeConfig({
        reviewer: { readonly: true, can_delegate: true },
        orchestrator: { readonly: false },
      })
      // when / then
      expect(() => assertCanDelegate("reviewer", "orchestrator", config)).toThrow(
        ToolPermissionError,
      )
      expect(() => assertCanDelegate("reviewer", "orchestrator", config)).toThrow(
        /readonly cannot be escaped/,
      )
    })
  })

  describe("#given an unknown caller or target", () => {
    it("#when caller is unknown #then ToolPermissionError", () => {
      // given
      const config = makeConfig({ orchestrator: {} })
      // when / then
      expect(() => assertCanDelegate("ghost", "orchestrator", config)).toThrow(/caller/)
    })

    it("#when target is unknown #then ToolPermissionError", () => {
      // given
      const config = makeConfig({ orchestrator: {} })
      // when / then
      expect(() => assertCanDelegate("orchestrator", "ghost", config)).toThrow(/target/)
    })
  })
})
