import { describe, expect, it } from "bun:test"
import type { ResolvedAgent } from "../config/extends"
import type { ResolvedConfig } from "../config/types"
import { createTools, TOOL_NAMES, type ToolDependencies } from "./index"

function makeConfig(disabled: string[] = []): ResolvedConfig {
  const agents: Record<string, ResolvedAgent> = {
    orchestrator: { readonly: false, can_delegate: true, model: "m" },
  }
  return {
    version: 1,
    agents,
    tools: { disabled },
    hooks: { disabled: [] },
    mcp: { disabled: [] },
    skills: { disabled: [], paths: [] },
    claude_code: { commands: true, skills: true, agents: true, mcp: true, hooks: true },
    logging: { level: "info" },
    experimental: {},
  }
}

// Minimal mock client — createTools needs it for task tool factory.
const fakeDeps: ToolDependencies = {
  client: {} as ToolDependencies["client"],
  backgroundManager: {} as ToolDependencies["backgroundManager"],
}

describe("createTools", () => {
  describe("#given no disabled tools", () => {
    it("#when called #then returns all three registered tools", () => {
      // when
      const tools = createTools(makeConfig(), fakeDeps)
      // then
      const names = Object.keys(tools).sort()
      expect(names).toEqual([...TOOL_NAMES].sort())
    })
  })

  describe("#given tools.disabled excludes task", () => {
    it("#when called #then task is absent but read and edit remain", () => {
      // when
      const tools = createTools(makeConfig(["task"]))
      // then
      expect(tools.read).toBeDefined()
      expect(tools.edit).toBeDefined()
      expect(tools.task).toBeUndefined()
    })
  })

  describe("#given tools.disabled contains an unknown name", () => {
    it("#when called #then unknown names are ignored (no crash, all tools registered)", () => {
      // when
      const tools = createTools(makeConfig(["nonexistent-tool"]))
      // then
      expect(Object.keys(tools).sort()).toEqual([...TOOL_NAMES].sort())
    })
  })

  describe("#given all tools disabled", () => {
    it("#when called #then empty map is returned", () => {
      // when
      const tools = createTools(makeConfig([...TOOL_NAMES]))
      // then
      expect(Object.keys(tools)).toEqual([])
    })
  })
})
