import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearSessionCache, collectAgentsMd, injectContext } from "./context-injection"

let projectRoot: string

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "opensober-ctx-"))
  // Mark as project root.
  mkdirSync(join(projectRoot, ".git"))
})

afterEach(() => {
  clearSessionCache("test-session")
  rmSync(projectRoot, { recursive: true, force: true })
})

describe("collectAgentsMd", () => {
  describe("#given AGENTS.md at the project root only", () => {
    it("#when collected from a subdirectory #then returns the root AGENTS.md", () => {
      // given
      writeFileSync(join(projectRoot, "AGENTS.md"), "# Root context")
      const subDir = join(projectRoot, "src", "components")
      mkdirSync(subDir, { recursive: true })
      // when
      const result = collectAgentsMd(subDir)
      // then
      expect(result).toHaveLength(1)
      expect(result[0]?.content).toBe("# Root context")
    })
  })

  describe("#given AGENTS.md at multiple levels", () => {
    it("#when collected #then returns root-first ordering", () => {
      // given
      writeFileSync(join(projectRoot, "AGENTS.md"), "Root")
      const srcDir = join(projectRoot, "src")
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, "AGENTS.md"), "Src-level")
      // when
      const result = collectAgentsMd(srcDir)
      // then
      expect(result).toHaveLength(2)
      expect(result[0]?.content).toBe("Root")
      expect(result[1]?.content).toBe("Src-level")
    })
  })

  describe("#given no AGENTS.md anywhere", () => {
    it("#when collected #then returns empty array", () => {
      // given
      const subDir = join(projectRoot, "src")
      mkdirSync(subDir, { recursive: true })
      // when
      const result = collectAgentsMd(subDir)
      // then
      expect(result).toHaveLength(0)
    })
  })

  describe("#given an empty AGENTS.md", () => {
    it("#when collected #then skipped (empty content)", () => {
      // given
      writeFileSync(join(projectRoot, "AGENTS.md"), "   ")
      // when
      const result = collectAgentsMd(projectRoot)
      // then
      expect(result).toHaveLength(0)
    })
  })
})

describe("injectContext", () => {
  describe("#given AGENTS.md exists at root", () => {
    it("#when injected after read #then appended as a labeled context block", () => {
      // given
      writeFileSync(join(projectRoot, "AGENTS.md"), "Use TypeScript strict mode.")
      const filePath = join(projectRoot, "src", "foo.ts")
      mkdirSync(join(projectRoot, "src"), { recursive: true })
      // when
      const result = injectContext("file content here", filePath, "test-session")
      // then
      expect(result).toContain("file content here")
      expect(result).toContain("[Context:")
      expect(result).toContain("Use TypeScript strict mode.")
    })
  })

  describe("#given the same directory is read twice in the same session", () => {
    it("#when injected the second time #then context is NOT re-injected (cached)", () => {
      // given
      writeFileSync(join(projectRoot, "AGENTS.md"), "Root context")
      const file1 = join(projectRoot, "src", "a.ts")
      const file2 = join(projectRoot, "src", "b.ts")
      mkdirSync(join(projectRoot, "src"), { recursive: true })
      // when
      const first = injectContext("output-a", file1, "test-session")
      const second = injectContext("output-b", file2, "test-session")
      // then
      expect(first).toContain("[Context:")
      expect(second).not.toContain("[Context:") // cached — not re-injected
    })
  })

  describe("#given a different session ID", () => {
    it("#when injected #then context IS injected again (separate cache)", () => {
      // given
      writeFileSync(join(projectRoot, "AGENTS.md"), "Root context")
      const file = join(projectRoot, "src", "a.ts")
      mkdirSync(join(projectRoot, "src"), { recursive: true })
      // when
      injectContext("out-a", file, "session-1")
      const result = injectContext("out-b", file, "session-2")
      // then
      expect(result).toContain("[Context:")
      clearSessionCache("session-1")
      clearSessionCache("session-2")
    })
  })
})
