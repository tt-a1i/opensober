// opensober — background task manager.
//
// Tracks and polls background child sessions that were launched asynchronously.
// Uses a setTimeout chain (not setInterval) so each tick completes before the
// next is scheduled, preventing overlapping polls.
//
// Notification strategy (two-tier, inspired by OmO):
//   1. Primary: session.promptAsync({ noReply: true }) — pushes notification to
//      the parent session immediately. Works when parent is idle or between turns.
//   2. Fallback: consumeCompleted() — the tool.execute.after hook in index.ts
//      picks up any tasks that weren't push-notified and injects them into the
//      next tool output. This catches the case where promptAsync fails.
//
// Lifecycle: launch() → startPolling() → pollOnce() → scheduleNext() → ...
// The loop auto-starts on the first launch and auto-stops when no tasks remain.

import type { OpencodeClient } from "@opencode-ai/sdk"
import { extractTextFromParts, findLastAssistantMessage } from "./message-helpers"

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface BackgroundTask {
  readonly childSessionID: string
  readonly parentSessionID: string
  readonly targetAgent: string
  readonly startedAt: number
  status: "running" | "completed" | "error" | "timeout" | "cancelled"
  result?: string | undefined
  model?: string | undefined
  durationMs?: number | undefined
  error?: string | undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_CONCURRENT = 5
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes
const POLL_INTERVAL_MS = 3_000 // 3 seconds
const STALE_TASK_TTL_MS = 30 * 60 * 1000 // 30 minutes — purge consumed tasks after this

// ─────────────────────────────────────────────────────────────────────────────
// Manager
// ─────────────────────────────────────────────────────────────────────────────

/** Formatter that turns a completed task into a notification string. */
export type TaskNotificationFormatter = (task: BackgroundTask) => string

export class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTask>()
  private consumed = new Set<string>()
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private client: OpencodeClient
  private timeoutMs: number
  private pollIntervalMs: number
  private notifyFormatter: TaskNotificationFormatter | null

  constructor(
    client: OpencodeClient,
    opts?: {
      timeoutMs?: number
      pollIntervalMs?: number
      /** If provided, completed tasks are push-notified to the parent via promptAsync. */
      notifyFormatter?: TaskNotificationFormatter
    },
  ) {
    this.client = client
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.pollIntervalMs = opts?.pollIntervalMs ?? POLL_INTERVAL_MS
    this.notifyFormatter = opts?.notifyFormatter ?? null
  }

  /** Check if a new background task can be launched without exceeding the limit. */
  canLaunch(): boolean {
    const running = [...this.tasks.values()].filter((t) => t.status === "running").length
    return running < MAX_CONCURRENT
  }

  /**
   * Register a background task. Returns the childSessionID (used as task ID).
   * Throws if MAX_CONCURRENT running tasks is exceeded.
   * Prefer calling canLaunch() before creating the child session to avoid orphans.
   */
  launch(childSessionID: string, parentSessionID: string, targetAgent: string): string {
    if (!this.canLaunch()) {
      throw new Error(
        `maximum concurrent background tasks reached (${MAX_CONCURRENT}). ` +
          "Wait for a running task to complete before launching another.",
      )
    }

    const task: BackgroundTask = {
      childSessionID,
      parentSessionID,
      targetAgent,
      startedAt: Date.now(),
      status: "running",
    }
    this.tasks.set(childSessionID, task)
    this.startPolling()
    return childSessionID
  }

  /** Get a task by ID. Returns undefined if not found. */
  getTask(id: string): BackgroundTask | undefined {
    return this.tasks.get(id)
  }

  /**
   * Get all completed tasks for a given parent session that haven't been
   * consumed yet. After calling this, those tasks won't appear again.
   */
  consumeCompleted(parentSessionID: string): BackgroundTask[] {
    const results: BackgroundTask[] = []
    for (const task of this.tasks.values()) {
      if (
        task.parentSessionID === parentSessionID &&
        task.status !== "running" &&
        !this.consumed.has(task.childSessionID)
      ) {
        results.push(task)
        this.consumed.add(task.childSessionID)
      }
    }
    // Prune stale consumed tasks to prevent unbounded memory growth.
    const now = Date.now()
    for (const [id, task] of this.tasks) {
      if (this.consumed.has(id) && now - task.startedAt > STALE_TASK_TTL_MS) {
        this.tasks.delete(id)
        this.consumed.delete(id)
      }
    }
    return results
  }

  /** Cancel a running task. Calls client.session.abort(). */
  async cancel(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId)
    if (!task || task.status !== "running") return false

    try {
      await this.client.session.abort({ path: { id: taskId } })
    } catch {
      // Best-effort; child may already be done or unreachable.
    }
    task.status = "cancelled"
    task.durationMs = Date.now() - task.startedAt
    await this.pushNotify(task)
    return true
  }

  /** Stop the polling loop and abort all running tasks. Called on plugin dispose. */
  async dispose(): Promise<void> {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }

    const running = [...this.tasks.values()].filter((t) => t.status === "running")
    await Promise.allSettled(running.map((t) => this.cancel(t.childSessionID)))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Polling internals
  // ───────────────────────────────────────────────────────────────────────────

  /** Start the setTimeout chain if not already running. */
  private startPolling(): void {
    if (this.pollTimer !== null) return
    this.scheduleNext()
  }

  /** Schedule the next tick (setTimeout chain, NOT setInterval). */
  private scheduleNext(): void {
    const hasRunning = [...this.tasks.values()].some((t) => t.status === "running")
    if (!hasRunning) {
      this.pollTimer = null
      return
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollOnce()
      } catch {
        // Defensive: pollOnce should never throw, but keep polling if it does.
      }
      this.scheduleNext()
    }, this.pollIntervalMs)
  }

  /** One polling tick. Check all running tasks. */
  private async pollOnce(): Promise<void> {
    let statusMap: Record<string, { type: string }> = {}
    try {
      const res = await this.client.session.status({ throwOnError: true })
      statusMap = (res.data ?? {}) as Record<string, { type: string }>
    } catch {
      // If status fetch fails, skip this tick entirely.
      return
    }

    for (const task of this.tasks.values()) {
      if (task.status !== "running") continue

      try {
        // Check timeout first.
        if (Date.now() - task.startedAt > this.timeoutMs) {
          try {
            await this.client.session.abort({ path: { id: task.childSessionID } })
          } catch {
            // Best-effort abort.
          }
          task.status = "timeout"
          task.durationMs = Date.now() - task.startedAt
          task.error = `exceeded ${Math.round(this.timeoutMs / 1000)}s timeout`
          await this.pushNotify(task)
          continue
        }

        const childStatus = statusMap[task.childSessionID]?.type

        // "idle" or missing from map → task is done.
        if (childStatus === "idle" || childStatus === undefined) {
          await this.resolveTask(task)
        }
      } catch {
        // One failed check must not kill the loop for other tasks.
        task.status = "error"
        task.durationMs = Date.now() - task.startedAt
        task.error = "failed to check task status"
        await this.pushNotify(task)
      }
    }
  }

  /** Fetch final messages for a completed task and update its fields. */
  private async resolveTask(task: BackgroundTask): Promise<void> {
    try {
      const msgRes = await this.client.session.messages({
        path: { id: task.childSessionID },
        throwOnError: true,
      })
      const messages = (msgRes.data ?? []) as unknown[]
      const lastAssistant = findLastAssistantMessage(messages)
      const text = extractTextFromParts(lastAssistant?.parts ?? [])
      const info = lastAssistant?.info ?? {}
      const providerID = info.providerID as string | undefined
      const modelID = info.modelID as string | undefined

      task.status = "completed"
      task.result = text
      task.model = providerID && modelID ? `${providerID}/${modelID}` : undefined
      task.durationMs = Date.now() - task.startedAt
    } catch {
      task.status = "error"
      task.durationMs = Date.now() - task.startedAt
      task.error = "failed to fetch task result"
    }

    // Push-notify the parent session. If this succeeds, mark as consumed so the
    // hook-based fallback in tool.execute.after doesn't double-notify.
    await this.pushNotify(task)
  }

  /**
   * Try to push a notification to the parent session via promptAsync({ noReply: true }).
   * On success, marks the task as consumed. On failure, silently falls through —
   * the tool.execute.after hook will pick it up on the parent's next tool call.
   */
  private async pushNotify(task: BackgroundTask): Promise<void> {
    if (!this.notifyFormatter) return

    const notification = this.notifyFormatter(task)
    // Optimistically mark consumed BEFORE the await to prevent the hook in
    // tool.execute.after from racing and double-notifying.
    this.consumed.add(task.childSessionID)
    try {
      await this.client.session.promptAsync({
        path: { id: task.parentSessionID },
        body: {
          // noReply: false → the parent agent wakes up, reads the notification,
          // and automatically calls task({ task_id }) to retrieve the full result.
          noReply: false,
          parts: [{ type: "text", text: notification }],
        },
        throwOnError: true,
      })
    } catch {
      // Push failed — roll back consumed mark so hook fallback can pick it up.
      this.consumed.delete(task.childSessionID)
    }
  }
}
