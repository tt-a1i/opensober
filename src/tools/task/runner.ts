// opensober — child-session runner.
//
// Core execution loop for `task` tool: promptAsync → poll(session.status) →
// fetch(session.messages). This is the protocol layer; UX formatting lives in
// task.ts. Follows the pattern proven in oh-my-opencode's sync-task family.
//
// Constants are defaulted but overridable in RunChildOptions so unit tests can
// use tiny values without waiting 5 real minutes.

import type { OpencodeClient } from "@opencode-ai/sdk"

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface RunChildOptions {
  readonly parentSessionID: string
  readonly targetAgent: string
  readonly prompt: string
  readonly abort: AbortSignal
  readonly directory: string
  // Test-friendly overrides (production uses defaults).
  readonly maxTurns?: number
  readonly maxPollWaitMs?: number
  readonly pollIntervalMs?: number
}

export interface RunChildResult {
  readonly childSessionID: string
  readonly text: string
  readonly model?: string | undefined
  readonly cost?: number | undefined
  readonly tokens?: { input: number; output: number } | undefined
  readonly durationMs: number
  readonly turns: number
}

export class TaskAbortedError extends Error {
  constructor(message = "task cancelled by parent") {
    super(message)
    this.name = "TaskAbortedError"
  }
}

export class TaskTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TaskTimeoutError"
  }
}

export class TaskMaxTurnsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TaskMaxTurnsError"
  }
}

export class TaskExecutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TaskExecutionError"
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 800
const DEFAULT_MAX_TURNS = 300
const DEFAULT_MAX_POLL_WAIT_MS = 300_000 // 5 minutes

// Permission override — opencode accepts this on session.create but the SDK
// spec doesn't declare it. Using a local extension type as a controlled exception.
const CHILD_PERMISSION_OVERRIDE = { "question/*": "deny" }

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true })
  })
}

async function abortChild(client: OpencodeClient, childID: string): Promise<void> {
  try {
    await client.session.abort({ path: { id: childID } })
  } catch {
    // Best-effort; child may already be done or unreachable.
  }
}

type AnyRecord = Record<string, unknown>

function extractTextFromParts(parts: unknown[]): string {
  return parts
    .filter((p): p is { type: "text"; text: string } => {
      const r = p as AnyRecord
      return r.type === "text" && typeof r.text === "string"
    })
    .map((p) => p.text)
    .join("\n\n")
}

function findLastAssistantMessage(
  messages: unknown[],
): { info: AnyRecord; parts: unknown[] } | null {
  // Walk backwards — the most recent assistant message is what we want.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as AnyRecord
    const info = msg.info as AnyRecord | undefined
    if (info?.role === "assistant") {
      return { info, parts: (msg.parts as unknown[]) ?? [] }
    }
  }
  return null
}

function formatAssistantError(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error)
  const e = error as AnyRecord
  const name = e.name ?? "UnknownError"
  const data = e.data as AnyRecord | undefined
  const message = data?.message ?? JSON.stringify(data)
  return `${name}: ${message}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function runChildSession(
  client: OpencodeClient,
  opts: RunChildOptions,
): Promise<RunChildResult> {
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS
  const maxPollWaitMs = opts.maxPollWaitMs ?? DEFAULT_MAX_POLL_WAIT_MS
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const t0 = Date.now()

  // ── 1. Create child session ──────────────────────────────────────────────
  // The `permission` field is accepted by opencode's server but not declared in the
  // SDK spec. We cast to the declared body type — the extra field passes through at runtime.
  const createBody = {
    parentID: opts.parentSessionID,
    title: `task: ${opts.targetAgent}`,
    permission: CHILD_PERMISSION_OVERRIDE,
  } as { parentID?: string; title?: string }

  const createRes = await client.session.create({
    body: createBody,
    query: { directory: opts.directory },
    throwOnError: true,
  })
  const childID = (createRes.data as { id: string }).id

  // ── 2. Fire prompt (async — returns immediately) ─────────────────────────
  await client.session.promptAsync({
    path: { id: childID },
    body: {
      agent: opts.targetAgent,
      parts: [{ type: "text", text: opts.prompt }],
    },
    throwOnError: true,
  })

  // ── 3. Poll until idle, abort, timeout, or max-turns ─────────────────────
  // `turns` tracks real assistant messages (by watching info.id), NOT poll ticks.
  // This prevents false-positives on long single-turn tasks where the child is
  // simply busy generating output rather than looping through tool calls.
  let turns = 0
  const seenAssistantIDs = new Set<string>()
  const deadline = t0 + maxPollWaitMs

  while (true) {
    // Sleep OR abort — whichever comes first.
    await Promise.race([sleep(pollIntervalMs), waitForAbort(opts.abort)])

    if (opts.abort.aborted) {
      await abortChild(client, childID)
      throw new TaskAbortedError()
    }

    if (Date.now() > deadline) {
      await abortChild(client, childID)
      throw new TaskTimeoutError(
        `child agent did not finish within ${Math.round(maxPollWaitMs / 1000)}s`,
      )
    }

    const statusRes = await client.session.status({ throwOnError: true })
    const statusMap = statusRes.data as Record<string, { type: string }>
    const childStatus = statusMap[childID]?.type

    // Break on "idle" OR on missing entry — opencode may remove a session from
    // the status map once it finishes. Treating "missing" as "done" is safer than
    // treating it as "busy", which would poll until timeout on an already-finished task.
    if (childStatus === "idle" || childStatus === undefined) break

    // Count real assistant turns (deduplicated by message ID) instead of poll ticks.
    // Periodically fetching messages costs one extra API call per poll cycle, but it
    // gives us the correct circuit-breaker semantics: we trip on agent tool-call loops,
    // not on wall-clock waiting.
    try {
      const msgRes = await client.session.messages({ path: { id: childID }, throwOnError: true })
      const msgs = (msgRes.data ?? []) as Array<{ info?: { id?: string; role?: string } }>
      for (const m of msgs) {
        if (m.info?.role === "assistant" && m.info.id && !seenAssistantIDs.has(m.info.id)) {
          seenAssistantIDs.add(m.info.id)
          turns++
        }
      }
    } catch {
      // Non-fatal: if messages fetch fails mid-poll we still have the status check.
    }

    if (turns >= maxTurns) {
      await abortChild(client, childID)
      throw new TaskMaxTurnsError(
        `child agent exceeded ${maxTurns} assistant turns without finishing`,
      )
    }
  }

  // ── 4. Fetch result ──────────────────────────────────────────────────────
  const messagesRes = await client.session.messages({
    path: { id: childID },
    throwOnError: true,
  })
  const messages = (messagesRes.data ?? []) as unknown[]
  const lastAssistant = findLastAssistantMessage(messages)

  // Check for execution error on the assistant message.
  const assistantError = lastAssistant?.info.error
  if (assistantError) {
    throw new TaskExecutionError(formatAssistantError(assistantError))
  }

  const text = extractTextFromParts(lastAssistant?.parts ?? [])
  const info = lastAssistant?.info ?? {}
  const providerID = info.providerID as string | undefined
  const modelID = info.modelID as string | undefined

  return {
    childSessionID: childID,
    text,
    model: providerID && modelID ? `${providerID}/${modelID}` : undefined,
    cost: typeof info.cost === "number" ? (info.cost as number) : undefined,
    tokens:
      typeof (info.tokens as AnyRecord)?.input === "number"
        ? (info.tokens as { input: number; output: number })
        : undefined,
    durationMs: Date.now() - t0,
    turns,
  }
}
