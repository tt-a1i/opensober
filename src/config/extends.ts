// opensober — agent inheritance resolution.
//
// Takes the user's parsed agents map plus the global default model, and produces a fully
// resolved map where every agent has concrete `readonly`, `can_delegate`, and `model` fields.
//
// Rules (Round 2):
//   3. Single inheritance only — schema already enforces `extends` is a single string.
//   4. Permission resolution order: implicit defaults → root parent → ... → leaf own.
//      The leaf (this agent's explicit fields) wins when both are set.
//   5. `prompt_append` follows the same override-wins rule as everything else; child
//      replaces parent's append rather than concatenating.
//   6. Self-extends is one form of cycle and is caught by the cycle detector.
//   7. Built-in agents are shallow-merged with user overrides BEFORE chain resolution:
//      user keys overlay baseline keys; baseline keys not touched by the user persist.
//
// Runtime safety note: even if a user defines a child that flips a baseline `readonly: true`
// to `false`, the task tool's runtime check (caller.readonly => target.readonly) still
// prevents a readonly caller from delegating to a writable target. The schema layer is
// permissive on purpose; the safety enforcement lives at delegation time.

import { BUILTIN_AGENTS } from "./defaults"
import type { AgentDefinition } from "./schema"

// ─────────────────────────────────────────────────────────────────────────────
// Public types & errors
// ─────────────────────────────────────────────────────────────────────────────

// Optional fields are propagated straight from AgentDefinition so the types stay in sync
// with the Zod schema (Zod's `.optional()` produces `T | undefined`, which is what
// exactOptionalPropertyTypes expects on the receiving side).
export interface ResolvedAgent {
  readonly readonly: boolean
  readonly can_delegate: boolean
  readonly model: string
  readonly effort?: AgentDefinition["effort"]
  readonly thinking?: AgentDefinition["thinking"]
  readonly prompt?: AgentDefinition["prompt"]
  readonly prompt_append?: AgentDefinition["prompt_append"]
  readonly tools?: AgentDefinition["tools"]
  readonly description?: AgentDefinition["description"]
}

export class ExtendsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExtendsError"
  }
}

export class ExtendsCycleError extends ExtendsError {
  constructor(message: string) {
    super(message)
    this.name = "ExtendsCycleError"
  }
}

const IMPLICIT_DEFAULT_READONLY = false
const IMPLICIT_DEFAULT_CAN_DELEGATE = true

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: rule 7 — shallow-merge builtin baselines with user overrides
// ─────────────────────────────────────────────────────────────────────────────

function mergeBuiltinsWithUser(
  userAgents: Record<string, AgentDefinition>,
): Record<string, AgentDefinition> {
  const result: Record<string, AgentDefinition> = {}

  for (const [name, baseline] of Object.entries(BUILTIN_AGENTS)) {
    const userOverride = userAgents[name]
    result[name] = userOverride ? { ...baseline, ...userOverride } : baseline
  }

  for (const [name, def] of Object.entries(userAgents)) {
    if (!(name in BUILTIN_AGENTS)) {
      result[name] = def
    }
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: walk the extends chain (rule 6: self-extends caught here as a 1-step cycle)
// ─────────────────────────────────────────────────────────────────────────────

function walkExtendsChain(startName: string, agents: Record<string, AgentDefinition>): string[] {
  const chain: string[] = []
  const visited = new Set<string>()
  let current: string | undefined = startName

  while (current !== undefined) {
    if (visited.has(current)) {
      throw new ExtendsCycleError(
        `extends cycle detected at "${startName}": ${[...chain, current].join(" -> ")}`,
      )
    }
    visited.add(current)
    chain.push(current)

    const def: AgentDefinition | undefined = agents[current]
    if (def === undefined) {
      throw new ExtendsError(`unknown agent "${current}" referenced from extends chain`)
    }
    const parent: string | undefined = def.extends
    if (parent !== undefined && !(parent in agents)) {
      throw new ExtendsError(`agent "${current}" extends unknown agent "${parent}"`)
    }
    current = parent
  }

  return chain
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: layer the chain (rule 4: implicit defaults -> parent -> child)
// ─────────────────────────────────────────────────────────────────────────────

function resolveOne(
  name: string,
  agents: Record<string, AgentDefinition>,
  globalModel: string | undefined,
): ResolvedAgent {
  const chain = walkExtendsChain(name, agents)
  // Walk root-to-leaf so the leaf's explicit fields land last.
  const defs = [...chain].reverse().map((n) => agents[n] as AgentDefinition)

  let readonly = IMPLICIT_DEFAULT_READONLY
  let can_delegate = IMPLICIT_DEFAULT_CAN_DELEGATE
  let model: string | undefined
  let effort: ResolvedAgent["effort"]
  let thinking: ResolvedAgent["thinking"]
  let prompt: ResolvedAgent["prompt"]
  let prompt_append: ResolvedAgent["prompt_append"]
  let tools: ResolvedAgent["tools"]
  let description: ResolvedAgent["description"]

  for (const def of defs) {
    if (def.readonly !== undefined) readonly = def.readonly
    if (def.can_delegate !== undefined) can_delegate = def.can_delegate
    if (def.model !== undefined) model = def.model
    if (def.effort !== undefined) effort = def.effort
    if (def.thinking !== undefined) thinking = def.thinking
    if (def.prompt !== undefined) prompt = def.prompt
    if (def.prompt_append !== undefined) prompt_append = def.prompt_append
    if (def.tools !== undefined) tools = def.tools
    if (def.description !== undefined) description = def.description
  }

  if (model === undefined) model = globalModel
  if (model === undefined) {
    throw new ExtendsError(
      `agent "${name}" has no model: not set on self, parents, or top-level config.model`,
    )
  }

  return {
    readonly,
    can_delegate,
    model,
    ...(effort !== undefined ? { effort } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(prompt_append !== undefined ? { prompt_append } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(description !== undefined ? { description } : {}),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve all agents (built-ins + user-defined) into ResolvedAgent records with concrete
 * permission booleans and a concrete model. Throws ExtendsError on bad input
 * (missing parent, missing model) and ExtendsCycleError on cyclic extends.
 */
export function resolveAgents(
  userAgents: Record<string, AgentDefinition>,
  globalModel: string | undefined,
): Record<string, ResolvedAgent> {
  const merged = mergeBuiltinsWithUser(userAgents)

  const resolved: Record<string, ResolvedAgent> = {}
  for (const name of Object.keys(merged)) {
    resolved[name] = resolveOne(name, merged, globalModel)
  }
  return resolved
}
