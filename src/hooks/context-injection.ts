// opensober — AGENTS.md context injection.
//
// When the `read` tool is called, we walk from the read file's directory upward
// to the project root (.git), collecting any AGENTS.md files along the way.
// Their content is appended to the tool output so the agent "absorbs" project
// conventions as it reads code.
//
// Per-session cache: once an AGENTS.md at a given directory has been injected
// into a session, we don't inject it again. This keeps repeated reads in the
// same area from ballooning the context. The cache is keyed by sessionID and
// cleared when the session changes (a new sessionID starts fresh).
//
// Scope: v1 only injects AGENTS.md. No README.md, no .rules/*, no frontmatter
// globs. These can be added as separate iterations without changing this module.

import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

// ─────────────────────────────────────────────────────────────────────────────
// Per-session cache
// ─────────────────────────────────────────────────────────────────────────────

// Map<sessionID, Set<absoluteDirPath>> — tracks which directories' AGENTS.md
// have already been injected for a given session.
const injectedDirs = new Map<string, Set<string>>()

function getOrCreateSessionCache(sessionID: string): Set<string> {
  let cache = injectedDirs.get(sessionID)
  if (cache === undefined) {
    cache = new Set()
    injectedDirs.set(sessionID, cache)
  }
  return cache
}

/** Clear the cache for a session (e.g. on compaction or deletion). */
export function clearSessionCache(sessionID: string): void {
  injectedDirs.delete(sessionID)
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENTS.md discovery
// ─────────────────────────────────────────────────────────────────────────────

interface ContextFile {
  /** Absolute directory where the AGENTS.md was found. */
  readonly dir: string
  /** Absolute path to the AGENTS.md file. */
  readonly path: string
  /** File content (UTF-8). */
  readonly content: string
}

/**
 * Walk from `startDir` upward until we find a `.git` directory (project root)
 * or hit the filesystem root. At each level, collect AGENTS.md if it exists.
 * Returns root-first ordering (lowest priority first, closest directory last).
 */
export function collectAgentsMd(startDir: string): ContextFile[] {
  const results: ContextFile[] = []
  let dir = resolve(startDir)
  const fsRoot = dirname(dir) === dir ? dir : undefined

  while (true) {
    const agentsPath = join(dir, "AGENTS.md")
    if (existsSync(agentsPath)) {
      try {
        const content = readFileSync(agentsPath, "utf8").trim()
        if (content.length > 0) {
          results.push({ dir, path: agentsPath, content })
        }
      } catch {
        // Non-fatal: skip unreadable files.
      }
    }

    // Stop at project root (has .git) or filesystem root.
    if (existsSync(join(dir, ".git"))) break
    const parent = dirname(dir)
    if (parent === dir || parent === fsRoot) break
    dir = parent
  }

  // Root-first ordering: reverse so the project-root AGENTS.md is first.
  results.reverse()
  return results
}

// ─────────────────────────────────────────────────────────────────────────────
// Injection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given the output of a `read` tool call, append any not-yet-injected AGENTS.md
 * files discovered between the read file's directory and the project root.
 *
 * Returns the (possibly augmented) output string.
 */
export function injectContext(toolOutput: string, filePath: string, sessionID: string): string {
  const fileDir = dirname(resolve(filePath))
  const contextFiles = collectAgentsMd(fileDir)

  if (contextFiles.length === 0) return toolOutput

  const cache = getOrCreateSessionCache(sessionID)
  const newBlocks: string[] = []

  for (const cf of contextFiles) {
    if (cache.has(cf.dir)) continue
    cache.add(cf.dir)
    newBlocks.push(`[Context: ${cf.path}]\n${cf.content}`)
  }

  if (newBlocks.length === 0) return toolOutput

  return `${toolOutput}\n\n${newBlocks.join("\n\n")}`
}
