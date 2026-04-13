import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ResolvedAgent } from "../../config/extends"
import type { ResolvedConfig } from "../../config/types"
import { ToolPermissionError } from "../common/guards"
import { computeLineHash, HashMismatchError } from "../hashline-edit"
import { createEditTool } from "./edit"

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "opensober-edit-"))
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function makeConfig(agents: Record<string, Partial<ResolvedAgent>>): ResolvedConfig {
  const full: Record<string, ResolvedAgent> = {}
  for (const [name, partial] of Object.entries(agents)) {
    full[name] = {
      readonly: false,
      can_delegate: true,
      model: "test/model",
      ...partial,
    }
  }
  return {
    version: 1,
    agents: full,
    tools: {},
    hooks: { disabled: [] },
    mcp: { disabled: [] },
    skills: { disabled: [], paths: [] },
    claude_code: { commands: true, skills: true, agents: true, mcp: true, hooks: true },
    logging: { level: "info" },
    experimental: {},
  }
}

function fakeCtx(agent: string, directory: string) {
  return {
    sessionID: "s",
    messageID: "m",
    agent,
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

const h = (s: string) => computeLineHash(s, "sha1")

describe("createEditTool — happy path", () => {
  describe("#given a writable agent and correct hashes", () => {
    it("#when edit runs #then file is updated and the return value is a structured summary", async () => {
      // given
      const file = join(testDir, "a.txt")
      writeFileSync(file, "alpha\nbeta\ngamma\n")
      const edit = createEditTool(makeConfig({ orchestrator: { readonly: false } }))
      // when
      const out = await edit.execute(
        {
          file: "a.txt",
          edits: [{ lines: [2, 2], expected_hashes: [h("beta")], replacement: "BETA" }],
        },
        fakeCtx("orchestrator", testDir),
      )
      // then
      expect(readFileSync(file, "utf8")).toBe("alpha\nBETA\ngamma\n")
      expect(out).toContain(`edited: ${file}`)
      expect(out).toContain("edits applied:  1")
      expect(out).toContain("line ranges:    [2,2]")
      expect(out).toContain("lines before:   3")
      expect(out).toContain("lines after:    3")
      expect(out).toContain("net change:     0")
      expect(out).toContain("line ending:    LF (preserved)")
      expect(out).toContain("BOM:            none (preserved)")
    })
  })

  describe("#given an edit that adds lines", () => {
    it("#when edit runs #then net change is positive", async () => {
      // given
      const file = join(testDir, "grow.txt")
      writeFileSync(file, "a\nb\nc\n")
      const edit = createEditTool(makeConfig({ orchestrator: { readonly: false } }))
      // when
      const out = await edit.execute(
        {
          file: "grow.txt",
          edits: [{ lines: [2, 2], expected_hashes: [h("b")], replacement: "B1\nB2\nB3" }],
        },
        fakeCtx("orchestrator", testDir),
      )
      // then
      expect(out).toContain("lines before:   3")
      expect(out).toContain("lines after:    5")
      expect(out).toContain("net change:     +2")
    })
  })

  describe("#given a CRLF file", () => {
    it("#when edited #then line-ending report says CRLF (preserved)", async () => {
      // given
      const file = join(testDir, "crlf.txt")
      writeFileSync(file, "a\r\nb\r\nc\r\n")
      const edit = createEditTool(makeConfig({ orchestrator: {} }))
      // when
      const out = await edit.execute(
        {
          file: "crlf.txt",
          edits: [{ lines: [2, 2], expected_hashes: [h("b")], replacement: "B" }],
        },
        fakeCtx("orchestrator", testDir),
      )
      // then
      expect(out).toContain("line ending:    CRLF (preserved)")
    })
  })

  describe("#given a file with UTF-8 BOM", () => {
    it("#when edited #then BOM report says present (preserved)", async () => {
      // given
      const file = join(testDir, "bom.txt")
      writeFileSync(file, "\uFEFFa\nb\n")
      const edit = createEditTool(makeConfig({ orchestrator: {} }))
      // when
      const out = await edit.execute(
        {
          file: "bom.txt",
          edits: [{ lines: [1, 1], expected_hashes: [h("a")], replacement: "A" }],
        },
        fakeCtx("orchestrator", testDir),
      )
      // then
      expect(out).toContain("BOM:            present (preserved)")
    })
  })

  describe("#given multiple non-overlapping edits", () => {
    it("#when edit runs #then ranges list is reported in args order", async () => {
      // given
      const file = join(testDir, "multi.txt")
      writeFileSync(file, "a\nb\nc\nd\n")
      const edit = createEditTool(makeConfig({ orchestrator: { readonly: false } }))
      // when
      const out = await edit.execute(
        {
          file: "multi.txt",
          edits: [
            // Deliberately out of source order — output should reflect caller order.
            { lines: [4, 4], expected_hashes: [h("d")], replacement: "D" },
            { lines: [1, 1], expected_hashes: [h("a")], replacement: "A" },
          ],
        },
        fakeCtx("orchestrator", testDir),
      )
      // then
      expect(readFileSync(file, "utf8")).toBe("A\nb\nc\nD\n")
      expect(out).toContain("edits applied:  2")
      expect(out).toContain("line ranges:    [4,4], [1,1]")
    })
  })
})

describe("createEditTool — permission guard", () => {
  describe("#given a readonly agent", () => {
    it("#when edit runs #then ToolPermissionError before any I/O", async () => {
      // given
      const file = join(testDir, "locked.txt")
      writeFileSync(file, "untouched\n")
      const edit = createEditTool(makeConfig({ explore: { readonly: true } }))
      // when / then
      await expect(
        edit.execute(
          {
            file: "locked.txt",
            edits: [{ lines: [1, 1], expected_hashes: [h("untouched")], replacement: "x" }],
          },
          fakeCtx("explore", testDir),
        ),
      ).rejects.toThrow(ToolPermissionError)
      // File unchanged — the guard threw before we touched the disk.
      expect(readFileSync(file, "utf8")).toBe("untouched\n")
    })
  })
})

describe("createEditTool — algorithm errors propagate with action hints", () => {
  describe("#given a stale hash", () => {
    it("#when edit runs #then HashMismatchError and the file is unchanged", async () => {
      // given
      const file = join(testDir, "stale.txt")
      writeFileSync(file, "content\n")
      const edit = createEditTool(makeConfig({ orchestrator: {} }))
      // when / then
      await expect(
        edit.execute(
          {
            file: "stale.txt",
            edits: [{ lines: [1, 1], expected_hashes: ["00000000"], replacement: "X" }],
          },
          fakeCtx("orchestrator", testDir),
        ),
      ).rejects.toThrow(HashMismatchError)
      expect(readFileSync(file, "utf8")).toBe("content\n")
    })

    it("#when hash mismatches #then the error carries an 'Action: re-read' hint", async () => {
      // given
      const file = join(testDir, "hint.txt")
      writeFileSync(file, "line\n")
      const edit = createEditTool(makeConfig({ orchestrator: {} }))
      // when / then
      await expect(
        edit.execute(
          {
            file: "hint.txt",
            edits: [{ lines: [1, 1], expected_hashes: ["deadbeef"], replacement: "X" }],
          },
          fakeCtx("orchestrator", testDir),
        ),
      ).rejects.toThrow(/Action: re-read the file with the 'read' tool/)
    })
  })

  describe("#given a range past the end of the file", () => {
    it("#when edit runs #then EditRangeError with a 'verify line numbers' action", async () => {
      // given
      const file = join(testDir, "oob.txt")
      writeFileSync(file, "a\nb\n")
      const edit = createEditTool(makeConfig({ orchestrator: {} }))
      // when / then
      await expect(
        edit.execute(
          {
            file: "oob.txt",
            edits: [{ lines: [5, 5], expected_hashes: ["00000000"], replacement: "X" }],
          },
          fakeCtx("orchestrator", testDir),
        ),
      ).rejects.toThrow(/Action: re-read the file and verify your line numbers/)
    })
  })

  describe("#given overlapping edits", () => {
    it("#when edit runs #then EditOverlapError with a 'split your edits' action", async () => {
      // given
      const file = join(testDir, "overlap.txt")
      writeFileSync(file, "a\nb\nc\nd\n")
      const edit = createEditTool(makeConfig({ orchestrator: {} }))
      // when / then
      await expect(
        edit.execute(
          {
            file: "overlap.txt",
            edits: [
              { lines: [2, 3], expected_hashes: [h("b"), h("c")], replacement: "X" },
              { lines: [3, 4], expected_hashes: [h("c"), h("d")], replacement: "Y" },
            ],
          },
          fakeCtx("orchestrator", testDir),
        ),
      ).rejects.toThrow(/Action: split your edits/)
    })
  })
})

describe("createEditTool — missing file", () => {
  describe("#given a path that doesn't exist", () => {
    it("#when edit runs #then throws with a path-aware message (no file is created)", async () => {
      // given
      const edit = createEditTool(makeConfig({ orchestrator: {} }))
      const file = join(testDir, "nope.txt")
      // when / then
      await expect(
        edit.execute(
          {
            file: "nope.txt",
            edits: [{ lines: [1, 1], expected_hashes: [h("whatever")], replacement: "x" }],
          },
          fakeCtx("orchestrator", testDir),
        ),
      ).rejects.toThrow(/does not exist/)
      // Confirm we didn't create it as a side effect.
      expect(() => readFileSync(file, "utf8")).toThrow()
    })
  })
})
