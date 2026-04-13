// opensober — Zod schemas for the user-facing JSONC config.
//
// Design notes:
//
// * Top-level schema is `.strict()`. Unknown keys are errors, not silent passthrough — this
//   is the floor for "no invisible automation" (rule 2 in CONTRIBUTING.md). Typos like `agnts:`
//   surface immediately instead of becoming permanently-ignored config.
//
// * Agent permission booleans (`readonly`, `can_delegate`) are OPTIONAL at the schema level
//   because they are filled by the extends-resolver in the loader. After resolution, every
//   agent has both fields set; before resolution, leaving them off means "inherit / use
//   baseline default". Schema does not enforce defaults here on purpose.
//
// * `version` is a literal `1`. A future v2 config bumps this; the loader will refuse
//   to read it (per "no migration mechanism" decision in v1-scope.md §9).
//
// * The `experimental` block is an explicit `Record<string, unknown>` escape hatch.
//   It is the only place where unknown keys are permitted; everything else is closed.
//
// * `tools.allow` and `tools.deny` are mutually exclusive. A refine catches both-set.

import { z } from "zod"
import { validatePromptSourceSyntax } from "./prompt-source"

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_NAME_RE = /^[a-z][a-z0-9-]*$/

const AgentNameSchema = z
  .string()
  .regex(
    AGENT_NAME_RE,
    "agent name must be lowercase kebab-case: start with a-z, contain only a-z, 0-9, '-'",
  )

const PromptSourceSchema = z.string().refine(
  (raw) => {
    try {
      validatePromptSourceSyntax(raw)
      return true
    } catch {
      return false
    }
  },
  {
    message:
      "prompt source must be one of: 'file:///abs/path', 'file://~/rel', './rel', 'rel/path' " +
      "(see v1-scope.md §9; file://relative/... is rejected on purpose)",
  },
)

const ThinkingSchema = z
  .object({
    type: z.literal("enabled"),
    budgetTokens: z.number().int().positive(),
  })
  .strict()

const EffortSchema = z.enum(["low", "medium", "high"])

const ToolPolicySchema = z
  .object({
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
  })
  .strict()
  .refine((p) => !(p.allow && p.deny), {
    message: "tools.allow and tools.deny are mutually exclusive — pick one",
  })

// ─────────────────────────────────────────────────────────────────────────────
// AgentDefinition (input shape — pre-resolution)
// ─────────────────────────────────────────────────────────────────────────────

export const AgentDefinitionSchema = z
  .object({
    extends: AgentNameSchema.optional(),

    // permission booleans — filled by extends-resolver if omitted
    readonly: z.boolean().optional(),
    can_delegate: z.boolean().optional(),

    // model selection
    model: z.string().min(1).optional(),
    effort: EffortSchema.optional(),
    thinking: ThinkingSchema.optional(),

    // prompt
    prompt: PromptSourceSchema.optional(),
    prompt_append: PromptSourceSchema.optional(),

    // tool restrictions
    tools: ToolPolicySchema.optional(),

    // metadata
    description: z.string().optional(),
  })
  .strict()

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Tool / Hook / MCP / Skill / Compat / Logging blocks
// ─────────────────────────────────────────────────────────────────────────────

// Hashline-edit slots reserved per user request — no behaviour change here, just shape.
const HashlineEditConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    // v1 supports sha1 and sha256 only (per Round 5 Q1 = A). blake3 can be added
    // later without a schema migration — adding a new enum value is forward-compatible.
    hash_algorithm: z.enum(["sha1", "sha256"]).default("sha1"),
    reject_on_stale: z.boolean().default(true),
    context_lines: z.number().int().min(0).max(20).default(3),
  })
  .strict()

const ToolsConfigSchema = z
  .object({
    hashline_edit: HashlineEditConfigSchema.optional(),
    // Parallel to hooks.disabled / mcp.disabled / skills.disabled. Names listed here are
    // filtered out by `createTools()` before registration. Unknown names are tolerated
    // (future tool names, typos surface via `doctor` later).
    disabled: z.array(z.string()).default([]),
  })
  .strict()

const HooksConfigSchema = z
  .object({
    disabled: z.array(z.string()).default([]),
  })
  .strict()

const McpConfigSchema = z
  .object({
    disabled: z.array(z.string()).default([]),
  })
  .strict()

const SkillsConfigSchema = z
  .object({
    disabled: z.array(z.string()).default([]),
    paths: z.array(z.string()).default([]),
  })
  .strict()

const ClaudeCodeCompatSchema = z
  .object({
    commands: z.boolean().default(true),
    skills: z.boolean().default(true),
    agents: z.boolean().default(true),
    mcp: z.boolean().default(true),
    hooks: z.boolean().default(true),
  })
  .strict()

const LoggingConfigSchema = z
  .object({
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
    state_dir: z.string().optional(),
  })
  .strict()

// ─────────────────────────────────────────────────────────────────────────────
// Top-level config
// ─────────────────────────────────────────────────────────────────────────────

export const CONFIG_VERSION = 1

export const ConfigSchema = z
  .object({
    // Optional `$schema` reference — permitted at the top level so editor-autocompletion
    // templates (which conventionally include this pointer) load without tripping strict
    // mode. We don't validate the URL; we just accept and ignore it at runtime.
    $schema: z.string().optional(),

    version: z.literal(CONFIG_VERSION).default(CONFIG_VERSION),

    /** Global default model. Used as the baseline `model` for any agent that omits one. */
    model: z.string().min(1).optional(),

    agents: z.record(AgentNameSchema, AgentDefinitionSchema).default({}),

    // Defaults are spelled out fully on purpose: Zod 4's `.default(x)` does not re-parse `x`
    // through the inner schema, so nested `.default([])` calls are NOT applied when the
    // parent block is omitted. Explicit defaults keep the resolved shape predictable.
    tools: ToolsConfigSchema.default({ disabled: [] }),
    hooks: HooksConfigSchema.default({ disabled: [] }),
    mcp: McpConfigSchema.default({ disabled: [] }),
    skills: SkillsConfigSchema.default({ disabled: [], paths: [] }),
    claude_code: ClaudeCodeCompatSchema.default({
      commands: true,
      skills: true,
      agents: true,
      mcp: true,
      hooks: true,
    }),
    logging: LoggingConfigSchema.default({ level: "info" }),

    /** Open passthrough for genuinely experimental knobs. The only place unknown keys live. */
    experimental: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()

export type Config = z.infer<typeof ConfigSchema>
export type HashlineEditConfig = z.infer<typeof HashlineEditConfigSchema>
export type ToolsConfig = z.infer<typeof ToolsConfigSchema>
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>
