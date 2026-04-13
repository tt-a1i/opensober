// opensober — `read` tool.
//
// Returns the file contents annotated with per-line content hashes, preceded by a
// one-line header describing the file (and, for large files, a context-cost advisory).
// Output layout:
//
//   file: <path> (<N> lines, <size>)
//   [Note: this is a large file. ...  — only when over LARGE_FILE_LINE_THRESHOLD]
//
//   1#abc12345  <content>
//   2#...       <content>
//
// No permission gate: `read` is safe for every agent, including readonly ones.

import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import type { ResolvedConfig } from "../../config/types"
import { formatBytes } from "../common/format"
import { annotate } from "../hashline-edit"

// Use the SDK's bundled Zod instance. opencode ships its own pinned Zod and the
// tool() factory's args type is anchored to THAT instance — importing Zod from
// our own deps causes a version-marker mismatch at the type level even though
// the runtime is identical. `tool.schema` is the SDK's documented escape hatch.
const z = tool.schema

const DEFAULT_ALGORITHM = "sha1" as const
/** Line count at which we append a "this is a large file" advisory to the header. */
const LARGE_FILE_LINE_THRESHOLD = 2000

export function createReadTool(config: ResolvedConfig): ToolDefinition {
  const algorithm = config.tools.hashline_edit?.hash_algorithm ?? DEFAULT_ALGORITHM

  return tool({
    description:
      "Read a file and return its contents annotated with per-line content hashes. " +
      "Each line is prefixed `N#hash  ` (where N is the 1-indexed line number and hash " +
      "is an 8-character hex digest of the line text). Save these hashes — the `edit` " +
      "tool requires them to verify the file hasn't changed since you last read it.",
    args: {
      file: z.string().describe("absolute or cwd-relative path"),
    },
    execute: async (args, ctx): Promise<string> => {
      const path = resolve(ctx.directory, args.file)

      let text: string
      try {
        text = await readFile(path, "utf8")
      } catch {
        throw new Error(`cannot read ${path}: file does not exist or is not accessible`)
      }

      const { annotated, hashes } = annotate(text, algorithm)
      const lineCount = hashes.size
      const byteCount = Buffer.byteLength(text, "utf8")
      const header = buildHeader(path, lineCount, byteCount)
      return `${header}\n\n${annotated}`
    },
  })
}

function buildHeader(path: string, lineCount: number, byteCount: number): string {
  const main = `file: ${path} (${lineCount} lines, ${formatBytes(byteCount)})`
  if (lineCount >= LARGE_FILE_LINE_THRESHOLD) {
    return `${main}\nNote: this is a large file. Consider the context cost before full-read operations.`
  }
  return main
}
