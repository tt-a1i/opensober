// opensober — Round 8 spike harness.
//
// Purpose
// -------
// Probes for the 5 assumptions listed in round-7.5-memo.md §8. Runs a local
// opencode server via the SDK's `createOpencode()` helper, then runs a
// sequence of probes and prints an OBSERVED / PASS / FAIL / SKIPPED summary.
//
// Caveat
// ------
// Spike #2 here only probes session-tree-level behaviour (session.abort on
// an idle parent). It does NOT prove whether a parent tool's ctx.abort
// propagates to a child prompt spawned inside that tool — that needs a real
// agent loop + plugin integration test, not this harness. Read its output
// accordingly.
//
// Nothing here touches src/ — this is research tooling. Intent:
//   1. run this script once in a real opencode environment
//   2. paste the output into round-7.5-memo.md as a "Spike results" section
//   3. open the Round 8 design board with the real answers in hand
//   4. plan an integration test for the real ctx.abort question during Round 8
//
// Requirements
// ------------
// * Bun >= 1.3
// * A working opencode provider config (e.g. ANTHROPIC_API_KEY in env or
//   $HOME/.config/opencode/auth.json). Without a provider, prompt-based
//   spikes will report SKIPPED with a clear reason — structural spikes
//   (listing agents, checking SDK shape) still run.
//
// Usage
// -----
//   bun run script/round-8-spike.ts
//
// Exit codes
// ----------
//   0  all spikes ran (PASS / OBSERVED / SKIPPED — no unexpected failures)
//   1  one or more spikes crashed with an unexpected error

import { createOpencode } from "@opencode-ai/sdk"

// ─────────────────────────────────────────────────────────────────────────────
// Result types
// ─────────────────────────────────────────────────────────────────────────────

type Status = "PASS" | "FAIL" | "OBSERVED" | "SKIPPED"

interface SpikeResult {
  readonly id: number
  readonly title: string
  readonly status: Status
  /** Short human-readable notes; one per line in output. */
  readonly details: readonly string[]
  /** Optional follow-up hint for the memo (e.g. "Round 8 must forward abort manually"). */
  readonly conclusion?: string
}

type Client = Awaited<ReturnType<typeof createOpencode>>["client"]

// ─────────────────────────────────────────────────────────────────────────────
// Probe helpers
// ─────────────────────────────────────────────────────────────────────────────

async function safePrompt(
  client: Client,
  sessionID: string,
  text: string,
): Promise<
  { ok: true; info: unknown; parts: unknown[]; elapsedMs: number } | { ok: false; reason: string }
> {
  const t0 = Date.now()
  try {
    const res = await client.session.prompt({
      path: { id: sessionID },
      body: { parts: [{ type: "text", text }] },
      throwOnError: true,
    })
    const data = res.data as { info: unknown; parts: unknown[] }
    return { ok: true, info: data.info, parts: data.parts, elapsedMs: Date.now() - t0 }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

async function createSession(client: Client, title: string, parentID?: string): Promise<string> {
  const res = await client.session.create({
    body: parentID !== undefined ? { title, parentID } : { title },
    throwOnError: true,
  })
  return (res.data as { id: string }).id
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ─────────────────────────────────────────────────────────────────────────────
// Spike 1: does session.prompt block until the agent finishes its full turn?
// ─────────────────────────────────────────────────────────────────────────────

async function spike1(client: Client): Promise<SpikeResult> {
  const title = "session.prompt blocking behavior"
  let sessionID: string
  try {
    sessionID = await createSession(client, "spike-1")
  } catch (e) {
    return {
      id: 1,
      title,
      status: "FAIL",
      details: [`session.create failed: ${(e as Error).message}`],
    }
  }

  const result = await safePrompt(
    client,
    sessionID,
    "Reply with exactly the word OK and nothing else. Do not use any tools.",
  )
  if (!result.ok) {
    return {
      id: 1,
      title,
      status: "SKIPPED",
      details: [
        `prompt failed: ${result.reason}`,
        "Most likely cause: no provider configured. Set ANTHROPIC_API_KEY or similar and re-run.",
      ],
    }
  }

  const info = result.info as {
    finish?: string
    time?: { completed?: number }
    error?: unknown
  }
  const details = [
    `elapsed: ${result.elapsedMs}ms`,
    `info.finish: ${info.finish ?? "(undefined)"}`,
    `info.time.completed: ${info.time?.completed !== undefined ? "set" : "(undefined)"}`,
    `info.error: ${info.error !== undefined ? "present" : "none"}`,
    `text parts: ${result.parts.filter((p) => (p as { type: string }).type === "text").length}`,
  ]

  const blocksToCompletion =
    info.finish !== undefined && info.time?.completed !== undefined && info.error === undefined
  if (blocksToCompletion) {
    return {
      id: 1,
      title,
      status: "PASS",
      details,
      conclusion:
        "prompt() blocks until the agent finishes its turn — synchronous model is viable.",
    }
  }
  return {
    id: 1,
    title,
    status: "OBSERVED",
    details,
    conclusion: "Incomplete — inspect info.finish / info.time.completed manually.",
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Spike 2: session.abort on an IDLE parent — effect on an active child?
//
// IMPORTANT: this probe does NOT prove the real Round 8 question, which is
// "when the PARENT TOOL's ctx.abort fires (because the user cancelled the
// parent agent's turn), does the child session's running prompt stop?".
//
// That scenario requires an active tool call in the parent that's holding a
// child prompt open — which needs a real agent loop + a plugin wired in, not
// a pure client script. We still run the simpler probe below because observed
// session-tree behaviour is useful context; just don't read its result as
// proof of ctx.abort propagation.
// ─────────────────────────────────────────────────────────────────────────────

async function spike2(client: Client): Promise<SpikeResult> {
  const title = "session.abort on idle parent — effect on active child (NOT a ctx.abort test)"
  let parentID: string
  let childID: string
  try {
    parentID = await createSession(client, "spike-2-parent")
    childID = await createSession(client, "spike-2-child", parentID)
  } catch (e) {
    return {
      id: 2,
      title,
      status: "FAIL",
      details: [`session.create failed: ${(e as Error).message}`],
    }
  }

  // Fire a long-running async prompt on the child.
  try {
    await client.session.promptAsync({
      path: { id: childID },
      body: {
        parts: [
          {
            type: "text",
            text: "Count slowly from 1 to 50, one number per line, with a brief pause between numbers.",
          },
        ],
      },
      throwOnError: true,
    })
  } catch (e) {
    return {
      id: 2,
      title,
      status: "SKIPPED",
      details: [
        `promptAsync failed: ${(e as Error).message}`,
        "Most likely cause: no provider configured.",
      ],
    }
  }

  // Give the child a moment to start.
  await sleep(500)

  // Abort the PARENT.
  try {
    await client.session.abort({ path: { id: parentID }, throwOnError: true })
  } catch (e) {
    return {
      id: 2,
      title,
      status: "FAIL",
      details: [`session.abort on parent failed: ${(e as Error).message}`],
    }
  }

  // Wait a bit, then check child status.
  await sleep(1000)
  let childStatusAfter: string
  try {
    const statusRes = await client.session.status({ throwOnError: true })
    const statusMap = statusRes.data as Record<string, { type: string }>
    childStatusAfter = statusMap[childID]?.type ?? "(missing from status map)"
  } catch (e) {
    childStatusAfter = `status query failed: ${(e as Error).message}`
  }

  const details = [
    `parent session: ${parentID} (idle — no active prompt)`,
    `child session:  ${childID} (active — promptAsync in flight)`,
    `child status 1s after session.abort(parent): ${childStatusAfter}`,
    "",
    "LIMITATION: parent had no active prompt when aborted, so this probe",
    "does NOT answer the real question — whether a parent TOOL's ctx.abort",
    "automatically cancels a child prompt spawned from within that tool.",
    "",
    "The real question requires a running agent loop + a plugin that spawns",
    "a child via session.prompt inside a tool execute() — set up during",
    "Round 8 itself with a proper integration test, not this spike harness.",
  ]

  return {
    id: 2,
    title,
    status: "OBSERVED",
    details,
    conclusion:
      "Treat the observed child status ONLY as session-tree behaviour, not as a decision " +
      "about ctx.abort propagation. Default Round 8 assumption: forward ctx.abort to " +
      "client.session.abort(childID) manually until an integration test proves otherwise.",
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Spike 3: do file.edited events in child reach the parent's event stream?
// ─────────────────────────────────────────────────────────────────────────────

async function spike3(_client: Client): Promise<SpikeResult> {
  const title = "file.edited event scope (parent vs child session)"
  return {
    id: 3,
    title,
    status: "SKIPPED",
    details: [
      "This probe needs a real agent session that actually writes a file.",
      "Rerun with an actual prompt-driven edit (e.g. 'edit /tmp/x.txt to say hi')",
      "and subscribe to client.event.subscribe() while it runs.",
      "",
      "Manual procedure:",
      "  1. const events = await client.event.subscribe()",
      "  2. Create parent + child session",
      "  3. In child, prompt an edit via the assistant",
      "  4. Observe whether 'file.edited' events appear with the CHILD's sessionID",
      "  5. Check whether the plugin's event hook also sees them (orthogonal)",
    ],
    conclusion:
      "Deferred — will be answered during Round 8 spike day when a real LLM session is available.",
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Spike 4: does session.prompt's `agent` field resolve an opencode agent name?
// ─────────────────────────────────────────────────────────────────────────────

async function spike4(client: Client): Promise<SpikeResult> {
  const title = "session.prompt body.agent resolution"
  const details: string[] = []

  // Probe 1: what does app.agents return?
  try {
    const res = await client.app.agents({ throwOnError: true })
    const agents = res.data as unknown
    if (Array.isArray(agents)) {
      details.push(`app.agents() returned ${agents.length} entries`)
      details.push(`shape sample: ${JSON.stringify(agents[0] ?? null).slice(0, 200)}`)
    } else {
      details.push(`app.agents() returned non-array: ${JSON.stringify(agents).slice(0, 200)}`)
    }
  } catch (e) {
    details.push(`app.agents() failed: ${(e as Error).message}`)
  }

  // Probe 2: send a prompt with a fabricated agent name and see what opencode says.
  let sessionID: string
  try {
    sessionID = await createSession(client, "spike-4")
  } catch (e) {
    return {
      id: 4,
      title,
      status: "FAIL",
      details: [...details, `session.create failed: ${(e as Error).message}`],
    }
  }

  try {
    const res = await client.session.prompt({
      path: { id: sessionID },
      body: {
        agent: "definitely-not-a-real-agent-ZZZ",
        parts: [{ type: "text", text: "test" }],
      },
    })
    // If it succeeded, opencode silently ignored the agent name or mapped it somewhere.
    details.push(
      `prompt with fake agent name succeeded (status ${JSON.stringify((res as { response?: { status?: number } }).response?.status ?? "unknown")}) — opencode tolerates unknown agents`,
    )
  } catch (e) {
    details.push(`prompt with fake agent name rejected: ${(e as Error).message}`)
  }

  return {
    id: 4,
    title,
    status: "OBSERVED",
    details,
    conclusion:
      "Inspect details above. If app.agents() returned a named list and an unknown agent was rejected, the field is a lookup key; if tolerated, it is a free-form tag.",
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Spike 5: session.prompt parts — are text parts a single concatenated part or many?
// ─────────────────────────────────────────────────────────────────────────────

async function spike5(client: Client): Promise<SpikeResult> {
  const title = "session.prompt response parts structure"
  let sessionID: string
  try {
    sessionID = await createSession(client, "spike-5")
  } catch (e) {
    return {
      id: 5,
      title,
      status: "FAIL",
      details: [`session.create failed: ${(e as Error).message}`],
    }
  }

  const result = await safePrompt(
    client,
    sessionID,
    "Output two separate lines: first line exactly 'ALPHA', second line exactly 'BRAVO'. No other text.",
  )
  if (!result.ok) {
    return {
      id: 5,
      title,
      status: "SKIPPED",
      details: [`prompt failed: ${result.reason}`, "Most likely cause: no provider configured."],
    }
  }

  const textParts = result.parts.filter((p) => (p as { type: string }).type === "text") as Array<{
    text: string
  }>
  const details = [
    `total parts: ${result.parts.length}`,
    `text parts: ${textParts.length}`,
    `text content: ${JSON.stringify(textParts.map((p) => p.text))}`,
    `other part types: ${[
      ...new Set(
        result.parts
          .filter((p) => (p as { type: string }).type !== "text")
          .map((p) => (p as { type: string }).type),
      ),
    ].join(", ")}`,
  ]

  return {
    id: 5,
    title,
    status: "OBSERVED",
    details,
    conclusion:
      textParts.length === 1
        ? "Single text part — the SDK concatenates; Round 8 can treat parts.text[0] as the final answer."
        : "Multiple text parts — Round 8 must concat them (and consider ignoring reasoning-type parts).",
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary rendering
// ─────────────────────────────────────────────────────────────────────────────

function renderSummary(results: readonly SpikeResult[]): void {
  console.log("")
  console.log("===================== Round 8 Spike Results =====================")
  for (const r of results) {
    console.log("")
    console.log(`[SPIKE ${r.id}] ${r.title}`)
    console.log(`  status: ${r.status}`)
    for (const line of r.details) {
      console.log(`  ${line}`)
    }
    if (r.conclusion !== undefined) {
      console.log(`  → ${r.conclusion}`)
    }
  }
  console.log("")
  console.log("=================================================================")
  const counts = results.reduce<Record<Status, number>>(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1
      return acc
    },
    { PASS: 0, FAIL: 0, OBSERVED: 0, SKIPPED: 0 },
  )
  console.log(
    `totals:  PASS=${counts.PASS}  OBSERVED=${counts.OBSERVED}  SKIPPED=${counts.SKIPPED}  FAIL=${counts.FAIL}`,
  )
  console.log("")
  console.log("Paste the block above into round-7.5-memo.md as a new '## Spike results' section.")
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  console.log("starting a local opencode server via createOpencode()...")
  let handle: Awaited<ReturnType<typeof createOpencode>>
  try {
    handle = await createOpencode()
  } catch (e) {
    console.error("createOpencode() failed:", (e as Error).message)
    console.error("Is Bun >= 1.3 installed? Is the opencode binary resolvable?")
    return 1
  }
  console.log(`opencode server up at ${handle.server.url}`)
  const { client } = handle

  const results: SpikeResult[] = []
  const probes = [spike1, spike2, spike3, spike4, spike5] as const
  for (const probe of probes) {
    try {
      results.push(await probe(client))
    } catch (e) {
      results.push({
        id: probes.indexOf(probe) + 1,
        title: probe.name,
        status: "FAIL",
        details: [`unexpected error: ${(e as Error).message}`],
      })
    }
  }

  renderSummary(results)
  handle.server.close()

  return results.some((r) => r.status === "FAIL") ? 1 : 0
}

main().then((code) => {
  process.exit(code)
})
