// opensober — `ast_grep_search` tool.
//
// AST-aware code search via @ast-grep/napi. Supports metavariable patterns
// like `console.log($A)`. Built-in languages: TypeScript, JavaScript, TSX,
// HTML, CSS. Other languages work if registered via ast-grep configuration.
//
// No permission gate — read-only, safe for all agents.

import { resolve } from "node:path"
import { findInFiles } from "@ast-grep/napi"
import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import type { ResolvedConfig } from "../../config/types"

const z = tool.schema

const MAX_MATCHES = 500

interface Match {
  readonly file: string
  readonly line: number
  readonly col: number
  readonly text: string
}

export function createAstGrepSearchTool(_config: ResolvedConfig): ToolDefinition {
  return tool({
    description:
      "AST-aware code pattern search using ast-grep. Supports metavariable patterns " +
      "(e.g. `console.log($A)`, `function $NAME($$$PARAMS) { $$$BODY }`). " +
      `Returns matching code with file:line:col locations. Truncated at ${MAX_MATCHES} matches. ` +
      "Built-in languages: TypeScript, JavaScript, TSX, HTML, CSS.",
    args: {
      pattern: z.string().describe("ast-grep pattern with $VAR / $$$VAR metavariables"),
      lang: z.string().describe("language name (e.g. TypeScript, JavaScript, Tsx, Html, Css)"),
      path: z.string().optional().describe("directory to search in; defaults to the project root"),
    },
    execute: async (args, ctx): Promise<string> => {
      const searchPath = args.path !== undefined ? resolve(ctx.directory, args.path) : ctx.directory
      const matches: Match[] = []
      let truncated = false

      try {
        await findInFiles(
          args.lang,
          {
            paths: [searchPath],
            matcher: { rule: { pattern: args.pattern } },
          },
          (_err, nodes) => {
            if (_err !== null || truncated) return
            for (const node of nodes) {
              if (matches.length >= MAX_MATCHES) {
                truncated = true
                return
              }
              const range = node.range()
              matches.push({
                file: node.getRoot().filename(),
                line: range.start.line + 1,
                col: range.start.column + 1,
                text: node.text(),
              })
            }
          },
        )
      } catch (e) {
        throw new Error(`ast_grep_search failed: ${(e as Error).message}`)
      }

      if (matches.length === 0) {
        return `no AST matches for pattern "${args.pattern}" (lang: ${args.lang}) in ${searchPath}`
      }

      const lines = matches.map((m) => `${m.file}:${m.line}:${m.col}  ${m.text.split("\n")[0]}`)
      const header = truncated
        ? `${MAX_MATCHES}+ AST matches for "${args.pattern}" (lang: ${args.lang}) in ${searchPath} (truncated)`
        : `${matches.length} AST match${matches.length === 1 ? "" : "es"} for "${args.pattern}" (lang: ${args.lang}) in ${searchPath}`

      return `${header}\n\n${lines.join("\n")}`
    },
  })
}
