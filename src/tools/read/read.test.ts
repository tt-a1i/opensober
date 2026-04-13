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

describe("createReadTool — happy path", () => {
  describe("#given a small text file", () => {
    it("#when read #then header + blank + annotated body", async () => {
      // given
      const file = join(testDir, "a.txt")
      writeFileSync(file, "alpha\nbeta\n")
      const read = createReadTool(makeConfig())
      // when
      const out = await read.execute({ file: "a.txt" }, fakeCtx("orchestrator", testDir))
      // then
      const lines = out.split("\n")
      expect(lines[0]).toMatch(/^file: .*a\.txt \(2 lines, 11 B\)$/)
      expect(lines[1]).toBe("") // blank separator
      expect(lines[2]).toBe(`1#${computeLineHash("alpha", "sha1")}  alpha`)
      expect(lines[3]).toBe(`2#${computeLineHash("beta", "sha1")}  beta`)
    })
  })

  describe("#given a file accessed via absolute path", () => {
    it("#when read #then the header reports that same absolute path", async () => {
      // given
      const elsewhere = mkdtempSync(join(tmpdir(), "opensober-read-else-"))
      try {
        const file = join(elsewhere, "x.txt")
        writeFileSync(file, "only")
        const read = createReadTool(makeConfig())
        // when
        const out = await read.execute({ file }, fakeCtx("orchestrator", testDir))
        // then
        expect(out.split("\n")[0]).toBe(`file: ${file} (1 lines, 4 B)`)
      } finally {
        rmSync(elsewhere, { recursive: true, force: true })
      }
    })
  })
})

describe("createReadTool — large file advisory", () => {
  describe("#given a file under the 2000-line threshold", () => {
    it("#when read #then no advisory is added", async () => {
      // given
      const file = join(testDir, "small.txt")
      const content = `${Array.from({ length: 1999 }, (_, i) => `line ${i + 1}`).join("\n")}\n`
      writeFileSync(file, content)
      const read = createReadTool(makeConfig())
      // when
      const out = await read.execute({ file: "small.txt" }, fakeCtx("orchestrator", testDir))
      // then
      expect(out).not.toContain("Note: this is a large file")
    })
  })

  describe("#given a file at or over the 2000-line threshold", () => {
    it("#when read #then the advisory line appears after the header", async () => {
      // given
      const file = join(testDir, "big.txt")
      const content = `${Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`).join("\n")}\n`
      writeFileSync(file, content)
      const read = createReadTool(makeConfig())
      // when
      const out = await read.execute({ file: "big.txt" }, fakeCtx("orchestrator", testDir))
      // then
      const lines = out.split("\n")
      expect(lines[0]).toMatch(/^file: .*big\.txt \(2000 lines, /)
      expect(lines[1]).toMatch(/^Note: this is a large file/)
      expect(lines[2]).toBe("") // blank before the body
    })
  })
})

describe("createReadTool — permission and errors", () => {
  describe("#given a readonly agent", () => {
    it("#when read #then still succeeds (read is permission-neutral)", async () => {
      // given
      const file = join(testDir, "r.txt")
      writeFileSync(file, "hello\n")
      const read = createReadTool(makeConfig())
      // when
      const out = await read.execute({ file: "r.txt" }, fakeCtx("explore", testDir))
      // then
      expect(out).toContain(`1#${computeLineHash("hello", "sha1")}  hello`)
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
