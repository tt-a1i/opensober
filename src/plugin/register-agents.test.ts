import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
      registerAgents(openCodeConfig, ourConfig, "/tmp")
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
      registerAgents(openCodeConfig, ourConfig, "/tmp")
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
      registerAgents(openCodeConfig, ourConfig, "/tmp")
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
      registerAgents(openCodeConfig, ourConfig, "/tmp")
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
      registerAgents(openCodeConfig, ourConfig, "/tmp")
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
      registerAgents(openCodeConfig, ourConfig, "/tmp")
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
      registerAgents(openCodeConfig, ourConfig, "/tmp")
      // then
      expect(openCodeConfig.agent?.orchestrator?.model).toBe("anthropic/claude-opus-4-6")
      expect(openCodeConfig.agent?.orchestrator?.description).toBe("does everything")
    })
  })
})

describe("registerAgents — prompt file resolution", () => {
  let configDir: string

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "opensober-prompt-"))
  })

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true })
  })

  describe("#given an agent with a relative prompt path pointing to a real file", () => {
    it("#when registered #then the file content becomes the agent's prompt text", () => {
      // given
      const promptDir = join(configDir, "prompts")
      mkdirSync(promptDir, { recursive: true })
      writeFileSync(join(promptDir, "custom.md"), "You are a custom agent.")
      const openCodeConfig: Config = {}
      const ourConfig = makeResolvedConfig({
        orchestrator: { prompt: "./prompts/custom.md" },
      })
      // when
      registerAgents(openCodeConfig, ourConfig, configDir)
      // then
      expect(openCodeConfig.agent?.orchestrator?.prompt).toBe("You are a custom agent.")
    })
  })

  describe("#given an agent with prompt AND prompt_append", () => {
    it("#when registered #then both are concatenated with a blank line separator", () => {
      // given
      writeFileSync(join(configDir, "base.md"), "Base prompt.")
      writeFileSync(join(configDir, "extra.md"), "Extra context.")
      const openCodeConfig: Config = {}
      const ourConfig = makeResolvedConfig({
        orchestrator: { prompt: "./base.md", prompt_append: "./extra.md" },
      })
      // when
      registerAgents(openCodeConfig, ourConfig, configDir)
      // then
      expect(openCodeConfig.agent?.orchestrator?.prompt).toBe("Base prompt.\n\nExtra context.")
    })
  })

  describe("#given a prompt file that does not exist", () => {
    it("#when registered #then prompt is NOT set (skipped with warning, no crash)", () => {
      // given
      const openCodeConfig: Config = {}
      const ourConfig = makeResolvedConfig({
        orchestrator: { prompt: "./nonexistent.md" },
      })
      // when
      registerAgents(openCodeConfig, ourConfig, configDir)
      // then
      expect(openCodeConfig.agent?.orchestrator?.prompt).toBeUndefined()
    })
  })

  describe("#given file:///absolute prompt path", () => {
    it("#when registered #then the absolute path is resolved and read", () => {
      // given
      const absFile = join(configDir, "abs-prompt.md")
      writeFileSync(absFile, "Absolute path prompt.")
      const openCodeConfig: Config = {}
      const ourConfig = makeResolvedConfig({
        orchestrator: { prompt: `file://${absFile}` },
      })
      // when
      registerAgents(openCodeConfig, ourConfig, configDir)
      // then
      expect(openCodeConfig.agent?.orchestrator?.prompt).toBe("Absolute path prompt.")
    })
  })
})
