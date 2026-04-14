import { describe, expect, it } from "bun:test"
import type { Config } from "@opencode-ai/plugin"
import type { ResolvedAgent } from "../config/extends"
import type { ResolvedConfig } from "../config/types"
import { registerAgents } from "./register-agents"

function makeResolvedConfig(agents: Record<string, Partial<ResolvedAgent>>): ResolvedConfig {
  const full: Record<string, ResolvedAgent> = {}
  for (const [name, partial] of Object.entries(agents)) {
    full[name] = { readonly: false, can_delegate: true, model: "test/model", ...partial }
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

describe("registerAgents", () => {
  describe("#given an empty opencode config", () => {
    it("#when called #then all opensober agents are registered", () => {
      // given
      const openCodeConfig: Config = {}
      const ourConfig = makeResolvedConfig({
        orchestrator: { description: "main executor" },
        explore: { readonly: true, can_delegate: false, tools: { allow: ["read"] } },
        reviewer: { readonly: true, can_delegate: true },
      })
      // when
      registerAgents(openCodeConfig, ourConfig)
      // then
      expect(Object.keys(openCodeConfig.agent ?? {}).sort()).toEqual([
        "explore",
        "orchestrator",
        "reviewer",
      ])
    })
  })

  describe("#given orchestrator is registered", () => {
    it("#when checked #then mode is 'primary'", () => {
      // given
      const openCodeConfig: Config = {}
      const ourConfig = makeResolvedConfig({ orchestrator: { model: "m" } })
      // when
      registerAgents(openCodeConfig, ourConfig)
      // then
      expect(openCodeConfig.agent?.orchestrator?.mode).toBe("primary")
    })
  })

  describe("#given non-orchestrator agents", () => {
    it("#when registered #then mode is 'subagent'", () => {
      // given
      const openCodeConfig: Config = {}
      const ourConfig = makeResolvedConfig({
        orchestrator: {},
        explore: {},
        reviewer: {},
        "custom-agent": {},
      })
      // when
      registerAgents(openCodeConfig, ourConfig)
      // then
      expect(openCodeConfig.agent?.explore?.mode).toBe("subagent")
      expect(openCodeConfig.agent?.reviewer?.mode).toBe("subagent")
      expect(openCodeConfig.agent?.["custom-agent"]?.mode).toBe("subagent")
    })
  })

  describe("#given an agent with tools.allow", () => {
    it("#when registered #then tools map has allowed=true and others=false", () => {
      // given
      const openCodeConfig: Config = {}
      const ourConfig = makeResolvedConfig({
        orchestrator: {},
        explore: { tools: { allow: ["read"] } },
      })
      // when
      registerAgents(openCodeConfig, ourConfig)
      // then
      expect(openCodeConfig.agent?.explore?.tools).toEqual({
        read: true,
        edit: false,
        task: false,
      })
    })
  })

  describe("#given an agent with tools.deny", () => {
    it("#when registered #then denied tools are false and others are true", () => {
      // given
      const openCodeConfig: Config = {}
      const ourConfig = makeResolvedConfig({
        orchestrator: {},
        restricted: { tools: { deny: ["task"] } },
      })
      // when
      registerAgents(openCodeConfig, ourConfig)
      // then
      expect(openCodeConfig.agent?.restricted?.tools).toEqual({
        read: true,
        edit: true,
        task: false,
      })
    })
  })

  describe("#given opencode already has an agent with the same name", () => {
    it("#when registered #then the existing definition is NOT overwritten", () => {
      // given
      const openCodeConfig: Config = {
        agent: { orchestrator: { model: "user-override/model" } },
      }
      const ourConfig = makeResolvedConfig({ orchestrator: { model: "our/model" } })
      // when
      registerAgents(openCodeConfig, ourConfig)
      // then — user's opencode.json definition wins
      expect(openCodeConfig.agent?.orchestrator?.model).toBe("user-override/model")
    })
  })

  describe("#given model and description on a resolved agent", () => {
    it("#when registered #then both are forwarded to the opencode config", () => {
      // given
      const openCodeConfig: Config = {}
      const ourConfig = makeResolvedConfig({
        orchestrator: { model: "anthropic/claude-opus-4-6", description: "does everything" },
      })
      // when
      registerAgents(openCodeConfig, ourConfig)
      // then
      expect(openCodeConfig.agent?.orchestrator?.model).toBe("anthropic/claude-opus-4-6")
      expect(openCodeConfig.agent?.orchestrator?.description).toBe("does everything")
    })
  })
})
