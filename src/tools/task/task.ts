// opensober — `task` tool.
//
// Multi-mode tool for delegating work to other agents. Three modes:
//   Launch — spawn a child session (sync or background)
//   Query  — check status/result of a background task
//   Cancel — cancel a running background task
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
import type { BackgroundTask, BackgroundTaskManager } from "./manager"
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

// ─────────────────────────────────────────────────────────────────────────────
// Model parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseModel(modelStr: string): { providerID: string; modelID: string } {
  const trimmed = modelStr.trim()
  const slashIdx = trimmed.indexOf("/")
  if (slashIdx <= 0 || slashIdx === trimmed.length - 1) {
    throw new Error(
      `invalid model format: "${modelStr}". Expected "providerID/modelID" (e.g. "anthropic/claude-sonnet-4-6").`,
    )
  }
  return {
    providerID: trimmed.slice(0, slashIdx),
    modelID: trimmed.slice(slashIdx + 1),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool factory
// ─────────────────────────────────────────────────────────────────────────────

export function createTaskTool(config: ResolvedConfig, deps: ToolDependencies): ToolDefinition {
  return tool({
    description:
      "Delegate a task to another agent. Three modes:\n" +
      "  Launch: task({ agent, prompt }) — sync execution, blocks until done\n" +
      "  Background: task({ agent, prompt, background: true }) — returns immediately, notifies when done\n" +
      "  Query: task({ task_id }) — check status/result of a background task\n" +
      "  Cancel: task({ task_id, cancel: true }) — cancel a running background task\n" +
      "Optional: model parameter overrides the target agent's default model (format: 'providerID/modelID').",
    args: {
      // Launch mode
      agent: z.string().optional().describe("target agent name (required for launching a task)"),
      prompt: z.string().optional().describe("task instructions (required for launching a task)"),
      background: z
        .boolean()
        .optional()
        .default(false)
        .describe("if true, launch in background and return immediately"),
      model: z
        .string()
        .optional()
        .describe("model override as 'providerID/modelID' (e.g. 'anthropic/claude-sonnet-4-6')"),
      // Query/Cancel mode
      task_id: z
        .string()
        .optional()
        .describe("child session ID of a background task to query or cancel"),
      cancel: z
        .boolean()
        .optional()
        .default(false)
        .describe("if true with task_id, cancel the running task"),
    },
    execute: async (args, ctx): Promise<string> => {
      const agent = args.agent as string | undefined
      const prompt = args.prompt as string | undefined
      const background = (args.background ?? false) as boolean
      const model = args.model as string | undefined
      const taskId = args.task_id as string | undefined
      const cancel = (args.cancel ?? false) as boolean

      // ── Validate arg combinations ──
      if (!agent && !taskId) {
        throw new Error("at least one of 'agent' or 'task_id' must be provided")
      }
      if (taskId && (agent || prompt || model || background)) {
        throw new Error(
          "query/cancel mode: only 'task_id' and 'cancel' are accepted; " +
            "'agent', 'prompt', 'model', and 'background' must not be provided",
        )
      }
      if (cancel && !taskId) {
        throw new Error("'cancel' requires 'task_id'")
      }

      // ── Query/Cancel mode ──
      if (taskId) {
        if (cancel) {
          return handleCancel(taskId, deps.backgroundManager)
        }
        return handleQuery(taskId, deps.backgroundManager)
      }

      // ── Launch mode ──
      if (!agent || !prompt) {
        throw new Error("launch mode requires both 'agent' and 'prompt'")
      }

      assertCanDelegate(ctx.agent, agent, config)

      const parsedModel = model ? parseModel(model) : undefined

      if (background) {
        return handleBackgroundLaunch({ agent, prompt, model }, ctx, parsedModel, deps)
      }
      return handleSyncLaunch({ agent, prompt }, ctx, parsedModel, deps)
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

interface LaunchArgs {
  agent: string
  prompt: string
  model?: string | undefined
}

interface ExecuteContext {
  sessionID: string
  agent: string
  directory: string
  abort: AbortSignal
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleSyncLaunch(
  args: LaunchArgs,
  ctx: ExecuteContext,
  model: { providerID: string; modelID: string } | undefined,
  deps: ToolDependencies,
): Promise<string> {
  try {
    const result = await runChildSession(deps.client, {
      parentSessionID: ctx.sessionID,
      targetAgent: args.agent,
      prompt: args.prompt,
      abort: ctx.abort,
      directory: ctx.directory,
      ...(model ? { model } : {}),
    })
    return formatSuccess(result, ctx.agent, args.agent)
  } catch (err) {
    return handleRunnerError(err, ctx.agent, args.agent, args.prompt)
  }
}

async function handleBackgroundLaunch(
  args: LaunchArgs,
  ctx: ExecuteContext,
  model: { providerID: string; modelID: string } | undefined,
  deps: ToolDependencies,
): Promise<string> {
  // Check capacity BEFORE creating the child session to prevent orphaned sessions.
  if (!deps.backgroundManager.canLaunch()) {
    throw new Error(
      "maximum concurrent background tasks reached. " +
        "Wait for a running task to complete before launching another.",
    )
  }

  const createRes = await deps.client.session.create({
    body: {
      parentID: ctx.sessionID,
      title: `task: ${args.agent}`,
    },
    query: { directory: ctx.directory },
    throwOnError: true,
  })
  const childSessionID = (createRes.data as { id: string }).id

  await deps.client.session.promptAsync({
    path: { id: childSessionID },
    body: {
      agent: args.agent,
      parts: [{ type: "text", text: args.prompt }],
      ...(model ? { model } : {}),
    },
    throwOnError: true,
  })

  deps.backgroundManager.launch(childSessionID, ctx.sessionID, args.agent)

  const modelDisplay = args.model ?? "default"
  const rows: KVRow[] = [
    { key: "task_id", value: childSessionID },
    { key: "agent", value: args.agent },
    { key: "model", value: modelDisplay },
  ]

  return [
    "background task launched",
    formatKeyValueBlock(rows),
    "",
    "The task is running in the background. You will be notified when it completes.",
    `To check status: task({ task_id: "${childSessionID}" })`,
    `To cancel: task({ task_id: "${childSessionID}", cancel: true })`,
  ].join("\n")
}

function handleQuery(taskId: string, manager: BackgroundTaskManager): string {
  const task = manager.getTask(taskId)
  if (!task) {
    throw new Error(`unknown task_id: "${taskId}"`)
  }

  const elapsedMs = task.durationMs ?? Date.now() - task.startedAt
  const elapsedStr = `${(elapsedMs / 1000).toFixed(1)}s`

  const rows: KVRow[] = [
    { key: "task_id", value: task.childSessionID },
    { key: "agent", value: task.targetAgent },
    { key: "status", value: task.status },
    { key: "elapsed", value: elapsedStr },
  ]

  if (task.model) {
    rows.push({ key: "model", value: task.model })
  }

  const parts = ["background task status", formatKeyValueBlock(rows)]

  if (task.status === "completed" && task.result) {
    parts.push("", task.result)
  } else if (task.status === "error" && task.error) {
    parts.push("", `error: ${task.error}`)
  } else if (task.status === "timeout" && task.error) {
    parts.push("", `timeout: ${task.error}`)
  } else if (task.status === "cancelled") {
    parts.push("", "task was cancelled")
  } else if (task.status === "running") {
    parts.push("", `To cancel: task({ task_id: "${taskId}", cancel: true })`)
  }

  return parts.join("\n")
}

async function handleCancel(taskId: string, manager: BackgroundTaskManager): Promise<string> {
  const cancelled = await manager.cancel(taskId)
  if (!cancelled) {
    return `task not found or already finished: "${taskId}"`
  }
  return `task ${taskId} cancelled`
}

// ─────────────────────────────────────────────────────────────────────────────
// Output formatting (Round 7 key:value style)
// ─────────────────────────────────────────────────────────────────────────────

export function formatSuccess(result: RunChildResult, caller: string, target: string): string {
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

// ─────────────────────────────────────────────────────────────────────────────
// Notification formatter (used by the tool.execute.after hook in index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export function formatTaskNotification(task: BackgroundTask): string {
  const durationMs = task.durationMs ?? Date.now() - task.startedAt
  const rows: KVRow[] = [
    { key: "task_id", value: task.childSessionID },
    { key: "agent", value: task.targetAgent },
    { key: "status", value: task.status },
    { key: "duration", value: `${(durationMs / 1000).toFixed(1)}s` },
    { key: "model", value: task.model ?? "unknown" },
  ]

  const header =
    task.status === "completed" ? "[Background task completed]" : `[Background task ${task.status}]`
  const parts = [header, formatKeyValueBlock(rows)]

  if (task.status === "completed") {
    parts.push("", `Use task({ task_id: "${task.childSessionID}" }) to retrieve the full result.`)
  } else if (task.error) {
    parts.push("", `Error: ${task.error}`)
  }

  return parts.join("\n")
}
