import { describe, expect, it } from "bun:test"
import { parseFile, reconstructFile } from "./file-meta"

describe("parseFile", () => {
  describe("#given a plain LF file with trailing newline", () => {
    it("#when parsed #then meta is LF + trailing, lines have no trailing chars", () => {
      // when
      const result = parseFile("a\nb\nc\n")
      // then
      expect(result.lines).toEqual(["a", "b", "c"])
      expect(result.meta.hasBOM).toBe(false)
      expect(result.meta.newline).toBe("\n")
      expect(result.meta.trailingNewline).toBe(true)
    })
  })

  describe("#given a file with no trailing newline", () => {
    it("#when parsed #then trailingNewline is false", () => {
      // when
      const result = parseFile("a\nb\nc")
      // then
      expect(result.lines).toEqual(["a", "b", "c"])
      expect(result.meta.trailingNewline).toBe(false)
    })
  })

  describe("#given a CRLF file", () => {
    it("#when parsed #then newline is detected as CRLF", () => {
      // when
      const result = parseFile("a\r\nb\r\nc\r\n")
      // then
      expect(result.lines).toEqual(["a", "b", "c"])
      expect(result.meta.newline).toBe("\r\n")
      expect(result.meta.trailingNewline).toBe(true)
    })
  })

  describe("#given a file with a UTF-8 BOM", () => {
    it("#when parsed #then BOM is detected and stripped from line content", () => {
      // when
      const result = parseFile(`\uFEFFhello\nworld\n`)
      // then
      expect(result.meta.hasBOM).toBe(true)
      expect(result.lines).toEqual(["hello", "world"])
    })
  })

  describe("#given an empty file", () => {
    it("#when parsed #then no lines, no BOM, default LF, no trailing", () => {
      // when
      const result = parseFile("")
      // then
      expect(result.lines).toEqual([])
      expect(result.meta.hasBOM).toBe(false)
      expect(result.meta.newline).toBe("\n")
      expect(result.meta.trailingNewline).toBe(false)
    })
  })

  describe("#given a single-line file with no terminator", () => {
    it("#when parsed #then one line, no trailing newline", () => {
      // when
      const result = parseFile("hello")
      // then
      expect(result.lines).toEqual(["hello"])
      expect(result.meta.trailingNewline).toBe(false)
    })
  })
})

describe("reconstructFile", () => {
  describe("#given parse → reconstruct on the same input", () => {
    it("#when round-tripped #then output equals input for LF+trailing", () => {
      const input = "a\nb\nc\n"
      expect(reconstructFile(parseFile(input).lines, parseFile(input).meta)).toBe(input)
    })

    it("#when round-tripped #then output equals input for LF without trailing", () => {
      const input = "a\nb\nc"
      expect(reconstructFile(parseFile(input).lines, parseFile(input).meta)).toBe(input)
    })

    it("#when round-tripped #then output equals input for CRLF", () => {
      const input = "a\r\nb\r\nc\r\n"
      expect(reconstructFile(parseFile(input).lines, parseFile(input).meta)).toBe(input)
    })

    it("#when round-tripped #then output equals input for BOM + LF", () => {
      const input = "\uFEFFa\nb\nc\n"
      expect(reconstructFile(parseFile(input).lines, parseFile(input).meta)).toBe(input)
    })

    it("#when round-tripped #then empty file stays empty", () => {
      expect(reconstructFile(parseFile("").lines, parseFile("").meta)).toBe("")
    })

    it("#when round-tripped #then single line without newline stays unchanged", () => {
      const input = "hello"
      expect(reconstructFile(parseFile(input).lines, parseFile(input).meta)).toBe(input)
    })
  })

  describe("#given a file lines array shrunk to empty", () => {
    it("#when reconstructed #then no terminator is added (don't synthesize a phantom newline)", () => {
      // given
      const meta = { hasBOM: false, newline: "\n" as const, trailingNewline: true }
      // when
      const result = reconstructFile([], meta)
      // then
      expect(result).toBe("")
    })
  })
})
