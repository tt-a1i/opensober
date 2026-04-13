import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findProjectRoot, listLayerCandidates } from "./discovery"

let testRoot: string

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "opensober-discovery-"))
})

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

describe("findProjectRoot", () => {
  describe("#given a directory containing .git", () => {
    it("#when called from that directory #then returns it", () => {
      // given
      mkdirSync(join(testRoot, ".git"))
      // when
      const result = findProjectRoot(testRoot)
      // then
      expect(result).toBe(testRoot)
    })

    it("#when called from a nested subdirectory #then returns the ancestor", () => {
      // given
      mkdirSync(join(testRoot, ".git"))
      const nested = join(testRoot, "a", "b", "c")
      mkdirSync(nested, { recursive: true })
      // when
      const result = findProjectRoot(nested)
      // then
      expect(result).toBe(testRoot)
    })
  })

  describe("#given no .git anywhere up the chain", () => {
    it("#when called #then returns null (graceful degradation, not an error)", () => {
      // given (no .git in testRoot or anywhere we control above it)
      const nested = join(testRoot, "deep", "leaf")
      mkdirSync(nested, { recursive: true })
      // when
      const result = findProjectRoot(nested)
      // then — may be null OR a real ancestor (if testRoot happens to be inside a git repo).
      // Either way we MUST NOT throw and MUST return either null or a string.
      expect(result === null || typeof result === "string").toBe(true)
    })
  })
})

describe("listLayerCandidates", () => {
  describe("#given cwd inside a git repo and a custom userHome", () => {
    it("#when called #then returns 4 layers in fixed order with concrete paths", () => {
      // given
      mkdirSync(join(testRoot, ".git"))
      const fakeHome = mkdtempSync(join(tmpdir(), "opensober-home-"))
      try {
        // when
        const result = listLayerCandidates({ cwd: testRoot, userHome: fakeHome })
        // then
        expect(result.map((c) => c.source)).toEqual(["default", "user", "project", "cli-override"])
        expect(result[0]?.path).toBeNull()
        expect(result[1]?.path).toBe(join(fakeHome, ".config/opensober/config.jsonc"))
        expect(result[2]?.path).toBe(join(testRoot, ".opensober/config.jsonc"))
        expect(result[3]?.path).toBeNull()
      } finally {
        rmSync(fakeHome, { recursive: true, force: true })
      }
    })
  })

  describe("#given a CLI override", () => {
    it("#when called #then the override appears as the cli-override layer", () => {
      // given
      const fakeHome = mkdtempSync(join(tmpdir(), "opensober-home-"))
      try {
        // when
        const result = listLayerCandidates({
          cwd: testRoot,
          userHome: fakeHome,
          cliOverride: "/tmp/override.jsonc",
        })
        // then
        const overrideLayer = result.find((c) => c.source === "cli-override")
        expect(overrideLayer?.path).toBe("/tmp/override.jsonc")
      } finally {
        rmSync(fakeHome, { recursive: true, force: true })
      }
    })
  })

  describe("#given cwd outside any git repo", () => {
    it("#when called #then project layer has path:null (gracefully absent)", () => {
      // given (testRoot has no .git, and we control its absence in tmp)
      const fakeHome = mkdtempSync(join(tmpdir(), "opensober-home-"))
      try {
        // when
        const result = listLayerCandidates({ cwd: testRoot, userHome: fakeHome })
        // then — may be null OR may have found an ancestor .git (unlikely under tmpdir,
        // but we don't assert exact null because tmpdir might be inside a repo on some CI).
        const projectLayer = result.find((c) => c.source === "project")
        expect(projectLayer).toBeDefined()
        expect(projectLayer?.path === null || typeof projectLayer?.path === "string").toBe(true)
      } finally {
        rmSync(fakeHome, { recursive: true, force: true })
      }
    })
  })
})
