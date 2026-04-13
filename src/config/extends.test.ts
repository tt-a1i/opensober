import { describe, expect, it } from "bun:test"
import { ExtendsCycleError, ExtendsError, resolveAgents } from "./extends"
import type { AgentDefinition } from "./schema"

const GLOBAL_MODEL = "anthropic/claude-opus-4-6"

describe("resolveAgents — built-ins", () => {
  describe("#given no user agents and a global model", () => {
    it("#when resolved #then all 3 builtins are present with their baseline permissions", () => {
      // when
      const result = resolveAgents({}, GLOBAL_MODEL)
      // then
      expect(Object.keys(result).sort()).toEqual(["explore", "orchestrator", "reviewer"])
      expect(result.orchestrator).toMatchObject({
        readonly: false,
        can_delegate: true,
        model: GLOBAL_MODEL,
      })
      expect(result.explore).toMatchObject({
        readonly: true,
        can_delegate: false,
        model: GLOBAL_MODEL,
      })
      expect(result.reviewer).toMatchObject({
        readonly: true,
        can_delegate: true,
        model: GLOBAL_MODEL,
      })
    })
  })

  describe("#given no user agents and no global model", () => {
    it("#when resolved #then ExtendsError (no model anywhere)", () => {
      // when / then
      expect(() => resolveAgents({}, undefined)).toThrow(ExtendsError)
      expect(() => resolveAgents({}, undefined)).toThrow(/has no model/)
    })
  })

  describe("#given builtins keep their baseline tools", () => {
    it("#when resolved #then explore retains its allowlist", () => {
      // when
      const result = resolveAgents({}, GLOBAL_MODEL)
      // then
      expect(result.explore?.tools?.allow).toContain("grep")
      expect(result.explore?.tools?.allow).toContain("glob")
    })
  })
})

describe("resolveAgents — rule 7 (shallow merge user over baseline)", () => {
  describe("#given user overrides only orchestrator's description", () => {
    it("#when resolved #then description changes but readonly/can_delegate persist from baseline", () => {
      // given
      const userAgents = {
        orchestrator: { description: "my custom orchestrator" } as AgentDefinition,
      }
      // when
      const result = resolveAgents(userAgents, GLOBAL_MODEL)
      // then
      expect(result.orchestrator?.description).toBe("my custom orchestrator")
      expect(result.orchestrator?.readonly).toBe(false)
      expect(result.orchestrator?.can_delegate).toBe(true)
    })
  })

  describe("#given user explicitly flips orchestrator.readonly to true", () => {
    it("#when resolved #then orchestrator.readonly = true (explicit override wins)", () => {
      // given
      const userAgents = { orchestrator: { readonly: true } as AgentDefinition }
      // when
      const result = resolveAgents(userAgents, GLOBAL_MODEL)
      // then
      expect(result.orchestrator?.readonly).toBe(true)
    })
  })
})

describe("resolveAgents — extends chain", () => {
  describe("#given a user agent that extends orchestrator", () => {
    it("#when resolved #then it inherits readonly/can_delegate and uses its own model", () => {
      // given
      const userAgents = {
        quick: { extends: "orchestrator", model: "openai/gpt-5-mini" } as AgentDefinition,
      }
      // when
      const result = resolveAgents(userAgents, GLOBAL_MODEL)
      // then
      expect(result.quick).toMatchObject({
        readonly: false,
        can_delegate: true,
        model: "openai/gpt-5-mini",
      })
    })
  })

  describe("#given a user agent with no extends and no model", () => {
    it("#when resolved with a global model #then implicit defaults + global model", () => {
      // given
      const userAgents = { naked: {} as AgentDefinition }
      // when
      const result = resolveAgents(userAgents, GLOBAL_MODEL)
      // then
      expect(result.naked).toMatchObject({
        readonly: false,
        can_delegate: true,
        model: GLOBAL_MODEL,
      })
    })
  })

  describe("#given a multi-level chain leaf -> mid -> orchestrator", () => {
    it("#when resolved #then leaf inherits mid's overrides on top of orchestrator's", () => {
      // given
      const userAgents = {
        mid: { extends: "orchestrator", effort: "high" } as AgentDefinition,
        leaf: { extends: "mid", model: "x/y" } as AgentDefinition,
      }
      // when
      const result = resolveAgents(userAgents, GLOBAL_MODEL)
      // then
      expect(result.leaf).toMatchObject({
        readonly: false,
        can_delegate: true,
        model: "x/y",
        effort: "high",
      })
    })
  })

  describe("#given a child agent extending reviewer", () => {
    it("#when resolved #then it inherits readonly:true and can_delegate:true", () => {
      // given
      const userAgents = {
        "security-review": { extends: "reviewer", description: "auth focus" } as AgentDefinition,
      }
      // when
      const result = resolveAgents(userAgents, GLOBAL_MODEL)
      // then
      expect(result["security-review"]).toMatchObject({
        readonly: true,
        can_delegate: true,
        description: "auth focus",
      })
    })
  })
})

describe("resolveAgents — rule 5 (prompt_append replaces, never concats)", () => {
  describe("#given parent with prompt_append and child with prompt_append", () => {
    it("#when resolved #then child's prompt_append fully replaces parent's", () => {
      // given
      const userAgents = {
        parent: { prompt_append: "PARENT EXTRA" } as AgentDefinition,
        child: { extends: "parent", prompt_append: "CHILD EXTRA" } as AgentDefinition,
      }
      // when
      const result = resolveAgents(userAgents, GLOBAL_MODEL)
      // then
      expect(result.child?.prompt_append).toBe("CHILD EXTRA")
    })
  })
})

describe("resolveAgents — rule 6 (cycle detection)", () => {
  describe("#given a self-extends agent", () => {
    it("#when resolved #then ExtendsCycleError", () => {
      // given
      const userAgents = { selfish: { extends: "selfish" } as AgentDefinition }
      // when / then
      expect(() => resolveAgents(userAgents, GLOBAL_MODEL)).toThrow(ExtendsCycleError)
    })
  })

  describe("#given a 2-step cycle a -> b -> a", () => {
    it("#when resolved #then ExtendsCycleError mentions both names", () => {
      // given
      const userAgents = {
        a: { extends: "b" } as AgentDefinition,
        b: { extends: "a" } as AgentDefinition,
      }
      // when / then
      expect(() => resolveAgents(userAgents, GLOBAL_MODEL)).toThrow(ExtendsCycleError)
      expect(() => resolveAgents(userAgents, GLOBAL_MODEL)).toThrow(/a.*b/)
    })
  })
})

describe("resolveAgents — missing parent", () => {
  describe("#given an agent that extends a non-existent name", () => {
    it("#when resolved #then ExtendsError", () => {
      // given
      const userAgents = { orphan: { extends: "ghost" } as AgentDefinition }
      // when / then
      expect(() => resolveAgents(userAgents, GLOBAL_MODEL)).toThrow(ExtendsError)
      expect(() => resolveAgents(userAgents, GLOBAL_MODEL)).toThrow(/unknown agent "ghost"/)
    })
  })
})

describe("resolveAgents — tools field is replaced as a unit", () => {
  describe("#given parent with tools.allow and child with tools.deny", () => {
    it("#when resolved #then child.tools fully replaces parent.tools (no merge)", () => {
      // given
      const userAgents = {
        parent: { tools: { allow: ["grep"] } } as AgentDefinition,
        child: { extends: "parent", tools: { deny: ["edit"] } } as AgentDefinition,
      }
      // when
      const result = resolveAgents(userAgents, GLOBAL_MODEL)
      // then
      expect(result.child?.tools).toEqual({ deny: ["edit"] })
    })
  })
})
