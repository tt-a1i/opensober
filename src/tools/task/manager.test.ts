// opensober — background task manager tests.

import { afterEach, describe, expect, it } from "bun:test"
import type { OpencodeClient } from "@opencode-ai/sdk"
import { BackgroundTaskManager } from "./manager"

// ─────────────────────────────────────────────────────────────────────────────
// Mock factory
// ─────────────────────────────────────────────────────────────────────────────

function mockClient(
  statusMap: Record<string, { type: string }> = {},
  messages: unknown[] = [],
): OpencodeClient {
  return {
    session: {
      status: async () => ({ data: statusMap }),
      messages: async () => ({ data: messages }),
      abort: async () => {},
    },
  } as unknown as OpencodeClient
}

/** Get a task or throw — avoids non-null assertions that biome rejects. */
function mustGetTask(mgr: BackgroundTaskManager, id: string) {
  const t = mgr.getTask(id)
  if (!t) throw new Error(`test setup: task ${id} not found`)
  return t
}

// Keep a reference to each manager so afterEach can dispose (stop timers).
let manager: BackgroundTaskManager | null = null

afterEach(async () => {
  if (manager) {
    await manager.dispose()
    manager = null
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("BackgroundTaskManager — launch", () => {
  describe("#given an empty manager", () => {
    it("#when launch is called #then stores the task and returns childSessionID", () => {
      // given
      manager = new BackgroundTaskManager(mockClient(), { pollIntervalMs: 100_000 })
      // when
      const id = manager.launch("child-1", "parent-1", "explore")
      // then
      expect(id).toBe("child-1")
      const task = manager.getTask("child-1")
      expect(task).toBeDefined()
      expect(task?.childSessionID).toBe("child-1")
      expect(task?.parentSessionID).toBe("parent-1")
      expect(task?.targetAgent).toBe("explore")
      expect(task?.status).toBe("running")
      expect(task?.startedAt).toBeGreaterThan(0)
    })
  })

  describe("#given 5 running tasks already", () => {
    it("#when launch is called #then throws max concurrent error", () => {
      // given
      manager = new BackgroundTaskManager(mockClient(), { pollIntervalMs: 100_000 })
      for (let i = 0; i < 5; i++) {
        manager.launch(`child-${i}`, "parent-1", "agent")
      }
      // when / then
      expect(() => manager?.launch("child-5", "parent-1", "agent")).toThrow(/maximum concurrent/)
    })
  })
})

describe("BackgroundTaskManager — getTask", () => {
  describe("#given a launched task", () => {
    it("#when getTask is called with the correct ID #then returns the task", () => {
      // given
      manager = new BackgroundTaskManager(mockClient(), { pollIntervalMs: 100_000 })
      manager.launch("child-1", "parent-1", "explore")
      // when
      const task = manager.getTask("child-1")
      // then
      expect(task).toBeDefined()
      expect(task?.childSessionID).toBe("child-1")
    })
  })

  describe("#given no tasks", () => {
    it("#when getTask is called #then returns undefined", () => {
      // given
      manager = new BackgroundTaskManager(mockClient(), { pollIntervalMs: 100_000 })
      // when
      const task = manager.getTask("nonexistent")
      // then
      expect(task).toBeUndefined()
    })
  })
})

describe("BackgroundTaskManager — consumeCompleted", () => {
  describe("#given a task has been manually marked completed", () => {
    it("#when consumeCompleted is called #then returns it and marks as consumed", () => {
      // given
      const client = mockClient({ "child-1": { type: "idle" } }, [
        {
          info: { role: "assistant", providerID: "anthropic", modelID: "claude-opus-4-6" },
          parts: [{ type: "text", text: "done" }],
        },
      ])
      manager = new BackgroundTaskManager(client, { pollIntervalMs: 100_000 })
      manager.launch("child-1", "parent-1", "explore")

      // Manually mark as completed (simulating what pollOnce would do).
      const task = mustGetTask(manager, "child-1")
      task.status = "completed"
      task.result = "done"

      // when
      const completed = manager.consumeCompleted("parent-1")

      // then
      expect(completed).toHaveLength(1)
      expect(completed[0]?.childSessionID).toBe("child-1")
      expect(completed[0]?.result).toBe("done")

      // Second call returns empty (already consumed).
      const again = manager.consumeCompleted("parent-1")
      expect(again).toHaveLength(0)
    })
  })

  describe("#given completed tasks for different parents", () => {
    it("#when consumeCompleted is called for one parent #then only returns that parent's tasks", () => {
      // given
      manager = new BackgroundTaskManager(mockClient(), { pollIntervalMs: 100_000 })
      manager.launch("child-1", "parent-1", "a")
      manager.launch("child-2", "parent-2", "b")

      const t1 = mustGetTask(manager, "child-1")
      t1.status = "completed"
      t1.result = "r1"

      const t2 = mustGetTask(manager, "child-2")
      t2.status = "completed"
      t2.result = "r2"

      // when
      const p1 = manager.consumeCompleted("parent-1")
      const p2 = manager.consumeCompleted("parent-2")

      // then
      expect(p1).toHaveLength(1)
      expect(p1[0]?.childSessionID).toBe("child-1")
      expect(p2).toHaveLength(1)
      expect(p2[0]?.childSessionID).toBe("child-2")
    })
  })

  describe("#given a running task", () => {
    it("#when consumeCompleted is called #then does not return it", () => {
      // given
      manager = new BackgroundTaskManager(mockClient(), { pollIntervalMs: 100_000 })
      manager.launch("child-1", "parent-1", "a")
      // task stays "running"

      // when
      const completed = manager.consumeCompleted("parent-1")

      // then
      expect(completed).toHaveLength(0)
    })
  })
})

describe("BackgroundTaskManager — cancel", () => {
  describe("#given a running task", () => {
    it("#when cancel is called #then marks as cancelled and returns true", async () => {
      // given
      let abortCalled = false
      const client = {
        session: {
          status: async () => ({ data: {} }),
          messages: async () => ({ data: [] }),
          abort: async () => {
            abortCalled = true
          },
        },
      } as unknown as OpencodeClient

      manager = new BackgroundTaskManager(client, { pollIntervalMs: 100_000 })
      manager.launch("child-1", "parent-1", "explore")

      // when
      const result = await manager.cancel("child-1")

      // then
      expect(result).toBe(true)
      expect(abortCalled).toBe(true)
      expect(manager.getTask("child-1")?.status).toBe("cancelled")
      expect(manager.getTask("child-1")?.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe("#given a nonexistent task", () => {
    it("#when cancel is called #then returns false", async () => {
      // given
      manager = new BackgroundTaskManager(mockClient(), { pollIntervalMs: 100_000 })
      // when
      const result = await manager.cancel("nonexistent")
      // then
      expect(result).toBe(false)
    })
  })

  describe("#given an already-completed task", () => {
    it("#when cancel is called #then returns false", async () => {
      // given
      manager = new BackgroundTaskManager(mockClient(), { pollIntervalMs: 100_000 })
      manager.launch("child-1", "parent-1", "a")
      mustGetTask(manager, "child-1").status = "completed"
      // when
      const result = await manager.cancel("child-1")
      // then
      expect(result).toBe(false)
    })
  })
})

describe("BackgroundTaskManager — dispose", () => {
  describe("#given running tasks", () => {
    it("#when dispose is called #then cancels all running tasks", async () => {
      // given
      const abortedSessions: string[] = []
      const client = {
        session: {
          status: async () => ({ data: {} }),
          messages: async () => ({ data: [] }),
          abort: async (opts: { path: { id: string } }) => {
            abortedSessions.push(opts.path.id)
          },
        },
      } as unknown as OpencodeClient

      manager = new BackgroundTaskManager(client, { pollIntervalMs: 100_000 })
      manager.launch("child-1", "parent-1", "a")
      manager.launch("child-2", "parent-1", "b")

      // when
      await manager.dispose()
      manager = null // prevent afterEach from double-disposing

      // then
      expect(abortedSessions).toContain("child-1")
      expect(abortedSessions).toContain("child-2")
    })
  })
})

describe("BackgroundTaskManager — consumeCompleted returns non-running statuses", () => {
  describe("#given tasks with error, timeout, and cancelled statuses", () => {
    it("#when consumeCompleted is called #then returns all non-running tasks", () => {
      // given
      manager = new BackgroundTaskManager(mockClient(), { pollIntervalMs: 100_000 })
      manager.launch("child-err", "parent-1", "a")
      manager.launch("child-timeout", "parent-1", "b")
      manager.launch("child-cancel", "parent-1", "c")

      mustGetTask(manager, "child-err").status = "error"
      mustGetTask(manager, "child-err").error = "something broke"
      mustGetTask(manager, "child-timeout").status = "timeout"
      mustGetTask(manager, "child-cancel").status = "cancelled"

      // when
      const completed = manager.consumeCompleted("parent-1")

      // then
      expect(completed).toHaveLength(3)
      const statuses = completed.map((t) => t.status).sort()
      expect(statuses).toEqual(["cancelled", "error", "timeout"])
    })
  })
})
