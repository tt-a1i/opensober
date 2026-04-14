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

describe("createReadTool — truncation", () => {
  describe("#given a file under all thresholds (< 2000 lines, < 200 KB)", () => {
    it("#when read #then no truncation and no advisory", async () => {
      // given
      const file = join(testDir, "small.txt")
      const content = `${Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n")}\n`
      writeFileSync(file, content)
      const read = createReadTool(makeConfig())
      // when
      const out = await read.execute({ file: "small.txt" }, fakeCtx("orchestrator", testDir))
      // then
      expect(out).not.toContain("truncated")
      expect(out).not.toContain("Tip:")
      expect(out.split("\n").filter((l) => l.match(/^\d+#/)).length).toBe(500)
    })
  })

  describe("#given a file over the 2000-line threshold", () => {
    it("#when read #then output is truncated to 2000 annotated lines + truncation notice", async () => {
      // given
      const file = join(testDir, "big.txt")
      const content = `${Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`).join("\n")}\n`
      writeFileSync(file, content)
      const read = createReadTool(makeConfig())
      // when
      const out = await read.execute({ file: "big.txt" }, fakeCtx("orchestrator", testDir))
      // then
      const lines = out.split("\n")
      expect(lines[0]).toMatch(/^file: .*big\.txt \(3000 lines,/)
      expect(out).toContain("truncated")
      expect(out).toContain("showing first 2000 lines")
      expect(out).toContain("Tip:")
      // Annotated body should have exactly 2000 hash-prefixed lines.
      const annotatedLines = lines.filter((l) => l.match(/^\d+#/))
      expect(annotatedLines.length).toBe(2000)
      // The last annotated line should be line 2000, not 3000.
      expect(annotatedLines[annotatedLines.length - 1]).toMatch(/^2000#/)
    })
  })

  describe("#given a file under 2000 lines but over 200 KB", () => {
    it("#when read #then output is truncated by byte threshold", async () => {
      // given — 100 lines of 3000 bytes each = 300 KB, well over the 200 KB limit.
      const file = join(testDir, "wide.txt")
      const wideLine = "x".repeat(3000)
      const content = `${Array.from({ length: 100 }, () => wideLine).join("\n")}\n`
      writeFileSync(file, content)
      const read = createReadTool(makeConfig())
      // when
      const out = await read.execute({ file: "wide.txt" }, fakeCtx("orchestrator", testDir))
      // then
      expect(out).toContain("truncated")
      // Should show fewer than 100 lines (byte limit kicks in before line limit).
      const annotatedLines = out.split("\n").filter((l) => l.match(/^\d+#/))
      expect(annotatedLines.length).toBeLessThan(100)
      expect(annotatedLines.length).toBeGreaterThan(0)
    })
  })

  describe("#given a file at exactly 2000 lines and under 200 KB", () => {
    it("#when read #then NOT truncated (thresholds are exclusive of the limit)", async () => {
      // given — exactly 2000 short lines, well under 200 KB.
      const file = join(testDir, "exact.txt")
      const content = `${Array.from({ length: 2000 }, (_, i) => `L${i}`).join("\n")}\n`
      writeFileSync(file, content)
      const read = createReadTool(makeConfig())
      // when
      const out = await read.execute({ file: "exact.txt" }, fakeCtx("orchestrator", testDir))
      // then — 2000 lines should NOT be truncated (the loop checks i >= MAX_LINES
      // where i starts at 0, so line indices 0-1999 = 2000 lines are accepted).
      expect(out).not.toContain("truncated")
      const annotatedLines = out.split("\n").filter((l) => l.match(/^\d+#/))
      expect(annotatedLines.length).toBe(2000)
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
