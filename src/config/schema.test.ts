import { describe, expect, it } from "bun:test"
import { AgentDefinitionSchema, CONFIG_VERSION, ConfigSchema } from "./schema"

describe("ConfigSchema", () => {
  describe("#given an empty object", () => {
    it("#when parsed #then defaults fill in version and all blocks", () => {
      // when
      const result = ConfigSchema.parse({})
      // then
      expect(result.version).toBe(CONFIG_VERSION)
      expect(result.agents).toEqual({})
      expect(result.tools).toEqual({ disabled: [] })
      expect(result.hooks.disabled).toEqual([])
      expect(result.mcp.disabled).toEqual([])
      expect(result.skills.disabled).toEqual([])
      expect(result.skills.paths).toEqual([])
      expect(result.claude_code.commands).toBe(true)
      expect(result.claude_code.skills).toBe(true)
      expect(result.claude_code.agents).toBe(true)
      expect(result.claude_code.mcp).toBe(true)
      expect(result.claude_code.hooks).toBe(true)
      expect(result.logging.level).toBe("info")
    })
  })

  describe("#given an unknown top-level key", () => {
    it("#when parsed #then ZodError (strict mode)", () => {
      // when / then
      expect(() => ConfigSchema.parse({ agnts: {} })).toThrow()
    })
  })

  describe("#given a wrong version literal", () => {
    it("#when parsed #then ZodError", () => {
      // when / then
      expect(() => ConfigSchema.parse({ version: 2 })).toThrow()
    })
  })

  describe("#given an experimental block with arbitrary keys", () => {
    it("#when parsed #then unknown experimental keys pass through", () => {
      // given
      const input = { experimental: { future_feature: { x: 1 } } }
      // when
      const result = ConfigSchema.parse(input)
      // then
      expect(result.experimental).toEqual({ future_feature: { x: 1 } })
    })
  })

  describe("#given a top-level $schema string", () => {
    it("#when parsed #then accepted (editor-template friendly)", () => {
      // given
      const input = { $schema: "https://example.com/opensober.schema.json" }
      // when / then
      expect(() => ConfigSchema.parse(input)).not.toThrow()
    })
  })

  describe("#given tools.disabled", () => {
    it("#when parsed #then defaults to empty array", () => {
      // when
      const result = ConfigSchema.parse({})
      // then
      expect(result.tools.disabled).toEqual([])
    })

    it("#when set explicitly #then preserved as-is", () => {
      // given
      const input = { tools: { disabled: ["task"] } }
      // when
      const result = ConfigSchema.parse(input)
      // then
      expect(result.tools.disabled).toEqual(["task"])
    })
  })

  describe("#given hashline_edit overrides", () => {
    it("#when parsed #then defaults fill in remaining fields", () => {
      // given
      const input = { tools: { hashline_edit: { context_lines: 10 } } }
      // when
      const result = ConfigSchema.parse(input)
      // then
      expect(result.tools.hashline_edit?.context_lines).toBe(10)
      expect(result.tools.hashline_edit?.enabled).toBe(true)
      expect(result.tools.hashline_edit?.hash_algorithm).toBe("sha1")
      expect(result.tools.hashline_edit?.reject_on_stale).toBe(true)
    })
  })
})

describe("AgentDefinitionSchema", () => {
  describe("#given a minimal agent with extends only", () => {
    it("#when parsed #then permission flags are undefined (loader fills them)", () => {
      // given
      const input = { extends: "orchestrator" }
      // when
      const result = AgentDefinitionSchema.parse(input)
      // then
      expect(result.extends).toBe("orchestrator")
      expect(result.readonly).toBeUndefined()
      expect(result.can_delegate).toBeUndefined()
    })
  })

  describe("#given an invalid kebab-case extends target", () => {
    it("#when parsed #then ZodError", () => {
      // when / then
      expect(() => AgentDefinitionSchema.parse({ extends: "Orchestrator" })).toThrow()
      expect(() => AgentDefinitionSchema.parse({ extends: "with space" })).toThrow()
    })
  })

  describe("#given both tools.allow and tools.deny", () => {
    it("#when parsed #then ZodError (mutually exclusive)", () => {
      // when / then
      expect(() =>
        AgentDefinitionSchema.parse({ tools: { allow: ["grep"], deny: ["edit"] } }),
      ).toThrow()
    })
  })

  describe("#given a malformed prompt source", () => {
    it("#when parsed #then ZodError", () => {
      // when / then
      expect(() => AgentDefinitionSchema.parse({ prompt: "file://relative/p.md" })).toThrow()
      expect(() => AgentDefinitionSchema.parse({ prompt: "" })).toThrow()
    })
  })

  describe("#given a valid prompt source", () => {
    it("#when parsed #then accepted", () => {
      // when / then
      expect(() => AgentDefinitionSchema.parse({ prompt: "file:///abs/p.md" })).not.toThrow()
      expect(() => AgentDefinitionSchema.parse({ prompt: "file://~/p.md" })).not.toThrow()
      expect(() => AgentDefinitionSchema.parse({ prompt: "./p.md" })).not.toThrow()
    })
  })

  describe("#given a thinking block", () => {
    it("#when budgetTokens is non-positive #then ZodError", () => {
      // when / then
      expect(() =>
        AgentDefinitionSchema.parse({ thinking: { type: "enabled", budgetTokens: 0 } }),
      ).toThrow()
    })
  })
})
