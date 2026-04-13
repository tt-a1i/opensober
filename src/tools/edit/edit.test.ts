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
    it("#when edit runs #then the file is updated and the return value names what changed", async () => {
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
      expect(out).toContain("applied 1 edit(s)")
    })
  })

  describe("#given multiple non-overlapping edits", () => {
    it("#when edit runs #then all are applied atomically, order-independent", async () => {
      // given
      const file = join(testDir, "multi.txt")
      writeFileSync(file, "a\nb\nc\nd\n")
      const edit = createEditTool(makeConfig({ orchestrator: { readonly: false } }))
      // when
      await edit.execute(
        {
          file: "multi.txt",
          edits: [
            // Deliberately out of source order.
            { lines: [4, 4], expected_hashes: [h("d")], replacement: "D" },
            { lines: [1, 1], expected_hashes: [h("a")], replacement: "A" },
          ],
        },
        fakeCtx("orchestrator", testDir),
      )
      // then
      expect(readFileSync(file, "utf8")).toBe("A\nb\nc\nD\n")
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

describe("createEditTool — algorithm errors propagate", () => {
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

    it("#when hash mismatches #then the error message hints at re-reading", async () => {
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
      ).rejects.toThrow(/re-read/)
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
