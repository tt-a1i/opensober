// opensober — `task` tool.
//
// Round 6 scope: enforce delegation permissions and validate the args schema.
// The actual work of spawning a sub-session and driving the target agent lives
// in a later round (it needs the opencode client hooks to be wired). For now
// we return a structured acknowledgement so the agent sees that permission
// and wiring are live, just not the executor.
//
// Round 7: the stub output is shaped to look like the future real task return —
// key:value rows with caller / target / prompt preview / permission outcome.
//
// Permission rules (from v1-scope §1, enforced by assertCanDelegate):
//   1. caller.can_delegate === true
//   2. caller.readonly === true => target.readonly must also be true
//      (readonly cannot be escaped via delegation)

import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import type { ResolvedConfig } from "../../config/types"
import { formatKeyValueBlock, type KVRow, truncatePreview } from "../common/format"
import { assertCanDelegate } from "../common/guards"

// SDK-bundled Zod. See comment in read.ts for why we don't import from "zod" directly.
const z = tool.schema

const PROMPT_PREVIEW_MAX = 80

export function createTaskTool(config: ResolvedConfig): ToolDefinition {
  return tool({
    description:
      "Delegate a task to another agent. The target must exist in config. Permission " +
      "rules are enforced: the caller must have can_delegate=true, and a readonly " +
      "caller can only delegate to a readonly target (readonly cannot be escaped). " +
      "Note: this release validates permissions and args; actual sub-session execution " +
      "is wired in a later release.",
    args: {
      agent: z.string().describe("name of the target agent defined in config"),
      prompt: z.string().min(1).describe("task instructions for the target agent"),
    },
    execute: async (args, ctx): Promise<string> => {
      assertCanDelegate(ctx.agent, args.agent, config)

      const rows: KVRow[] = [
        { key: "caller", value: ctx.agent },
        { key: "target", value: args.agent },
        { key: "prompt", value: `"${truncatePreview(args.prompt, PROMPT_PREVIEW_MAX)}"` },
        { key: "permission", value: "passed" },
        { key: "readonly taint", value: "respected" },
      ]

      return [
        "task (stub — not actually executed)",
        formatKeyValueBlock(rows),
        "",
        "This release does not wire sub-session execution. Do NOT assume the work was done.",
      ].join("\n")
    },
  })
}
