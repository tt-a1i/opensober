import { describe, expect, it } from "bun:test"
import { computeLineHash } from "./hash"

describe("computeLineHash", () => {
  describe("#given a known input", () => {
    it("#when sha1 #then returns the first 8 hex chars of the sha1 digest", () => {
      // given (sha1("hello") = aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d)
      const result = computeLineHash("hello", "sha1")
      // then
      expect(result).toBe("aaf4c61d")
      expect(result.length).toBe(8)
    })

    it("#when sha256 #then returns the first 8 hex chars of the sha256 digest", () => {
      // given (sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824)
      const result = computeLineHash("hello", "sha256")
      // then
      expect(result).toBe("2cf24dba")
    })
  })

  describe("#given the same line and different algorithms", () => {
    it("#when hashed #then results differ (algorithms are not interchangeable)", () => {
      // when
      const sha1 = computeLineHash("const x = 1", "sha1")
      const sha256 = computeLineHash("const x = 1", "sha256")
      // then
      expect(sha1).not.toBe(sha256)
    })
  })

  describe("#given an empty line", () => {
    it("#when hashed #then returns the digest of the empty string (deterministic)", () => {
      // when
      const a = computeLineHash("", "sha1")
      const b = computeLineHash("", "sha1")
      // then
      expect(a).toBe(b)
      expect(a.length).toBe(8)
    })
  })

  describe("#given a unicode line", () => {
    it("#when hashed #then returns 8 hex chars without crashing", () => {
      // when
      const result = computeLineHash("中文 — 你好 — 🚀", "sha1")
      // then
      expect(result).toMatch(/^[0-9a-f]{8}$/)
    })
  })

  describe("#given two visually-similar lines that differ by a single space", () => {
    it("#when hashed #then they produce different hashes", () => {
      // when
      const a = computeLineHash("const x = 1", "sha1")
      const b = computeLineHash("const x  = 1", "sha1")
      // then
      expect(a).not.toBe(b)
    })
  })
})
