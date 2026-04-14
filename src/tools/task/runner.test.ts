import { describe, expect, it } from "bun:test"
import type { OpencodeClient } from "@opencode-ai/sdk"
import {
  runChildSession,
  TaskAbortedError,
  TaskExecutionError,
  TaskMaxTurnsError,
  TaskTimeoutError,
} from "./runner"

// ─────────────────────────────────────────────────────────────────────────────
// Mock factory
// ─────────────────────────────────────────────────────────────────────────────

interface MockScenario {
  /** Status types returned in sequence; last value repeats if polls exceed list. */
  statusSequence?: string[]
  /** Messages returned by session.messages (used both mid-poll and for final result). */
  messages?: unknown[]
  /**
   * If set, messages returned mid-poll (during busy) differ from final messages.
   * Each entry is the messages array for that poll tick (for testing turn counting).
   * Falls back to `messages` if not provided.
   */
  pollingMessages?: unknown[][]
  /** If set, session.create throws this. */
  createError?: Error
  /** If set, session.promptAsync throws this. */
  promptAsyncError?: Error
}

function mockClient(scenario: MockScenario = {}): OpencodeClient {
  const statuses = scenario.statusSequence ?? ["idle"]
  let statusIdx = 0
  let messagesCallIdx = 0

  // biome-ignore lint/suspicious/noExplicitAny: test mock — we only implement the methods runner.ts calls
  const session: any = {
    create: async () => {
      if (scenario.createError) throw scenario.createError
      return { data: { id: "child-mock" } }
    },
    promptAsync: async () => {
      if (scenario.promptAsyncError) throw scenario.promptAsyncError
      return { data: undefined }
    },
    status: async () => {
      const type = statuses[Math.min(statusIdx, statuses.length - 1)] ?? "idle"
      statusIdx++
      return { data: { "child-mock": { type } } }
    },
    messages: async () => {
      // During polling, runner calls messages to count assistant turns.
      // After the loop, runner calls messages one more time for the final result.
      if (scenario.pollingMessages) {
        const msgs =
          scenario.pollingMessages[Math.min(messagesCallIdx, scenario.pollingMessages.length - 1)]
        messagesCallIdx++
        return { data: msgs ?? [] }
      }
      return { data: scenario.messages ?? [] }
    },
    abort: async () => ({ data: undefined }),
  }
  return { session } as unknown as OpencodeClient
}

function baseOpts(overrides: Partial<Parameters<typeof runChildSession>[1]> = {}) {
  return {
    parentSessionID: "parent-1",
    targetAgent: "explore",
    prompt: "find something",
    abort: new AbortController().signal,
    directory: "/tmp",
    pollIntervalMs: 1,
    maxTurns: 10,
    maxPollWaitMs: 5000,
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("runChildSession — happy path", () => {
  describe("#given status goes busy then idle with a text response", () => {
    it("#when run #then returns the assistant text with metadata", async () => {
      // given
      const client = mockClient({
        statusSequence: ["busy", "busy", "idle"],
        messages: [
          {
            info: {
              id: "msg-1",
              role: "assistant",
              modelID: "claude-opus-4-6",
              providerID: "anthropic",
              cost: 0.012,
              tokens: { input: 500, output: 200 },
            },
            parts: [{ type: "text", text: "found it" }],
          },
        ],
      })
      // when
      const result = await runChildSession(client, baseOpts())
      // then
      expect(result.childSessionID).toBe("child-mock")
      expect(result.text).toBe("found it")
      expect(result.model).toBe("anthropic/claude-opus-4-6")
      expect(result.cost).toBe(0.012)
      expect(result.tokens).toEqual({ input: 500, output: 200 })
      // 1 unique assistant message seen across the 2 busy-poll cycles:
      expect(result.turns).toBe(1)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe("#given status is immediately idle", () => {
    it("#when run #then returns with 0 turns", async () => {
      // given — the child finished before our first poll
      const client = mockClient({
        statusSequence: ["idle"],
        messages: [
          { info: { role: "assistant" }, parts: [{ type: "text", text: "done instantly" }] },
        ],
      })
      // when
      const result = await runChildSession(client, baseOpts())
      // then
      expect(result.text).toBe("done instantly")
      expect(result.turns).toBe(0)
    })
  })

  describe("#given no text parts in the response", () => {
    it("#when run #then text is empty string", async () => {
      // given
      const client = mockClient({
        statusSequence: ["idle"],
        messages: [{ info: { role: "assistant" }, parts: [{ type: "reasoning", text: "hmm" }] }],
      })
      // when
      const result = await runChildSession(client, baseOpts())
      // then
      expect(result.text).toBe("")
    })
  })
})

describe("runChildSession — abort", () => {
  describe("#given the abort signal fires during polling", () => {
    it("#when run #then TaskAbortedError is thrown and child is aborted", async () => {
      // given
      const ac = new AbortController()
      const client = mockClient({ statusSequence: ["busy", "busy", "busy", "busy", "busy"] })
      // Fire abort after a tiny delay.
      setTimeout(() => ac.abort(), 20)
      // when / then
      await expect(
        runChildSession(client, baseOpts({ abort: ac.signal, pollIntervalMs: 10 })),
      ).rejects.toThrow(TaskAbortedError)
    })
  })
})

describe("runChildSession — max turns", () => {
  describe("#given the child produces more assistant turns than maxTurns", () => {
    it("#when run #then TaskMaxTurnsError based on real assistant message count", async () => {
      // given — each poll tick adds a new assistant message (different id).
      // maxTurns = 3; we provide 5 ticks each with one more assistant message.
      const pollingMessages = Array.from({ length: 5 }, (_, i) =>
        Array.from({ length: i + 1 }, (_, j) => ({
          info: { role: "assistant", id: `msg-${j}` },
          parts: [{ type: "text", text: `turn ${j}` }],
        })),
      )
      const client = mockClient({
        statusSequence: Array.from({ length: 10 }, () => "busy"),
        pollingMessages,
      })
      // when / then
      await expect(runChildSession(client, baseOpts({ maxTurns: 3 }))).rejects.toThrow(
        TaskMaxTurnsError,
      )
    })
  })
})

describe("runChildSession — status missing (session removed from map)", () => {
  describe("#given session.status returns a map WITHOUT the child session", () => {
    it("#when run #then treats as 'done' and fetches messages", async () => {
      // given — first status has no entry for child-mock (simulates server cleanup)
      const client = mockClient({
        statusSequence: [], // empty → childStatus will always be undefined
        messages: [
          { info: { role: "assistant" }, parts: [{ type: "text", text: "already done" }] },
        ],
      })
      // when
      const result = await runChildSession(client, baseOpts())
      // then
      expect(result.text).toBe("already done")
    })
  })
})

describe("runChildSession — hard timeout", () => {
  describe("#given the child is busy past the deadline", () => {
    it("#when run #then TaskTimeoutError", async () => {
      // given — maxPollWaitMs = 50ms, status always busy, pollInterval = 10ms
      const client = mockClient({
        statusSequence: Array.from({ length: 1000 }, () => "busy"),
      })
      // when / then
      await expect(
        runChildSession(
          client,
          baseOpts({ maxPollWaitMs: 50, pollIntervalMs: 10, maxTurns: 10000 }),
        ),
      ).rejects.toThrow(TaskTimeoutError)
    })
  })
})

describe("runChildSession — execution error on assistant message", () => {
  describe("#given the assistant message has an error field", () => {
    it("#when run #then TaskExecutionError with the error description", async () => {
      // given
      const client = mockClient({
        statusSequence: ["idle"],
        messages: [
          {
            info: {
              role: "assistant",
              error: { name: "ProviderAuthError", data: { message: "invalid API key" } },
            },
            parts: [],
          },
        ],
      })
      // when / then
      await expect(runChildSession(client, baseOpts())).rejects.toThrow(TaskExecutionError)
      await expect(runChildSession(client, baseOpts())).rejects.toThrow(/invalid API key/)
    })
  })
})

describe("runChildSession — upstream failures", () => {
  describe("#given session.create fails", () => {
    it("#when run #then the original error propagates", async () => {
      // given
      const client = mockClient({ createError: new Error("server down") })
      // when / then
      await expect(runChildSession(client, baseOpts())).rejects.toThrow(/server down/)
    })
  })

  describe("#given session.promptAsync fails", () => {
    it("#when run #then the original error propagates", async () => {
      // given
      const client = mockClient({ promptAsyncError: new Error("401 unauthorized") })
      // when / then
      await expect(runChildSession(client, baseOpts())).rejects.toThrow(/401 unauthorized/)
    })
  })
})
