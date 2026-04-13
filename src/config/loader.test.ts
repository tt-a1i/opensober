import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ZodError } from "zod"
import { ExtendsError } from "./extends"
import { ConfigLoadError, loadConfig } from "./loader"

let projectRoot: string
let fakeHome: string

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "opensober-loader-project-"))
  fakeHome = mkdtempSync(join(tmpdir(), "opensober-loader-home-"))
  // Mark the test project root so findProjectRoot stops here instead of climbing
  // into the surrounding test infrastructure (which may itself be a git repo).
  mkdirSync(join(projectRoot, ".git"))
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

function writeUserConfig(content: string): string {
  const dir = join(fakeHome, ".config", "opensober")
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "config.jsonc")
  writeFileSync(path, content)
  return path
}

describe("loadConfig — empty / minimal", () => {
  describe("#given no config files at all and no model anywhere", () => {
    it("#when loaded #then ExtendsError (orchestrator has no model)", () => {
      // when / then
      expect(() => loadConfig({ cwd: projectRoot, userHome: fakeHome })).toThrow(ExtendsError)
      expect(() => loadConfig({ cwd: projectRoot, userHome: fakeHome })).toThrow(/no model/)
    })
  })

  describe("#given only a CLI override providing a model", () => {
    it("#when loaded #then resolves with that model and reports just default + override layers", () => {
      // given
      const overridePath = join(projectRoot, "override.jsonc")
      writeFileSync(overridePath, '{"model": "x/y"}')
      // when
      const result = loadConfig({
        cwd: projectRoot,
        userHome: fakeHome,
        cliOverride: overridePath,
      })
      // then
      expect(result.config.agents.orchestrator?.model).toBe("x/y")
      expect(result.layers.map((l) => l.source)).toEqual(["default", "cli-override"])
    })
  })
})

describe("loadConfig — layer precedence", () => {
  describe("#given user model and project model both set", () => {
    it("#when loaded #then project's model wins", () => {
      // given
      writeUserConfig('{"model": "user/m"}')
      writeProjectConfig('{"model": "project/m"}')
      // when
      const result = loadConfig({ cwd: projectRoot, userHome: fakeHome })
      // then
      expect(result.config.model).toBe("project/m")
      expect(result.config.agents.orchestrator?.model).toBe("project/m")
      expect(result.layers.map((l) => l.source)).toEqual(["default", "user", "project"])
    })
  })

  describe("#given project model and CLI override both set", () => {
    it("#when loaded #then CLI override wins (highest precedence)", () => {
      // given
      writeProjectConfig('{"model": "project/m"}')
      const overridePath = join(projectRoot, "ovr.jsonc")
      writeFileSync(overridePath, '{"model": "cli/m"}')
      // when
      const result = loadConfig({
        cwd: projectRoot,
        userHome: fakeHome,
        cliOverride: overridePath,
      })
      // then
      expect(result.config.model).toBe("cli/m")
    })
  })

  describe("#given hooks.disabled set in both user and project layers", () => {
    it("#when loaded #then project array REPLACES user array (deepMerge rule for arrays)", () => {
      // given
      writeUserConfig('{"model": "x", "hooks": {"disabled": ["a", "b"]}}')
      writeProjectConfig('{"hooks": {"disabled": ["c"]}}')
      // when
      const result = loadConfig({ cwd: projectRoot, userHome: fakeHome })
      // then
      expect(result.config.hooks.disabled).toEqual(["c"])
    })
  })
})

describe("loadConfig — error surfaces", () => {
  describe("#given malformed JSONC in project config", () => {
    it("#when loaded #then ConfigLoadError mentioning the file path", () => {
      // given
      const path = writeProjectConfig('{ "model": "x", invalid }')
      // when / then
      expect(() => loadConfig({ cwd: projectRoot, userHome: fakeHome })).toThrow(ConfigLoadError)
      expect(() => loadConfig({ cwd: projectRoot, userHome: fakeHome })).toThrow(path)
    })
  })

  describe("#given an unknown top-level key", () => {
    it("#when loaded #then ZodError (strict mode rejects)", () => {
      // given
      writeProjectConfig('{"model": "x", "unknownKey": true}')
      // when / then
      expect(() => loadConfig({ cwd: projectRoot, userHome: fakeHome })).toThrow(ZodError)
    })
  })

  describe("#given a user agent that extends a missing parent", () => {
    it("#when loaded #then ExtendsError", () => {
      // given
      writeProjectConfig('{"model": "x", "agents": {"orphan": {"extends": "ghost"}}}')
      // when / then
      expect(() => loadConfig({ cwd: projectRoot, userHome: fakeHome })).toThrow(ExtendsError)
    })
  })
})

describe("loadConfig — provenance for doctor", () => {
  describe("#given user and project configs both contributing", () => {
    it("#when loaded #then layers retain their source paths in order", () => {
      // given
      const userPath = writeUserConfig('{"model": "x"}')
      const projPath = writeProjectConfig('{"hooks": {"disabled": ["foo"]}}')
      // when
      const result = loadConfig({ cwd: projectRoot, userHome: fakeHome })
      // then
      const userLayer = result.layers.find((l) => l.source === "user")
      const projectLayer = result.layers.find((l) => l.source === "project")
      expect(userLayer?.path).toBe(userPath)
      expect(projectLayer?.path).toBe(projPath)
      // The default layer is always present so doctor can show it explicitly.
      expect(result.layers[0]?.source).toBe("default")
      expect(result.layers[0]?.path).toBeNull()
    })
  })
})
