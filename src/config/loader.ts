// opensober — top-level config loader.
//
// Pipeline (per Round 3 rules):
//   1. discover ordered layer candidates (default, user, project, cli-override)
//   2. for each existing candidate file, read + JSONC-parse strictly (rule Q4=A)
//   3. deepMerge the raw layers in order
//   4. ConfigSchema.parse the merged result   (rule 3: parse after merge, before extends)
//   5. resolveAgents to layer extends + builtin baselines
//   6. emit ResolvedConfig + the contributing layers (rule 5: doctor uses `layers`)
//
// Errors:
//   - ConfigLoadError      file IO / JSONC syntax    (path + line:col reported)
//   - ZodError             schema violation          (Zod's path is good enough on its own)
//   - ExtendsError /
//     ExtendsCycleError    agent inheritance issues  (already named in extends.ts)

import { existsSync, readFileSync } from "node:fs"
import { type ParseError, parse, printParseErrorCode } from "jsonc-parser"
import { type DiscoveryOptions, listLayerCandidates } from "./discovery"
import { resolveAgents } from "./extends"
import { deepMerge } from "./merge"
import { ConfigSchema } from "./schema"
import type { ConfigLayer, ConfigSource, LoaderResult, ResolvedConfig } from "./types"

export class ConfigLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = "ConfigLoadError"
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JSONC error formatting
// ─────────────────────────────────────────────────────────────────────────────

function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1
  let col = 1
  const limit = Math.min(offset, text.length)
  for (let i = 0; i < limit; i++) {
    if (text[i] === "\n") {
      line++
      col = 1
    } else {
      col++
    }
  }
  return { line, col }
}

function formatJsoncErrors(errors: ParseError[], text: string, path: string): string {
  const header = `JSONC syntax error in ${path}:`
  const lines = errors.map((e) => {
    const { line, col } = offsetToLineCol(text, e.offset)
    return `  ${path}:${line}:${col}  ${printParseErrorCode(e.error)}`
  })
  return [header, ...lines].join("\n")
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-layer load
// ─────────────────────────────────────────────────────────────────────────────

function readLayer(source: ConfigSource, path: string): ConfigLayer | null {
  if (!existsSync(path)) return null

  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (cause) {
    throw new ConfigLoadError(`failed to read config file at ${path}`, { cause })
  }

  const errors: ParseError[] = []
  const raw = parse(text, errors, { allowTrailingComma: true })
  if (errors.length > 0) {
    throw new ConfigLoadError(formatJsoncErrors(errors, text, path))
  }

  return { source, path, raw }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

export function loadConfig(options: DiscoveryOptions = {}): LoaderResult {
  const candidates = listLayerCandidates(options)
  const layers: ConfigLayer[] = []
  let merged: unknown

  for (const candidate of candidates) {
    let layer: ConfigLayer | null = null

    if (candidate.source === "default") {
      // The synthetic baseline layer is always present so doctor can show it explicitly.
      layer = { source: "default", path: null, raw: {} }
    } else if (candidate.path !== null) {
      layer = readLayer(candidate.source, candidate.path)
    }

    if (layer === null) continue
    layers.push(layer)
    merged = deepMerge(merged, layer.raw)
  }

  const parsed = ConfigSchema.parse(merged ?? {})
  const resolvedAgents = resolveAgents(parsed.agents, parsed.model)

  const config: ResolvedConfig = {
    ...parsed,
    agents: resolvedAgents,
  }

  return { config, layers }
}
