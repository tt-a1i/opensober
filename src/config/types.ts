// opensober — types shared across the config layer.
//
// These live in their own file because both `discovery.ts` and `loader.ts` need them,
// and putting them inside either creates a circular dependency.

import type { ResolvedAgent } from "./extends"
import type { Config } from "./schema"

/** Where a config layer came from. The discovery order is fixed: default -> user -> project -> cli-override. */
export type ConfigSource = "default" | "user" | "project" | "cli-override"

/**
 * One layer's contribution. `path` is null for the synthetic "default" layer and may also
 * be null for absent layers we want to report as "looked, found nothing".
 * `raw` is post-JSONC-parse, pre-Zod, pre-merge — useful for `doctor` provenance later.
 */
export interface ConfigLayer {
  readonly source: ConfigSource
  readonly path: string | null
  readonly raw: unknown
}

/** Same shape as the user-facing Config but with agents fully resolved (extends + permissions filled). */
export type ResolvedConfig = Omit<Config, "agents"> & {
  readonly agents: Record<string, ResolvedAgent>
}

/** What `loadConfig()` returns. `layers` is kept around for doctor / debugging. */
export interface LoaderResult {
  readonly config: ResolvedConfig
  readonly layers: readonly ConfigLayer[]
}
