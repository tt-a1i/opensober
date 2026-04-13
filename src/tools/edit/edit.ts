// opensober — `edit` tool.
//
// Applies a batch of hash-anchored edits to a file. Behaviour:
//   * Permission: writable agents only (assertCanWrite at the top).
//   * File must already exist — creating new files is a separate tool concern.
//   * Each edit carries expected_hashes verifying the lines haven't changed since
//     the agent's last read. Mismatch aborts the WHOLE batch (no partial apply).
//   * File metadata (BOM, newline style, trailing-newline) is preserved by
//     the hashline-edit layer's parseFile/reconstructFile round trip.
//
// Errors from the algorithm layer (HashMismatchError, EditRangeError,
// EditOverlapError) already carry retry-friendly messages, so we let them
// propagate unwrapped — formatting is the caller's job (CLI, opencode).

import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import type { ResolvedConfig } from "../../config/types"
import { assertCanWrite } from "../common/guards"
import { applyEdits } from "../hashline-edit"

// SDK-bundled Zod. See comment in read.ts for why we don't import from "zod" directly.
const z = tool.schema

const DEFAULT_ALGORITHM = "sha1" as const

// Zod rejects an out-of-shape edit before our algorithm layer gets a chance —
// the algorithm layer's validation is still there as defense-in-depth, but
// Zod surfaces clearer per-field errors to the agent at the wire layer.
const EditSchema = z.object({
  lines: z
    .tuple([z.number().int().positive(), z.number().int().positive()])
    .describe("1-indexed [startLine, endLine] inclusive"),
  expected_hashes: z
    .array(z.string())
    .describe("one 8-char hex hash per line in the range, as returned by `read`"),
  replacement: z
    .string()
    .describe(
      "replacement text. Empty string deletes the range; multi-line strings " +
        "split on \\n (and \\r\\n) into multiple lines; trailing newline = trailing blank line.",
    ),
})

export function createEditTool(config: ResolvedConfig): ToolDefinition {
  const algorithm = config.tools.hashline_edit?.hash_algorithm ?? DEFAULT_ALGORITHM

  return tool({
    description:
      "Apply a batch of line-range edits to an existing file. Each edit carries the " +
      "expected per-line content hashes returned by `read`. Edits are atomic: if any " +
      "hash mismatches or any range is invalid, NO changes are written. On hash mismatch " +
      "the file has changed since you last read it — re-read and try again.",
    args: {
      file: z.string().describe("absolute or cwd-relative path of an EXISTING file"),
      edits: z.array(EditSchema).min(1),
    },
    execute: async (args, ctx): Promise<string> => {
      assertCanWrite(ctx.agent, config)

      const path = resolve(ctx.directory, args.file)

      let text: string
      try {
        text = await readFile(path, "utf8")
      } catch {
        throw new Error(
          `cannot edit ${path}: file does not exist. ` +
            "The `edit` tool only modifies existing files; create it first.",
        )
      }

      // applyEdits throws HashMismatchError / EditRangeError / EditOverlapError on
      // validation failures — we let those surface unwrapped so the agent sees the
      // specific remediation hints the algorithm layer encodes.
      const next = applyEdits(text, args.edits, algorithm)
      await writeFile(path, next, "utf8")

      return `applied ${args.edits.length} edit(s) to ${path}`
    },
  })
}
