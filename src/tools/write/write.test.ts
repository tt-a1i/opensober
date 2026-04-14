import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ResolvedAgent } from "../../config/extends"
import type { ResolvedConfig } from "../../config/types"
import { ToolPermissionError } from "../common/guards"
import { createWriteTool } from "./write"

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "opensober-write-"))
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

describe("createWriteTool — happy path", () => {
  describe("#given a writable agent and a new file path", () => {
    it("#when write runs #then file is created and output is a structured summary", async () => {
      const write = createWriteTool(makeConfig({ orchestrator: { readonly: false } }))
      const out = await write.execute(
        { file: "hello.txt", content: "hello world\n" },
        fakeCtx("orchestrator", testDir),
      )
      const file = join(testDir, "hello.txt")
      expect(readFileSync(file, "utf8")).toBe("hello world\n")
      expect(out).toContain(`created: ${file}`)
      expect(out).toContain("lines:  2")
      expect(out).toContain("mode:   create")
    })
  })
})

describe("createWriteTool — permission guard", () => {
  describe("#given a readonly agent", () => {
    it("#when write runs #then ToolPermissionError before any I/O", async () => {
      const write = createWriteTool(makeConfig({ explore: { readonly: true } }))
      await expect(
        write.execute({ file: "nope.txt", content: "data" }, fakeCtx("explore", testDir)),
      ).rejects.toThrow(ToolPermissionError)
      expect(existsSync(join(testDir, "nope.txt"))).toBe(false)
    })
  })

  describe("#given an unknown agent not in config", () => {
    it("#when write runs #then ToolPermissionError with 'not found' message", async () => {
      const write = createWriteTool(makeConfig({ orchestrator: {} }))
      await expect(
        write.execute({ file: "nope.txt", content: "data" }, fakeCtx("unknown-agent", testDir)),
      ).rejects.toThrow(/not found in config/)
    })
  })
})

describe("createWriteTool — file exists without overwrite", () => {
  describe("#given an existing file and overwrite not set", () => {
    it("#when write runs #then throws 'already exists' and file is unchanged", async () => {
      const file = join(testDir, "existing.txt")
      writeFileSync(file, "original\n")
      const write = createWriteTool(makeConfig({ orchestrator: {} }))
      await expect(
        write.execute(
          { file: "existing.txt", content: "replaced" },
          fakeCtx("orchestrator", testDir),
        ),
      ).rejects.toThrow(/already exists/)
      expect(readFileSync(file, "utf8")).toBe("original\n")
    })
  })
})

describe("createWriteTool — file exists with overwrite=true", () => {
  describe("#given an existing file and overwrite=true", () => {
    it("#when write runs #then file is replaced and output shows mode: overwrite", async () => {
      const file = join(testDir, "replace-me.txt")
      writeFileSync(file, "old content\n")
      const write = createWriteTool(makeConfig({ orchestrator: {} }))
      const out = await write.execute(
        { file: "replace-me.txt", content: "new content\n", overwrite: true },
        fakeCtx("orchestrator", testDir),
      )
      expect(readFileSync(file, "utf8")).toBe("new content\n")
      expect(out).toContain("overwritten:")
      expect(out).toContain("mode:   overwrite")
    })
  })
})

describe("createWriteTool — parent directory auto-creation", () => {
  describe("#given a path with non-existent parent directories", () => {
    it("#when write runs #then directories are created and file is written", async () => {
      const write = createWriteTool(makeConfig({ orchestrator: {} }))
      const out = await write.execute(
        { file: "subdir/nested/file.txt", content: "deep\n" },
        fakeCtx("orchestrator", testDir),
      )
      const file = join(testDir, "subdir/nested/file.txt")
      expect(readFileSync(file, "utf8")).toBe("deep\n")
      expect(out).toContain(`created: ${file}`)
    })
  })
})

describe("createWriteTool — empty content", () => {
  describe("#given empty string as content", () => {
    it("#when write runs #then file is created empty with lines: 0", async () => {
      const write = createWriteTool(makeConfig({ orchestrator: {} }))
      const out = await write.execute(
        { file: "empty.txt", content: "" },
        fakeCtx("orchestrator", testDir),
      )
      const file = join(testDir, "empty.txt")
      expect(readFileSync(file, "utf8")).toBe("")
      expect(out).toContain("lines:  0")
    })
  })
})

describe("createWriteTool — multi-line content", () => {
  describe("#given content with multiple lines", () => {
    it("#when write runs #then correct line count is reported", async () => {
      const content = "line1\nline2\nline3\nline4\nline5\n"
      const write = createWriteTool(makeConfig({ orchestrator: {} }))
      const out = await write.execute(
        { file: "multi.txt", content },
        fakeCtx("orchestrator", testDir),
      )
      const file = join(testDir, "multi.txt")
      expect(readFileSync(file, "utf8")).toBe(content)
      expect(out).toContain("lines:  6")
    })
  })
})
