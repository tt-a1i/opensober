import { describe, expect, it } from "bun:test"
import { annotate } from "./annotate"
import { computeLineHash } from "./hash"

describe("annotate", () => {
  describe("#given a multi-line LF file", () => {
    it("#when annotated #then each row is `N#hash  content` joined by LF", () => {
      // given
      const text = "alpha\nbeta\ngamma\n"
      // when
      const result = annotate(text, "sha1")
      // then
      const expectedRows = [
        `1#${computeLineHash("alpha", "sha1")}  alpha`,
        `2#${computeLineHash("beta", "sha1")}  beta`,
        `3#${computeLineHash("gamma", "sha1")}  gamma`,
      ]
      expect(result.annotated).toBe(expectedRows.join("\n"))
    })
  })

  describe("#given a multi-line file", () => {
    it("#when annotated #then the hashes map matches per-line text", () => {
      // when
      const result = annotate("a\nb\nc\n", "sha1")
      // then
      expect(result.hashes.get(1)).toBe(computeLineHash("a", "sha1"))
      expect(result.hashes.get(2)).toBe(computeLineHash("b", "sha1"))
      expect(result.hashes.get(3)).toBe(computeLineHash("c", "sha1"))
      expect(result.hashes.size).toBe(3)
    })
  })

  describe("#given an empty file", () => {
    it("#when annotated #then no rows and an empty hashes map", () => {
      // when
      const result = annotate("", "sha1")
      // then
      expect(result.annotated).toBe("")
      expect(result.hashes.size).toBe(0)
    })
  })

  describe("#given a single line with no terminator", () => {
    it("#when annotated #then one row, no trailing LF added", () => {
      // when
      const result = annotate("only", "sha1")
      // then
      expect(result.annotated).toBe(`1#${computeLineHash("only", "sha1")}  only`)
    })
  })

  describe("#given a CRLF file", () => {
    it("#when annotated #then the annotated output uses LF only (display normalization)", () => {
      // when
      const result = annotate("a\r\nb\r\n", "sha1")
      // then
      expect(result.annotated).not.toContain("\r")
      expect(result.annotated.split("\n")).toHaveLength(2)
    })
  })

  describe("#given a file with a UTF-8 BOM", () => {
    it("#when annotated #then BOM is not part of any line content", () => {
      // when
      const result = annotate("\uFEFFhello\n", "sha1")
      // then
      // First (and only) row should contain `hello`, not `<BOM>hello`.
      expect(result.annotated).toBe(`1#${computeLineHash("hello", "sha1")}  hello`)
    })
  })

  describe("#given an internal blank line", () => {
    it("#when annotated #then the blank line still gets a hash and an empty content column", () => {
      // when
      const result = annotate("a\n\nb\n", "sha1")
      // then
      const lines = result.annotated.split("\n")
      expect(lines[1]).toBe(`2#${computeLineHash("", "sha1")}  `)
    })
  })
})
