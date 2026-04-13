import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCommand } from "./run"

let projectRoot: string
let fakeHome: string
let outLines: string[]
let errLines: string[]

const out = (line: string): void => {
  outLines.push(line)
}
const err = (line: string): void => {
  errLines.push(line)
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "opensober-run-project-"))
  fakeHome = mkdtempSync(join(tmpdir(), "opensober-run-home-"))
  // Mark project root so findProjectRoot stops here, not at some ancestor repo.
  mkdirSync(join(projectRoot, ".git"))
  outLines = []
  errLines = []
})

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(fakeHome, { recursive: true, force: true })
})

function writeProjectConfig(content: string): string {
  const dir = join(projectRoot, ".opensober")
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "config.jsonc")
  writeFileSync(path, content)
  return path
}

describe("runCommand — happy path", () => {
  describe("#given a valid project config with a model", () => {
    it("#when run #then exits 0 and prints layers and agents to out", () => {
      // given
      writeProjectConfig('{"model": "x/y"}')
      // when
      const code = runCommand({ cwd: projectRoot, userHome: fakeHome, out, err })
      // then
      expect(code).toBe(0)
      expect(errLines).toEqual([])
      const joined = outLines.join("\n")
      expect(joined).toContain("config layers")
      expect(joined).toContain("agents:")
      expect(joined).toContain("orchestrator")
      expect(joined).toContain("explore")
      expect(joined).toContain("reviewer")
      expect(joined).toContain("x/y")
    })
  })

  describe("#given the layers section", () => {
    it("#when run #then default layer is shown first with no path", () => {
      // given
      writeProjectConfig('{"model": "x"}')
      // when
      runCommand({ cwd: projectRoot, userHome: fakeHome, out, err })
      // then
      const text = outLines.join("\n")
      const defaultPos = text.indexOf("default")
      const projectPos = text.indexOf("project")
      expect(defaultPos).toBeGreaterThan(-1)
      expect(projectPos).toBeGreaterThan(defaultPos)
      expect(text).toContain("<built-in defaults>")
    })
  })
})

describe("runCommand — agent ordering", () => {
  describe("#given builtin and user agents mixed", () => {
    it("#when run #then builtins (alphabetical) come first, then user agents (alphabetical)", () => {
      // given
      writeProjectConfig('{"model": "m", "agents": {"zebra": {}, "aardvark": {}}}')
      // when
      const code = runCommand({ cwd: projectRoot, userHome: fakeHome, out, err })
      // then
      expect(code).toBe(0)
      const text = outLines.join("\n")
      const explorePos = text.indexOf("explore ")
      const orchestratorPos = text.indexOf("orchestrator ")
      const reviewerPos = text.indexOf("reviewer ")
      const aardvarkPos = text.indexOf("aardvark ")
      const zebraPos = text.indexOf("zebra ")

      // Built-ins, alphabetical: explore < orchestrator < reviewer
      expect(explorePos).toBeLessThan(orchestratorPos)
      expect(orchestratorPos).toBeLessThan(reviewerPos)
      // User-only, alphabetical: aardvark < zebra
      expect(aardvarkPos).toBeLessThan(zebraPos)
      // All builtins precede every user-only agent
      expect(reviewerPos).toBeLessThan(aardvarkPos)
    })
  })

  describe("#given a readonly + no-delegate agent", () => {
    it("#when run #then row shows both flags", () => {
      // given (explore is built-in readonly + no-delegate)
      writeProjectConfig('{"model": "m"}')
      // when
      runCommand({ cwd: projectRoot, userHome: fakeHome, out, err })
      // then
      const exploreRow = outLines.find((l) => l.includes("explore "))
      expect(exploreRow).toBeDefined()
      expect(exploreRow).toContain("readonly")
      expect(exploreRow).toContain("no-delegate")
    })
  })
})

describe("runCommand — error surfaces", () => {
  describe("#given malformed JSONC", () => {
    it("#when run #then exits 1 and writes 'config load error:' to err", () => {
      // given
      writeProjectConfig('{ "model": "x", invalid }')
      // when
      const code = runCommand({ cwd: projectRoot, userHome: fakeHome, out, err })
      // then
      expect(code).toBe(1)
      expect(outLines).toEqual([])
      expect(errLines.join("\n")).toContain("config load error")
    })
  })

  describe("#given a schema violation", () => {
    it("#when run #then exits 1 and writes 'config schema error:'", () => {
      // given
      writeProjectConfig('{"model": "x", "unknownKey": true}')
      // when
      const code = runCommand({ cwd: projectRoot, userHome: fakeHome, out, err })
      // then
      expect(code).toBe(1)
      const errText = errLines.join("\n")
      expect(errText).toContain("config schema error")
      // Zod's path appears so the user can find the bad key.
      expect(errText).toContain("unknownKey")
    })
  })

  describe("#given a self-extends cycle", () => {
    it("#when run #then exits 1 and writes 'agent extends error:'", () => {
      // given
      writeProjectConfig('{"model": "x", "agents": {"a": {"extends": "a"}}}')
      // when
      const code = runCommand({ cwd: projectRoot, userHome: fakeHome, out, err })
      // then
      expect(code).toBe(1)
      expect(errLines.join("\n")).toContain("agent extends error")
    })
  })

  describe("#given no config and no model anywhere", () => {
    it("#when run #then exits 1 with extends error mentioning 'no model'", () => {
      // when (no project / user / override config files written)
      const code = runCommand({ cwd: projectRoot, userHome: fakeHome, out, err })
      // then
      expect(code).toBe(1)
      expect(errLines.join("\n")).toContain("no model")
    })
  })
})

describe("runCommand — CLI override layer", () => {
  describe("#given a project model and a CLI override model", () => {
    it("#when run #then CLI override wins (highest priority)", () => {
      // given
      writeProjectConfig('{"model": "project/m"}')
      const overridePath = join(projectRoot, "ovr.jsonc")
      writeFileSync(overridePath, '{"model": "cli/m"}')
      // when
      const code = runCommand({
        cwd: projectRoot,
        userHome: fakeHome,
        configOverride: overridePath,
        out,
        err,
      })
      // then
      expect(code).toBe(0)
      const text = outLines.join("\n")
      expect(text).toContain("cli/m")
      expect(text).not.toContain("project/m")
    })
  })
})
