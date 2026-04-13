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
// Output shaping (Round 7):
//   * Success: structured key:value block with what was changed.
//   * Errors from the algorithm layer are re-thrown with an appended "Action:" line
//     so the agent has a concrete next step (re-read, split edits, check ranges).

import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import type { ResolvedConfig } from "../../config/types"
import { formatKeyValueBlock, type KVRow } from "../common/format"
import { assertCanWrite } from "../common/guards"
import {
  applyEdits,
  EditOverlapError,
  EditRangeError,
  type FileMetadata,
  HashMismatchError,
  parseFile,
} from "../hashline-edit"

// SDK-bundled Zod. See comment in read.ts for why we don't import from "zod" directly.
const z = tool.schema

const DEFAULT_ALGORITHM = "sha1" as const

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

// ─────────────────────────────────────────────────────────────────────────────
// Error wrapping — append a concrete remediation hint to algorithm-layer errors
// ─────────────────────────────────────────────────────────────────────────────

function withAction<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    if (err instanceof HashMismatchError) {
      throw new HashMismatchError(
        `${err.message}\n\nAction: re-read the file with the 'read' tool to get fresh hashes, then retry.`,
      )
    }
    if (err instanceof EditRangeError) {
      throw new EditRangeError(
        `${err.message}\n\nAction: re-read the file and verify your line numbers are within bounds.`,
      )
    }
    if (err instanceof EditOverlapError) {
      throw new EditOverlapError(
        `${err.message}\n\nAction: split your edits so that no two edits target overlapping line ranges.`,
      )
    }
    throw err
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Success summary
// ─────────────────────────────────────────────────────────────────────────────

function formatSuccess(
  path: string,
  edits: readonly { readonly lines: readonly [number, number] }[],
  beforeLines: number,
  afterLines: number,
  meta: FileMetadata,
): string {
  const delta = afterLines - beforeLines
  const deltaStr = delta === 0 ? "0" : delta > 0 ? `+${delta}` : `${delta}`
  const rangesStr = edits.map((e) => `[${e.lines[0]},${e.lines[1]}]`).join(", ")
  const lineEnding = meta.newline === "\n" ? "LF" : "CRLF"

  const rows: KVRow[] = [
    { key: "edits applied", value: String(edits.length) },
    { key: "line ranges", value: rangesStr },
    { key: "lines before", value: String(beforeLines) },
    { key: "lines after", value: String(afterLines) },
    { key: "net change", value: deltaStr },
    { key: "line ending", value: `${lineEnding} (preserved)` },
    { key: "BOM", value: meta.hasBOM ? "present (preserved)" : "none (preserved)" },
  ]

  return `edited: ${path}\n${formatKeyValueBlock(rows)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool factory
// ─────────────────────────────────────────────────────────────────────────────

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

      const before = parseFile(text)
      const next = withAction(() => applyEdits(text, args.edits, algorithm))
      const after = parseFile(next)

      await writeFile(path, next, "utf8")

      return formatSuccess(path, args.edits, before.lines.length, after.lines.length, before.meta)
    },
  })
}
