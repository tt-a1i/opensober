// opensober — config discovery.
//
// Resolves the candidate filesystem paths for each config layer. This module is
// filesystem-aware (it checks for `.git`) but does NOT read or parse config files —
// that's the loader's job. Splitting the two keeps discovery cheap to test with
// throwaway tmp dirs.
//
// Discovery order (per Round 3 rule 1, fixed and printable):
//   default       — synthetic, always present, no filesystem path
//   user          — $HOME/.config/opensober/config.jsonc
//   project       — <project-root>/.opensober/config.jsonc, where project-root is
//                   the closest ancestor of cwd containing `.git`. Null if not in a repo.
//   cli-override  — whatever path the caller passed via --config (highest priority)

import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, parse, resolve } from "node:path"
import type { ConfigSource } from "./types"

const PROJECT_CONFIG_RELATIVE = ".opensober/config.jsonc"
const USER_CONFIG_RELATIVE = ".config/opensober/config.jsonc"

export interface DiscoveryOptions {
  /** Working directory we start the project-root walk from. Defaults to process.cwd(). */
  readonly cwd?: string
  /** Path passed via CLI `--config`. Becomes the highest-priority layer when set. */
  readonly cliOverride?: string
  /** Override for $HOME — useful in tests so we don't touch the real user dir. */
  readonly userHome?: string
}

/** A discovery candidate. `path: null` means "this source does not apply right now". */
export interface CandidateLayer {
  readonly source: ConfigSource
  readonly path: string | null
}

/**
 * Walk upward from `start` to find a `.git` entry marking the project root. Returns the
 * directory containing `.git`, or null if we reach the filesystem root without finding one.
 * Per Round 3 supplementary rule 2, returning null is the documented graceful-degradation
 * case — the caller should treat it as "no project layer", not as an error.
 */
export function findProjectRoot(start: string): string | null {
  let dir = resolve(start)
  const fsRoot = parse(dir).root
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir
    if (dir === fsRoot) return null
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Build the ordered list of candidate layers. The order — default, user, project,
 * cli-override — is the merge order; later layers override earlier ones.
 *
 * No I/O beyond the `.git` check: file existence is checked by the loader so that
 * absent files turn into skipped layers, not into errors here.
 */
export function listLayerCandidates(options: DiscoveryOptions = {}): CandidateLayer[] {
  const cwd = options.cwd ?? process.cwd()
  const home = options.userHome ?? homedir()

  const userPath = join(home, USER_CONFIG_RELATIVE)
  const projectRoot = findProjectRoot(cwd)
  const projectPath = projectRoot ? join(projectRoot, PROJECT_CONFIG_RELATIVE) : null
  const cliOverride = options.cliOverride ?? null

  return [
    { source: "default", path: null },
    { source: "user", path: userPath },
    { source: "project", path: projectPath },
    { source: "cli-override", path: cliOverride },
  ]
}
