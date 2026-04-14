// opensober — `read` tool.
//
// Returns the file contents annotated with per-line content hashes, preceded by
// a header and (for large files) a truncation notice. Truncation is based on the
// ORIGINAL file content, not the annotated output, so the thresholds match the
// user's intuition of "how big the file actually is".
//
// Output layout:
//   file: <path> (<N> lines, <size>)
//   [Note: ... — advisory / truncation notice when file exceeds thresholds]
//
//   1#abc12345  <content>
//   ...
//
// No permission gate: `read` is safe for every agent, including readonly ones.

import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import type { ResolvedConfig } from "../../config/types"
import { formatBytes } from "../common/format"
import { parseFile } from "../hashline-edit"
import { computeLineHash, type HashAlgorithm } from "../hashline-edit/hash"

// Use the SDK's bundled Zod instance. opencode ships its own pinned Zod and the
// tool() factory's args type is anchored to THAT instance — importing Zod from
// our own deps causes a version-marker mismatch at the type level even though
// the runtime is identical. `tool.schema` is the SDK's documented escape hatch.
const z = tool.schema

const DEFAULT_ALGORITHM = "sha1" as const

/** Thresholds for truncation — based on ORIGINAL file content, not annotated output. */
const MAX_LINES = 2000
const MAX_BYTES = 200_000 // ~200 KB

const COLUMN_SEPARATOR = "  "

export function createReadTool(config: ResolvedConfig): ToolDefinition {
  const algorithm = config.tools.hashline_edit?.hash_algorithm ?? DEFAULT_ALGORITHM

  return tool({
    description:
      "Read a file and return its contents annotated with per-line content hashes. " +
      "Each line is prefixed `N#hash  ` (where N is the 1-indexed line number and hash " +
      "is an 8-character hex digest of the line text). Save these hashes — the `edit` " +
      "tool requires them to verify the file hasn't changed since you last read it. " +
      "Files exceeding 2000 lines or 200 KB are truncated to that limit.",
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

      const totalBytes = Buffer.byteLength(text, "utf8")
      const { lines: allLines } = parseFile(text)
      const totalLines = allLines.length

      // Determine how many lines to show, stopping at whichever threshold hits first.
      const { keptLines, keptBytes, truncated } = computeTruncation(allLines, totalBytes)

      // Annotate only the kept portion.
      const annotatedRows = annotateLines(keptLines, algorithm)
      const header = buildHeader(
        path,
        totalLines,
        totalBytes,
        keptLines.length,
        keptBytes,
        truncated,
      )
      return `${header}\n\n${annotatedRows}`
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Truncation
// ─────────────────────────────────────────────────────────────────────────────

interface TruncationResult {
  keptLines: readonly string[]
  keptBytes: number
  truncated: boolean
}

function computeTruncation(lines: readonly string[], _totalBytes: number): TruncationResult {
  if (lines.length <= MAX_LINES) {
    // Quick check: if line count is under threshold, check bytes.
    if (_totalBytes <= MAX_BYTES) {
      return { keptLines: lines, keptBytes: _totalBytes, truncated: false }
    }
  }

  // Walk lines, accumulating byte count, stop at whichever threshold hits first.
  let bytesSoFar = 0
  let cutIndex = lines.length // default: keep all

  for (let i = 0; i < lines.length; i++) {
    if (i >= MAX_LINES) {
      cutIndex = i
      break
    }
    // +1 for the newline separator between lines (approximate; CRLF would be +2
    // but we're measuring original bytes for threshold comparison, not exact
    // byte-for-byte. Close enough for a safety valve.)
    const lineBytes = Buffer.byteLength(lines[i] ?? "", "utf8") + 1
    if (bytesSoFar + lineBytes > MAX_BYTES) {
      cutIndex = i
      break
    }
    bytesSoFar += lineBytes
  }

  if (cutIndex >= lines.length) {
    return { keptLines: lines, keptBytes: bytesSoFar, truncated: false }
  }

  return {
    keptLines: lines.slice(0, cutIndex),
    keptBytes: bytesSoFar,
    truncated: true,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Annotation (inlined from hashline-edit/annotate.ts — we annotate a subset)
// ─────────────────────────────────────────────────────────────────────────────

function annotateLines(lines: readonly string[], algorithm: HashAlgorithm): string {
  const rows: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    const lineNum = i + 1
    const hash = computeLineHash(line, algorithm)
    rows.push(`${lineNum}#${hash}${COLUMN_SEPARATOR}${line}`)
  }
  return rows.join("\n")
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

function buildHeader(
  path: string,
  totalLines: number,
  totalBytes: number,
  shownLines: number,
  shownBytes: number,
  truncated: boolean,
): string {
  const main = `file: ${path} (${totalLines} lines, ${formatBytes(totalBytes)})`
  if (truncated) {
    return (
      `${main}\n` +
      `... (truncated: showing first ${shownLines} lines / ${formatBytes(shownBytes)} of ${totalLines} lines / ${formatBytes(totalBytes)})\n` +
      "Tip: use a more specific search with `grep` or `glob` to find what you need."
    )
  }
  if (totalLines >= MAX_LINES) {
    return `${main}\nNote: this is a large file. Consider the context cost before full-read operations.`
  }
  return main
}
