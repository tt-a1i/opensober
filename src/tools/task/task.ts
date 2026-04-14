// opensober — `task` tool.
//
// Delegates work to another agent by spawning a child session. Permission rules
// are enforced before the session is created, and the runner handles the full
// promptAsync → poll → messages lifecycle.
//
// Permission rules (from v1-scope §1, enforced by assertCanDelegate):
//   1. caller.can_delegate === true
//   2. caller.readonly === true => target.readonly must also be true
//      (readonly cannot be escaped via delegation)

import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import type { ResolvedConfig } from "../../config/types"
import { formatKeyValueBlock, type KVRow, truncatePreview } from "../common/format"
import { assertCanDelegate } from "../common/guards"
import type { ToolDependencies } from "../index"
import {
  type RunChildResult,
  runChildSession,
  TaskAbortedError,
  TaskExecutionError,
  TaskMaxTurnsError,
  TaskTimeoutError,
} from "./runner"

// SDK-bundled Zod. See comment in read.ts for why we don't import from "zod" directly.
const z = tool.schema

const PROMPT_PREVIEW_MAX = 80

export function createTaskTool(config: ResolvedConfig, deps: ToolDependencies): ToolDefinition {
  return tool({
    description:
      "Delegate a task to another agent by spawning a child session. The target must " +
      "exist in config. Permission rules are enforced: the caller must have " +
      "can_delegate=true, and a readonly caller can only delegate to a readonly target.",
    args: {
      agent: z.string().describe("name of the target agent defined in config"),
      prompt: z.string().min(1).describe("task instructions for the target agent"),
    },
    execute: async (args, ctx): Promise<string> => {
      assertCanDelegate(ctx.agent, args.agent, config)

      try {
        const result = await runChildSession(deps.client, {
          parentSessionID: ctx.sessionID,
          targetAgent: args.agent,
          prompt: args.prompt,
          abort: ctx.abort,
          directory: ctx.directory,
        })
        return formatSuccess(result, ctx.agent, args.agent)
      } catch (err) {
        return handleRunnerError(err, ctx.agent, args.agent, args.prompt)
      }
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Output formatting (Round 7 key:value style)
// ─────────────────────────────────────────────────────────────────────────────

function formatSuccess(result: RunChildResult, caller: string, target: string): string {
  const rows: KVRow[] = [
    { key: "caller", value: caller },
    { key: "target", value: target },
    { key: "child session", value: result.childSessionID },
    { key: "duration", value: `${(result.durationMs / 1000).toFixed(1)}s` },
    ...(result.model ? [{ key: "model", value: result.model }] : []),
    ...(result.cost !== undefined ? [{ key: "cost", value: `$${result.cost.toFixed(4)}` }] : []),
    ...(result.tokens
      ? [{ key: "tokens", value: `in=${result.tokens.input} out=${result.tokens.output}` }]
      : []),
    { key: "turns", value: String(result.turns) },
  ]

  return ["task completed", formatKeyValueBlock(rows), "", result.text].join("\n")
}

function handleRunnerError(err: unknown, caller: string, target: string, prompt: string): never {
  const preview = truncatePreview(prompt, PROMPT_PREVIEW_MAX)

  if (err instanceof TaskAbortedError) {
    throw new TaskAbortedError(
      `task cancelled while "${target}" was working on: "${preview}"\n\n` +
        "Action: the parent was cancelled. Re-run the parent prompt to retry.",
    )
  }
  if (err instanceof TaskTimeoutError) {
    throw new TaskTimeoutError(
      `${err.message}\n  caller: ${caller}\n  target: ${target}\n  prompt: "${preview}"\n\n` +
        "Action: the child agent did not finish in time. Consider a shorter prompt or simpler task.",
    )
  }
  if (err instanceof TaskMaxTurnsError) {
    throw new TaskMaxTurnsError(
      `${err.message}\n  caller: ${caller}\n  target: ${target}\n  prompt: "${preview}"\n\n` +
        "Action: the child agent entered a tool-call loop. Check if the prompt is too open-ended.",
    )
  }
  if (err instanceof TaskExecutionError) {
    throw new TaskExecutionError(
      `${err.message}\n  caller: ${caller}\n  target: ${target}\n\n` +
        "Action: the child agent hit a provider error. Check your API keys and model config.",
    )
  }
  throw err
}
