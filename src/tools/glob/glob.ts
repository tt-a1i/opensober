// opensober — `glob` tool.
//
// Fast file-pattern matching via Bun.Glob. Returns a newline-separated list of
// matching paths, sorted alphabetically, truncated at MAX_RESULTS to prevent
// context-window blowout. No permission gate — read-only, safe for all agents.

import { resolve } from "node:path"
import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import type { ResolvedConfig } from "../../config/types"

const z = tool.schema

const MAX_RESULTS = 200

export function createGlobTool(_config: ResolvedConfig): ToolDefinition {
  return tool({
    description:
      "Find files matching a glob pattern. Returns matching paths sorted alphabetically, " +
      `one per line. Truncated at ${MAX_RESULTS} results. No file contents are returned — ` +
      "use `read` to inspect a specific file.",
    args: {
      pattern: z.string().describe('glob pattern (e.g. "src/**/*.ts", "*.json")'),
      path: z.string().optional().describe("directory to search in; defaults to the project root"),
    },
    execute: async (args, ctx): Promise<string> => {
      const cwd = args.path !== undefined ? resolve(ctx.directory, args.path) : ctx.directory

      const glob = new Bun.Glob(args.pattern)
      const matches: string[] = []

      for await (const entry of glob.scan({ cwd, onlyFiles: true })) {
        matches.push(entry)
        if (matches.length >= MAX_RESULTS + 1) break
      }

      matches.sort()

      const truncated = matches.length > MAX_RESULTS
      const shown = truncated ? matches.slice(0, MAX_RESULTS) : matches

      if (shown.length === 0) {
        return `no files matching "${args.pattern}" in ${cwd}`
      }

      const header = truncated
        ? `${MAX_RESULTS} of ${matches.length}+ matches for "${args.pattern}" in ${cwd} (truncated)`
        : `${shown.length} match${shown.length === 1 ? "" : "es"} for "${args.pattern}" in ${cwd}`

      return `${header}\n\n${shown.join("\n")}`
    },
  })
}
