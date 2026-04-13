// opensober — `doctor` subcommand.
//
// A structured health report for the user's current opensober configuration:
//   * config summary (version, global model, contributing layers)
//   * agent table (resolved model + permission flags)
//   * registered tools
//   * warnings (things the loader didn't reject but the user probably wants to know)
//
// Exit codes:
//   0  config loaded cleanly, no warnings
//   1  config loaded but warnings were detected (CI-actionable)
//   2  config failed to load (fatal — stderr gets the error report)
//
// v1 check set is small on purpose: agent's tools.allow / tools.deny must reference
// tools that opensober actually registers. Larger checks (prompt file existence,
// unknown hooks/skills, capability/model mismatches) land when the corresponding
// subsystems do.

import pico from "picocolors"
import { BUILTIN_AGENT_NAMES } from "../config/defaults"
import type { ResolvedAgent } from "../config/extends"
import { loadConfig } from "../config/loader"
import type { LoaderResult } from "../config/types"
import { TOOL_NAMES } from "../tools"
import { type ErrorSink, formatError } from "./format-error"

export type OutSink = (line: string) => void

export interface DoctorOptions {
  readonly cwd?: string | undefined
  readonly configOverride?: string | undefined
  readonly userHome?: string | undefined
  readonly out?: OutSink | undefined
  readonly err?: ErrorSink | undefined
}

const BUILTIN_SET = new Set<string>(BUILTIN_AGENT_NAMES)
const KNOWN_TOOLS = new Set<string>(TOOL_NAMES)
const AGENT_NAME_COLUMN = 15
const AGENT_MODEL_COLUMN = 30
const LAYER_SOURCE_COLUMN = 13

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

export function doctorCommand(opts: DoctorOptions = {}): number {
  const out: OutSink = opts.out ?? ((line) => console.log(line))
  const err: ErrorSink = opts.err ?? ((line) => console.error(line))

  let result: LoaderResult
  try {
    result = loadConfig({
      cwd: opts.cwd,
      cliOverride: opts.configOverride,
      userHome: opts.userHome,
    })
  } catch (e) {
    err(pico.red("config failed to load:"))
    formatError(e, err)
    return 2
  }

  out(pico.bold("== opensober doctor =="))
  out("")
  printConfig(result, out)
  out("")
  printAgents(result, out)
  out("")
  printTools(out)
  out("")

  const warnings = collectWarnings(result)
  printWarnings(warnings, out)

  return warnings.length > 0 ? 1 : 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Sections
// ─────────────────────────────────────────────────────────────────────────────

function printConfig(result: LoaderResult, out: OutSink): void {
  out(pico.bold("config"))
  out(`  version:       ${result.config.version}`)
  out(`  global model:  ${result.config.model ?? pico.dim("(unset)")}`)
  out("  layers:")
  for (const layer of result.layers) {
    const path = layer.path ?? pico.dim("(built-in)")
    out(`    ${layer.source.padEnd(LAYER_SOURCE_COLUMN)} ${path}`)
  }
}

/**
 * Alphabetical built-ins first, then alphabetical user-defined — identical ordering
 * rule as `run`'s summary, so users see the same agent order in both commands.
 */
function orderAgentNames(names: readonly string[]): string[] {
  const builtins = names.filter((n) => BUILTIN_SET.has(n)).sort()
  const userOnly = names.filter((n) => !BUILTIN_SET.has(n)).sort()
  return [...builtins, ...userOnly]
}

function describeFlags(agent: ResolvedAgent): string {
  const flags: string[] = []
  flags.push(agent.readonly ? "readonly" : "writable")
  if (!agent.can_delegate) {
    flags.push("no-delegate")
  } else if (agent.readonly) {
    flags.push("delegates (readonly-only)")
  } else {
    flags.push("delegates")
  }
  return flags.join(", ")
}

function printAgents(result: LoaderResult, out: OutSink): void {
  out(pico.bold("agents"))
  for (const name of orderAgentNames(Object.keys(result.config.agents))) {
    const agent = result.config.agents[name]
    if (agent === undefined) continue
    out(
      `  ${name.padEnd(AGENT_NAME_COLUMN)} ${agent.model.padEnd(AGENT_MODEL_COLUMN)} ${describeFlags(agent)}`,
    )
  }
}

function printTools(out: OutSink): void {
  out(pico.bold("tools"))
  out(`  ${[...TOOL_NAMES].sort().join(", ")}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Warnings
// ─────────────────────────────────────────────────────────────────────────────

interface Warning {
  readonly message: string
}

function collectWarnings(result: LoaderResult): Warning[] {
  const warnings: Warning[] = []

  for (const [name, agent] of Object.entries(result.config.agents)) {
    if (agent.tools === undefined) continue

    for (const tool of agent.tools.allow ?? []) {
      if (!KNOWN_TOOLS.has(tool)) {
        warnings.push({
          message: `agent "${name}": tools.allow references unknown tool "${tool}"`,
        })
      }
    }

    for (const tool of agent.tools.deny ?? []) {
      if (!KNOWN_TOOLS.has(tool)) {
        warnings.push({
          message: `agent "${name}": tools.deny references unknown tool "${tool}"`,
        })
      }
    }
  }

  return warnings
}

function printWarnings(warnings: readonly Warning[], out: OutSink): void {
  out(pico.bold("warnings"))
  if (warnings.length === 0) {
    out(`  ${pico.dim("(none)")}`)
    return
  }
  for (const w of warnings) {
    out(`  ${w.message}`)
  }
}
