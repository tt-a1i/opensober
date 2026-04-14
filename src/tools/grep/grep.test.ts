import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ResolvedConfig } from "../../config/types"
import { createGrepTool } from "./grep"

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "opensober-grep-"))
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function makeConfig(): ResolvedConfig {
  return {
    version: 1,
    agents: {},
    tools: { disabled: [] },
    hooks: { disabled: [] },
    mcp: { disabled: [] },
    skills: { disabled: [], paths: [] },
    claude_code: { commands: true, skills: true, agents: true, mcp: true, hooks: true },
    logging: { level: "info" },
    experimental: {},
  }
}

function fakeCtx(directory: string) {
  return {
    sessionID: "s",
    messageID: "m",
    agent: "orchestrator",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

describe("createGrepTool", () => {
  describe("#given a file containing a known string", () => {
    it("#when pattern matches #then returns file:line:content format", async () => {
      // given
      writeFileSync(join(testDir, "a.ts"), "const x = 1\nconst y = 2\nconst z = 3\n")
      const grep = createGrepTool(makeConfig())
      // when
      const out = await grep.execute({ pattern: "const y" }, fakeCtx(testDir))
      // then
      expect(out).toContain("1 match")
      expect(out).toContain("const y = 2")
      expect(out).toContain("a.ts")
    })
  })

  describe("#given multiple matches across files", () => {
    it("#when pattern matches #then all matching lines appear", async () => {
      // given
      writeFileSync(join(testDir, "a.ts"), "hello world\n")
      writeFileSync(join(testDir, "b.ts"), "hello universe\nhello earth\n")
      const grep = createGrepTool(makeConfig())
      // when
      const out = await grep.execute({ pattern: "hello" }, fakeCtx(testDir))
      // then
      expect(out).toContain("3 matches")
    })
  })

  describe("#given no matches", () => {
    it("#when executed #then returns a 'no matches' message", async () => {
      // given
      writeFileSync(join(testDir, "a.ts"), "nothing here\n")
      const grep = createGrepTool(makeConfig())
      // when
      const out = await grep.execute({ pattern: "zzzzzzz" }, fakeCtx(testDir))
      // then
      expect(out).toContain("no matches")
    })
  })

  describe("#given a glob filter", () => {
    it("#when set to *.ts #then only .ts files are searched", async () => {
      // given
      writeFileSync(join(testDir, "a.ts"), "hello ts\n")
      writeFileSync(join(testDir, "b.json"), "hello json\n")
      const grep = createGrepTool(makeConfig())
      // when
      const out = await grep.execute({ pattern: "hello", glob: "*.ts" }, fakeCtx(testDir))
      // then
      expect(out).toContain("1 match")
      expect(out).toContain("a.ts")
      expect(out).not.toContain("b.json")
    })
  })

  describe("#given a path argument scoping to a subdirectory", () => {
    it("#when set #then only searches that directory", async () => {
      // given
      mkdirSync(join(testDir, "sub"), { recursive: true })
      writeFileSync(join(testDir, "root.ts"), "target\n")
      writeFileSync(join(testDir, "sub", "nested.ts"), "target\n")
      const grep = createGrepTool(makeConfig())
      // when
      const out = await grep.execute({ pattern: "target", path: "sub" }, fakeCtx(testDir))
      // then
      expect(out).toContain("1 match")
      expect(out).toContain("nested.ts")
      expect(out).not.toContain("root.ts")
    })
  })
})
