import { describe, expect, it } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"
import { PromptSourceError, parsePromptSource, validatePromptSourceSyntax } from "./prompt-source"

describe("validatePromptSourceSyntax", () => {
  describe("#given a supported form", () => {
    it("#when file:///abs is passed #then no error", () => {
      // when / then
      expect(() => validatePromptSourceSyntax("file:///etc/foo.md")).not.toThrow()
    })

    it("#when file://~/rel is passed #then no error", () => {
      // when / then
      expect(() => validatePromptSourceSyntax("file://~/.config/opensober/p.md")).not.toThrow()
    })

    it("#when bare relative path is passed #then no error", () => {
      // when / then
      expect(() => validatePromptSourceSyntax("./prompts/p.md")).not.toThrow()
      expect(() => validatePromptSourceSyntax("prompts/p.md")).not.toThrow()
    })
  })

  describe("#given an explicitly rejected form", () => {
    it("#when file://relative/... is passed #then PromptSourceError", () => {
      // when / then
      expect(() => validatePromptSourceSyntax("file://relative/p.md")).toThrow(PromptSourceError)
    })

    it("#when bare file:// is passed #then PromptSourceError", () => {
      // when / then
      expect(() => validatePromptSourceSyntax("file://")).toThrow(PromptSourceError)
    })

    it("#when an unrelated URI scheme is passed #then PromptSourceError", () => {
      // when / then
      expect(() => validatePromptSourceSyntax("https://example.com/p.md")).toThrow(
        PromptSourceError,
      )
      expect(() => validatePromptSourceSyntax("ssh://host/x")).toThrow(PromptSourceError)
      expect(() => validatePromptSourceSyntax("http://internal/p")).toThrow(PromptSourceError)
    })

    it("#when a bare absolute path is passed #then PromptSourceError", () => {
      // when / then
      expect(() => validatePromptSourceSyntax("/etc/prompt.md")).toThrow(PromptSourceError)
      expect(() => validatePromptSourceSyntax("/var/lib/p.md")).toThrow(PromptSourceError)
    })
  })

  describe("#given malformed input", () => {
    it("#when empty string #then PromptSourceError", () => {
      // when / then
      expect(() => validatePromptSourceSyntax("")).toThrow(PromptSourceError)
    })

    it("#when string contains NUL byte #then PromptSourceError", () => {
      // when / then
      expect(() => validatePromptSourceSyntax("a\0b")).toThrow(PromptSourceError)
    })
  })
})

describe("parsePromptSource", () => {
  const CONFIG_DIR = "/projects/myapp/.opensober"

  describe("#given file:///abs", () => {
    it("#when parsed #then kind=file-absolute and path is the URL minus scheme", () => {
      // given
      const raw = "file:///etc/opensober/p.md"
      // when
      const result = parsePromptSource(raw, CONFIG_DIR)
      // then
      expect(result.kind).toBe("file-absolute")
      expect(result.path).toBe("/etc/opensober/p.md")
      expect(result.raw).toBe(raw)
    })
  })

  describe("#given file://~/rel", () => {
    it("#when parsed #then kind=file-home and path is resolved against $HOME", () => {
      // given
      const raw = "file://~/.config/opensober/p.md"
      // when
      const result = parsePromptSource(raw, CONFIG_DIR)
      // then
      expect(result.kind).toBe("file-home")
      expect(result.path).toBe(join(homedir(), ".config/opensober/p.md"))
    })
  })

  describe("#given bare relative path", () => {
    it("#when parsed #then kind=relative and path is resolved against configDir", () => {
      // given
      const raw = "./prompts/sec.md"
      // when
      const result = parsePromptSource(raw, CONFIG_DIR)
      // then
      expect(result.kind).toBe("relative")
      expect(result.path).toBe("/projects/myapp/.opensober/prompts/sec.md")
    })

    it("#when parsed without ./ prefix #then still resolves against configDir", () => {
      // given
      const raw = "prompts/sec.md"
      // when
      const result = parsePromptSource(raw, CONFIG_DIR)
      // then
      expect(result.kind).toBe("relative")
      expect(result.path).toBe("/projects/myapp/.opensober/prompts/sec.md")
    })
  })

  describe("#given a rejected form", () => {
    it("#when file://host/path is passed #then PromptSourceError", () => {
      // when / then
      expect(() => parsePromptSource("file://relative/p.md", CONFIG_DIR)).toThrow(PromptSourceError)
    })
  })
})
