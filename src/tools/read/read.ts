// opensober — `read` tool.
//
// Returns the file contents annotated with per-line content hashes. The agent
// is expected to include these hashes in any subsequent `edit` call so the edit
// layer can verify the file hasn't changed since this read.
//
// No permission gate: `read` is safe for every agent, including readonly ones.

import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import type { ResolvedConfig } from "../../config/types"
import { annotate } from "../hashline-edit"

// Use the SDK's bundled Zod instance. opencode ships its own pinned Zod and the
// tool() factory's args type is anchored to THAT instance — importing Zod from
// our own deps causes a version-marker mismatch at the type level even though
// the runtime is identical. `tool.schema` is the SDK's documented escape hatch.
const z = tool.schema

const DEFAULT_ALGORITHM = "sha1" as const

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
      // path.resolve handles absolute paths correctly: if args.file is absolute,
      // ctx.directory is ignored.
      const path = resolve(ctx.directory, args.file)

      let text: string
      try {
        text = await readFile(path, "utf8")
      } catch {
        throw new Error(`cannot read ${path}: file does not exist or is not accessible`)
      }

      return annotate(text, algorithm).annotated
    },
  })
}
