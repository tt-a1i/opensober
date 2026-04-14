import { describe, expect, it } from "bun:test"
import { truncateToolOutput } from "./truncation"

describe("truncateToolOutput", () => {
  describe("#given output under the 120K char limit", () => {
    it("#when called #then returns unchanged", () => {
      const text = "hello world\nline two\n"
      expect(truncateToolOutput(text)).toBe(text)
    })
  })

  describe("#given output over the limit", () => {
    it("#when called #then truncates on a line boundary and appends notice", () => {
      // given — build a string just over 120K chars
      const line = `${"x".repeat(99)}\n` // 100 chars per line
      const lineCount = 1300 // 130K chars total, over 120K
      const text = line.repeat(lineCount)
      // when
      const result = truncateToolOutput(text)
      // then
      expect(result.length).toBeLessThan(text.length)
      expect(result).toContain("[... truncated:")
      expect(result).toContain("more characters")
      // Should not end mid-line (last content char before notice is a newline).
      const beforeNotice = result.split("[... truncated:")[0] ?? ""
      expect(beforeNotice.trimEnd().endsWith("\n") || beforeNotice.trimEnd().endsWith("x")).toBe(
        true,
      )
    })
  })

  describe("#given output exactly at the limit", () => {
    it("#when called #then not truncated", () => {
      const text = "a".repeat(120_000)
      expect(truncateToolOutput(text)).toBe(text)
    })
  })
})
