import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ResolvedConfig } from "../../config/types"
import { createGlobTool } from "./glob"

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "opensober-glob-"))
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

describe("createGlobTool", () => {
  describe("#given a directory with .ts and .json files", () => {
    it("#when pattern is *.ts #then returns only .ts files", async () => {
      // given
      writeFileSync(join(testDir, "a.ts"), "")
      writeFileSync(join(testDir, "b.ts"), "")
      writeFileSync(join(testDir, "c.json"), "")
      const glob = createGlobTool(makeConfig())
      // when
      const out = await glob.execute({ pattern: "*.ts" }, fakeCtx(testDir))
      // then
      expect(out).toContain("2 matches")
      expect(out).toContain("a.ts")
      expect(out).toContain("b.ts")
      expect(out).not.toContain("c.json")
    })
  })

  describe("#given a nested directory", () => {
    it("#when pattern uses ** #then matches recursively", async () => {
      // given
      mkdirSync(join(testDir, "src"), { recursive: true })
      writeFileSync(join(testDir, "src", "index.ts"), "")
      writeFileSync(join(testDir, "readme.md"), "")
      const glob = createGlobTool(makeConfig())
      // when
      const out = await glob.execute({ pattern: "**/*.ts" }, fakeCtx(testDir))
      // then
      expect(out).toContain("1 match")
      expect(out).toContain("src/index.ts")
    })
  })

  describe("#given no matches", () => {
    it("#when executed #then returns a 'no files matching' message", async () => {
      // given
      writeFileSync(join(testDir, "a.txt"), "")
      const glob = createGlobTool(makeConfig())
      // when
      const out = await glob.execute({ pattern: "*.xyz" }, fakeCtx(testDir))
      // then
      expect(out).toContain("no files matching")
    })
  })

  describe("#given a path argument", () => {
    it("#when set #then scopes the search to that subdirectory", async () => {
      // given
      mkdirSync(join(testDir, "sub"), { recursive: true })
      writeFileSync(join(testDir, "root.ts"), "")
      writeFileSync(join(testDir, "sub", "nested.ts"), "")
      const glob = createGlobTool(makeConfig())
      // when
      const out = await glob.execute({ pattern: "*.ts", path: "sub" }, fakeCtx(testDir))
      // then
      expect(out).toContain("nested.ts")
      expect(out).not.toContain("root.ts")
    })
  })
})
