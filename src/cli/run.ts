// opensober — `run` subcommand.
//
// Round 4 scope: load config, print summary, exit. Driving an actual opencode
// session lands in a later round once tools and hooks are wired. The point here
// is to give the user a one-shot way to verify their config resolves cleanly.
//
// Design note: this module exports `runCommand` as a plain function (not a
// Commander handler) so tests can drive it with tmpdir fixtures, inject `out`/
// `err` collectors, and avoid spawning subprocesses.

import pico from "picocolors"
import { BUILTIN_AGENT_NAMES } from "../config/defaults"
import type { ResolvedAgent } from "../config/extends"
import { loadConfig } from "../config/loader"
import type { ConfigLayer, LoaderResult } from "../config/types"
import { TOOL_NAMES } from "../tools"
import { type ErrorSink, formatError } from "./format-error"

export type OutSink = (line: string) => void

// Same `T | undefined` pattern as DiscoveryOptions: lets the CLI handler forward
// optional Commander values without first stripping undefined.
export interface RunOptions {
  readonly cwd?: string | undefined
  readonly configOverride?: string | undefined
  /** Override $HOME for tests; production code leaves this undefined. */
  readonly userHome?: string | undefined
  /** Default: console.log. Tests inject a collector. */
  readonly out?: OutSink | undefined
  /** Default: console.error. */
  readonly err?: ErrorSink | undefined
}

const SOURCE_COLUMN = 13
const NAME_COLUMN = 20

// ─────────────────────────────────────────────────────────────────────────────
// Ordering
// ─────────────────────────────────────────────────────────────────────────────

const BUILTIN_SET = new Set<string>(BUILTIN_AGENT_NAMES)

/**
 * Stable agent ordering: built-ins (alphabetical) first, then user-defined
 * (alphabetical). Deterministic across runs and platforms — testable too.
 */
function orderAgentNames(names: readonly string[]): string[] {
  const builtins = names.filter((n) => BUILTIN_SET.has(n)).sort()
  const userOnly = names.filter((n) => !BUILTIN_SET.has(n)).sort()
  return [...builtins, ...userOnly]
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────────────────────

function formatAgentRow(name: string, agent: ResolvedAgent): string {
  const flags: string[] = []
  if (agent.readonly) flags.push("readonly")
  if (!agent.can_delegate) flags.push("no-delegate")
  const flagStr = flags.length > 0 ? pico.dim(`  [${flags.join(", ")}]`) : ""
  return `  ${name.padEnd(NAME_COLUMN)} ${agent.model}${flagStr}`
}

function printLayers(layers: readonly ConfigLayer[], out: OutSink): void {
  out(pico.bold("config layers (in priority order):"))
  for (const layer of layers) {
    const path = layer.path ?? pico.dim("<built-in defaults>")
    out(`  ${layer.source.padEnd(SOURCE_COLUMN)} ${path}`)
  }
}

function printAgents(agents: Record<string, ResolvedAgent>, out: OutSink): void {
  out(pico.bold("agents:"))
  for (const name of orderAgentNames(Object.keys(agents))) {
    const agent = agents[name]
    if (agent === undefined) continue
    out(formatAgentRow(name, agent))
  }
}

function printTools(out: OutSink): void {
  out(pico.bold("tools:"))
  out(`  ${[...TOOL_NAMES].sort().join(", ")}`)
}

function printSummary(result: LoaderResult, out: OutSink): void {
  printLayers(result.layers, out)
  out("")
  printAgents(result.config.agents, out)
  out("")
  printTools(out)
  out("")
  out(pico.dim("(Session not started — current scope only verifies config loads.)"))
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

/** Returns 0 on success, 1 on any config-pipeline failure. */
export function runCommand(opts: RunOptions = {}): number {
  const out: OutSink = opts.out ?? ((line) => console.log(line))
  const err: ErrorSink = opts.err ?? ((line) => console.error(line))

  try {
    const result = loadConfig({
      cwd: opts.cwd,
      cliOverride: opts.configOverride,
      userHome: opts.userHome,
    })
    printSummary(result, out)
    return 0
  } catch (e) {
    formatError(e, err)
    return 1
  }
}
