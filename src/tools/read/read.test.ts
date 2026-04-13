import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ResolvedConfig } from "../../config/types"
import { computeLineHash } from "../hashline-edit"
import { createReadTool } from "./read"

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "opensober-read-"))
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// Minimal ResolvedConfig fixture. Only the fields the tool actually reads matter.
function makeConfig(): ResolvedConfig {
  return {
    version: 1,
    agents: {
      orchestrator: { readonly: false, can_delegate: true, model: "test/model" },
    },
    tools: {},
    hooks: { disabled: [] },
    mcp: { disabled: [] },
    skills: { disabled: [], paths: [] },
    claude_code: { commands: true, skills: true, agents: true, mcp: true, hooks: true },
    logging: { level: "info" },
    experimental: {},
  }
}

// A shared fake ToolContext (we only exercise `directory` and `agent`).
function fakeCtx(agent: string, directory: string) {
  return {
    sessionID: "test-session",
    messageID: "test-message",
    agent,
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

describe("createReadTool", () => {
  describe("#given a text file in the session directory", () => {
    it("#when read #then returns rows in the form 'N#hash  content'", async () => {
      // given
      const file = join(testDir, "a.txt")
      writeFileSync(file, "alpha\nbeta\n")
      const read = createReadTool(makeConfig())
      // when
      const out = await read.execute({ file: "a.txt" }, fakeCtx("orchestrator", testDir))
      // then
      const expected = [
        `1#${computeLineHash("alpha", "sha1")}  alpha`,
        `2#${computeLineHash("beta", "sha1")}  beta`,
      ].join("\n")
      expect(out).toBe(expected)
    })
  })

  describe("#given an absolute path", () => {
    it("#when read #then works regardless of session directory", async () => {
      // given
      const elsewhere = mkdtempSync(join(tmpdir(), "opensober-read-else-"))
      try {
        const file = join(elsewhere, "x.txt")
        writeFileSync(file, "only")
        const read = createReadTool(makeConfig())
        // when
        const out = await read.execute({ file }, fakeCtx("orchestrator", testDir))
        // then
        expect(out).toBe(`1#${computeLineHash("only", "sha1")}  only`)
      } finally {
        rmSync(elsewhere, { recursive: true, force: true })
      }
    })
  })

  describe("#given a readonly agent", () => {
    it("#when read #then still succeeds (read is permission-neutral)", async () => {
      // given
      const file = join(testDir, "r.txt")
      writeFileSync(file, "hello\n")
      const read = createReadTool(makeConfig())
      // when / then — explore is a readonly agent; read should not fail on it.
      const out = await read.execute({ file: "r.txt" }, fakeCtx("explore", testDir))
      expect(out).toBe(`1#${computeLineHash("hello", "sha1")}  hello`)
    })
  })

  describe("#given a missing file", () => {
    it("#when read #then throws with a clear message containing the path", async () => {
      // given
      const read = createReadTool(makeConfig())
      // when / then
      await expect(
        read.execute({ file: "missing.txt" }, fakeCtx("orchestrator", testDir)),
      ).rejects.toThrow(/missing\.txt/)
    })
  })
})
