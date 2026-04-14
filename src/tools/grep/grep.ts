// opensober — `grep` tool.
//
// Content search via ripgrep (@vscode/ripgrep ships the binary). Returns
// matching lines with file path + line number, truncated at MAX_RESULTS.
// No permission gate — read-only, safe for all agents.

import { resolve } from "node:path"
import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import type { ResolvedConfig } from "../../config/types"

const z = tool.schema

const MAX_RESULTS = 200

/** Resolve the rg binary from @vscode/ripgrep. */
function rgPath(): string {
  try {
    // @vscode/ripgrep exports `rgPath` as the path to the binary.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("@vscode/ripgrep")
    return mod.rgPath as string
  } catch {
    // Fallback: assume rg is on PATH.
    return "rg"
  }
}

export function createGrepTool(_config: ResolvedConfig): ToolDefinition {
  const rg = rgPath()

  return tool({
    description:
      "Search file contents using a regular expression pattern (powered by ripgrep). " +
      "Returns matching lines with file:line:content format, one per line. " +
      `Truncated at ${MAX_RESULTS} results. Use the \`glob\` argument to filter by filename pattern.`,
    args: {
      pattern: z.string().describe("regex pattern to search for"),
      path: z
        .string()
        .optional()
        .describe("directory or file to search in; defaults to the project root"),
      glob: z.string().optional().describe('file glob filter (e.g. "*.ts", "*.{js,jsx}")'),
    },
    execute: async (args, ctx): Promise<string> => {
      const cwd = ctx.directory
      const searchPath = args.path !== undefined ? resolve(cwd, args.path) : cwd

      const rgArgs = [
        "--no-heading",
        "--line-number",
        "--color=never",
        `--max-count=${MAX_RESULTS}`,
      ]

      if (args.glob !== undefined) {
        rgArgs.push(`--glob=${args.glob}`)
      }

      rgArgs.push("--", args.pattern, searchPath)

      const proc = Bun.spawn([rg, ...rgArgs], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      })

      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const exitCode = await proc.exited

      // rg exit codes: 0 = matches found, 1 = no matches, 2 = error.
      if (exitCode === 1 || (exitCode === 0 && stdout.trim() === "")) {
        return `no matches for pattern "${args.pattern}" in ${searchPath}`
      }
      if (exitCode === 2) {
        throw new Error(`grep failed: ${stderr.trim() || "unknown ripgrep error"}`)
      }

      const lines = stdout.trimEnd().split("\n")
      const truncated = lines.length >= MAX_RESULTS
      const shown = truncated ? lines.slice(0, MAX_RESULTS) : lines

      const header = truncated
        ? `${MAX_RESULTS}+ matches for "${args.pattern}" in ${searchPath} (truncated)`
        : `${shown.length} match${shown.length === 1 ? "" : "es"} for "${args.pattern}" in ${searchPath}`

      return `${header}\n\n${shown.join("\n")}`
    },
  })
}
