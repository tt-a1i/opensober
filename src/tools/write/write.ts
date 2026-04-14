// opensober — `write` tool.
//
// Creates a new file (or overwrites an existing one when explicitly requested).
// Behaviour:
//   * Permission: writable agents only (assertCanWrite at the top).
//   * By default refuses to overwrite — agents must use `edit` for existing files.
//   * Parent directories are created automatically.
//
// Output shaping: structured key:value block with path, line count, size, mode.

import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import type { ResolvedConfig } from "../../config/types"
import { formatBytes, formatKeyValueBlock, type KVRow } from "../common/format"
import { assertCanWrite } from "../common/guards"

// SDK-bundled Zod — avoid importing from "zod" directly (version mismatch).
const z = tool.schema

export function createWriteTool(config: ResolvedConfig): ToolDefinition {
  return tool({
    description:
      "Create a new file with the given content. By default, refuses to overwrite an " +
      "existing file — use the `edit` tool for modifications, or set overwrite=true " +
      "to replace the file entirely.",
    args: {
      file: z.string().describe("absolute or cwd-relative path for the new file"),
      content: z.string().describe("file content to write"),
      overwrite: z
        .boolean()
        .optional()
        .default(false)
        .describe("if true, replace an existing file instead of erroring"),
    },
    execute: async (args, ctx): Promise<string> => {
      assertCanWrite(ctx.agent, config)

      const path = resolve(ctx.directory, args.file)

      await mkdir(dirname(path), { recursive: true })

      // When overwrite is false, use the 'wx' flag for atomic create — fails with
      // EEXIST if the file already exists, eliminating the TOCTOU race between a
      // stat() check and writeFile().
      let mode: "create" | "overwrite"
      if (args.overwrite) {
        mode = "overwrite"
        await writeFile(path, args.content, "utf8")
      } else {
        try {
          await writeFile(path, args.content, { encoding: "utf8", flag: "wx" })
          mode = "create"
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code
          if (code === "EEXIST") {
            throw new Error(
              `cannot write ${path}: file already exists. Use the 'edit' tool to modify existing files, or set overwrite=true to replace.`,
            )
          }
          throw err
        }
      }

      const lines = args.content === "" ? 0 : args.content.split(/\r\n|\n/).length
      const size = Buffer.byteLength(args.content, "utf8")

      const rows: KVRow[] = [
        { key: "lines", value: String(lines) },
        { key: "size", value: formatBytes(size) },
        { key: "mode", value: mode },
      ]

      const label = mode === "overwrite" ? "overwritten" : "created"
      return `${label}: ${path}\n${formatKeyValueBlock(rows)}`
    },
  })
}
