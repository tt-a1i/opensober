import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { doctorCommand } from "./doctor"

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
  projectRoot = mkdtempSync(join(tmpdir(), "opensober-doctor-project-"))
  fakeHome = mkdtempSync(join(tmpdir(), "opensober-doctor-home-"))
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

describe("doctorCommand — clean config", () => {
  describe("#given a valid project config with a model", () => {
    it("#when run #then exits 0 and prints all sections + '(none)' for warnings", () => {
      // given
      writeProjectConfig('{"model": "anthropic/claude-opus-4-6"}')
      // when
      const code = doctorCommand({ cwd: projectRoot, userHome: fakeHome, out, err })
      // then
      expect(code).toBe(0)
      expect(errLines).toEqual([])
      const text = outLines.join("\n")
      expect(text).toContain("opensober doctor")
      expect(text).toContain("config")
      expect(text).toContain("version:       1")
      expect(text).toContain("global model:  anthropic/claude-opus-4-6")
      expect(text).toContain("agents")
      expect(text).toContain("orchestrator")
      expect(text).toContain("explore")
      expect(text).toContain("reviewer")
      expect(text).toContain("tools")
      expect(text).toContain("edit, glob, grep, read, task")
      expect(text).toContain("warnings")
      expect(text).toContain("(none)")
    })
  })

  describe("#given the reviewer line", () => {
    it("#when run #then flags show 'readonly, delegates (readonly-only)'", () => {
      // given
      writeProjectConfig('{"model": "anthropic/claude-opus-4-6"}')
      // when
      doctorCommand({ cwd: projectRoot, userHome: fakeHome, out, err })
      // then
      const reviewerLine = outLines.find((l) => l.includes("reviewer "))
      expect(reviewerLine).toBeDefined()
      expect(reviewerLine).toContain("readonly")
      expect(reviewerLine).toContain("delegates (readonly-only)")
    })

    it("#when run #then the explore line shows 'readonly, no-delegate'", () => {
      // given
      writeProjectConfig('{"model": "anthropic/claude-opus-4-6"}')
      // when
      doctorCommand({ cwd: projectRoot, userHome: fakeHome, out, err })
      // then
      const exploreLine = outLines.find((l) => l.includes("explore "))
      expect(exploreLine).toContain("readonly")
      expect(exploreLine).toContain("no-delegate")
    })

    it("#when run #then the orchestrator line shows 'writable, delegates'", () => {
      // given
      writeProjectConfig('{"model": "anthropic/claude-opus-4-6"}')
      // when
      doctorCommand({ cwd: projectRoot, userHome: fakeHome, out, err })
      // then
      const orchLine = outLines.find((l) => l.includes("orchestrator "))
      expect(orchLine).toContain("writable")
      // "delegates" without the "(readonly-only)" qualifier
      expect(orchLine).toMatch(/delegates(?! \(readonly-only\))/)
    })
  })
})

describe("doctorCommand — warnings", () => {
  describe("#given a user agent referencing an unknown tool in tools.allow", () => {
    it("#when run #then exits 1 and the warning names the agent and the unknown tool", () => {
      // given
      writeProjectConfig(
        JSON.stringify({
          model: "m",
          agents: {
            quick: { tools: { allow: ["read", "frog"] } },
          },
        }),
      )
      // when
      const code = doctorCommand({ cwd: projectRoot, userHome: fakeHome, out, err })
      // then
      expect(code).toBe(1)
      const text = outLines.join("\n")
      expect(text).toContain('agent "quick": tools.allow references unknown tool "frog"')
      // The valid tool "read" should NOT produce a warning.
      expect(text).not.toContain('"read"')
    })
  })

  describe("#given a user agent referencing an unknown tool in tools.deny", () => {
    it("#when run #then exits 1 and the warning names tools.deny", () => {
      // given
      writeProjectConfig(
        JSON.stringify({
          model: "m",
          agents: {
            quick: { tools: { deny: ["bark"] } },
          },
        }),
      )
      // when
      const code = doctorCommand({ cwd: projectRoot, userHome: fakeHome, out, err })
      // then
      expect(code).toBe(1)
      expect(outLines.join("\n")).toContain(
        'agent "quick": tools.deny references unknown tool "bark"',
      )
    })
  })

  describe("#given built-in agents only (no user overrides)", () => {
    it("#when run #then no warnings (built-in tool lists stay aligned with registered tools)", () => {
      // given — this is specifically the "explore's allowlist must match registered tools"
      // invariant; if someone adds a tool to defaults but forgets to register it, this
      // test catches it before users do.
      writeProjectConfig('{"model": "m"}')
      // when
      const code = doctorCommand({ cwd: projectRoot, userHome: fakeHome, out, err })
      // then
      expect(code).toBe(0)
    })
  })
})

describe("doctorCommand — fatal errors (exit 2)", () => {
  describe("#given a malformed JSONC config", () => {
    it("#when run #then exits 2, stderr has the error, stdout has nothing", () => {
      // given
      writeProjectConfig("{ invalid }")
      // when
      const code = doctorCommand({ cwd: projectRoot, userHome: fakeHome, out, err })
      // then
      expect(code).toBe(2)
      expect(outLines).toEqual([])
      expect(errLines.join("\n")).toContain("config failed to load")
      expect(errLines.join("\n")).toContain("config load error")
    })
  })

  describe("#given a schema violation (unknown top-level key)", () => {
    it("#when run #then exits 2", () => {
      // given
      writeProjectConfig('{"model": "m", "unknownKey": true}')
      // when
      const code = doctorCommand({ cwd: projectRoot, userHome: fakeHome, out, err })
      // then
      expect(code).toBe(2)
      expect(errLines.join("\n")).toContain("config schema error")
    })
  })

  describe("#given no model anywhere (extends error)", () => {
    it("#when run #then exits 2", () => {
      // given (no project config, no global model)
      // when
      const code = doctorCommand({ cwd: projectRoot, userHome: fakeHome, out, err })
      // then
      expect(code).toBe(2)
      expect(errLines.join("\n")).toContain("agent extends error")
    })
  })
})

describe("doctorCommand — layer reporting", () => {
  describe("#given only a CLI override", () => {
    it("#when run #then only default + cli-override layers show up", () => {
      // given
      const overridePath = join(projectRoot, "ovr.jsonc")
      writeFileSync(overridePath, '{"model": "m"}')
      // when
      doctorCommand({
        cwd: projectRoot,
        userHome: fakeHome,
        configOverride: overridePath,
        out,
        err,
      })
      // then
      const text = outLines.join("\n")
      expect(text).toContain("default")
      expect(text).toContain("(built-in)")
      expect(text).toContain("cli-override")
      expect(text).toContain(overridePath)
    })
  })
})
