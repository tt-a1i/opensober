// opensober — `ast_grep_replace` tool.
//
// AST-aware code replacement via @ast-grep/napi. Finds nodes matching a pattern,
// substitutes metavariables into a rewrite template, and applies edits.
//
// Permission: write-class — gated by assertCanWrite. Default dry_run=true so the
// agent sees what would change before committing.

import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import type { SgNode } from "@ast-grep/napi"
import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import type { ResolvedConfig } from "../../config/types"
import { assertCanWrite } from "../common/guards"

const z = tool.schema

const MAX_FILES = 50

async function loadAstGrep(): Promise<typeof import("@ast-grep/napi")> {
  return import("@ast-grep/napi")
}

// ─────────────────────────────────────────────────────────────────────────────
// Metavariable substitution
// ─────────────────────────────────────────────────────────────────────────────

const METAVAR_RE = /\$\$\$([A-Z_][A-Z0-9_]*)|(\$[A-Z_][A-Z0-9_]*)/g

function substituteMetavars(rewrite: string, node: SgNode): string {
  return rewrite.replace(METAVAR_RE, (full, multiName?: string, singleFull?: string) => {
    if (multiName !== undefined) {
      const matches = node.getMultipleMatches(multiName)
      return matches.map((m) => m.text()).join(", ")
    }
    if (singleFull !== undefined) {
      const name = singleFull.slice(1) // strip leading $
      const match = node.getMatch(name)
      return match !== null ? match.text() : full
    }
    return full
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool
// ─────────────────────────────────────────────────────────────────────────────

export function createAstGrepReplaceTool(_config: ResolvedConfig): ToolDefinition {
  return tool({
    description:
      "AST-aware code replacement. Finds nodes matching a pattern, applies a rewrite " +
      "template with metavariable substitution ($VAR for single, $$$VAR for multiple). " +
      `Default dry_run=true — set to false to write changes. Max ${MAX_FILES} files per call. ` +
      "Built-in languages: TypeScript, JavaScript, TSX, HTML, CSS.",
    args: {
      pattern: z.string().describe("ast-grep search pattern"),
      rewrite: z.string().describe("replacement template with $VAR metavariables"),
      lang: z.string().describe("language name"),
      path: z.string().optional().describe("directory to search; defaults to project root"),
      dry_run: z
        .boolean()
        .optional()
        .describe("if true (default), show what would change without writing"),
    },
    execute: async (args, ctx): Promise<string> => {
      const { findInFiles, parse } = await loadAstGrep()
      const dryRun = args.dry_run !== false // default true
      if (!dryRun) {
        assertCanWrite(ctx.agent, _config)
      }

      const searchPath = args.path !== undefined ? resolve(ctx.directory, args.path) : ctx.directory

      // Phase 1: find files with matches.
      const matchedFiles = new Set<string>()
      try {
        await findInFiles(
          args.lang,
          {
            paths: [searchPath],
            matcher: { rule: { pattern: args.pattern } },
          },
          (_err, nodes) => {
            if (_err !== null) return
            for (const node of nodes) {
              matchedFiles.add(node.getRoot().filename())
              if (matchedFiles.size >= MAX_FILES + 1) return
            }
          },
        )
      } catch (e) {
        throw new Error(`ast_grep_replace failed: ${(e as Error).message}`)
      }

      if (matchedFiles.size === 0) {
        return `no AST matches for pattern "${args.pattern}" (lang: ${args.lang}) in ${searchPath}`
      }

      const truncated = matchedFiles.size > MAX_FILES
      const files = [...matchedFiles].slice(0, MAX_FILES).sort()

      // Phase 2: per-file replacement.
      const results: string[] = []
      let totalReplacements = 0

      for (const filePath of files) {
        const src = readFileSync(filePath, "utf8")
        const root = parse(args.lang, src)
        const nodes = root.root().findAll({ rule: { pattern: args.pattern } })

        if (nodes.length === 0) continue

        // Build edits in reverse order (so offsets don't shift).
        const edits = nodes
          .map((node) => {
            const replacement = substituteMetavars(args.rewrite, node)
            return node.replace(replacement)
          })
          .sort((a, b) => b.startPos - a.startPos)

        // Apply edits.
        let result = src
        for (const edit of edits) {
          result = result.slice(0, edit.startPos) + edit.insertedText + result.slice(edit.endPos)
        }

        totalReplacements += nodes.length

        if (dryRun) {
          results.push(
            `${filePath}: ${nodes.length} replacement${nodes.length === 1 ? "" : "s"} (dry run)`,
          )
        } else {
          writeFileSync(filePath, result, "utf8")
          results.push(
            `${filePath}: ${nodes.length} replacement${nodes.length === 1 ? "" : "s"} written`,
          )
        }
      }

      const mode = dryRun ? "dry run" : "applied"
      const header = truncated
        ? `${totalReplacements} replacements across ${MAX_FILES}+ files (${mode}, truncated)`
        : `${totalReplacements} replacement${totalReplacements === 1 ? "" : "s"} across ${files.length} file${files.length === 1 ? "" : "s"} (${mode})`

      return `${header}\n\n${results.join("\n")}`
    },
  })
}
