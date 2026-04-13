import { describe, expect, it } from "bun:test"
import { formatBytes, formatKeyValueBlock, truncatePreview } from "./format"

describe("formatBytes", () => {
  describe("#given a size under 1 KiB", () => {
    it("#when formatted #then returns 'N B'", () => {
      expect(formatBytes(0)).toBe("0 B")
      expect(formatBytes(1)).toBe("1 B")
      expect(formatBytes(82)).toBe("82 B")
      expect(formatBytes(1023)).toBe("1023 B")
    })
  })

  describe("#given a size in the KiB range", () => {
    it("#when formatted #then returns 'N KB' rounded to integer", () => {
      expect(formatBytes(1024)).toBe("1 KB")
      expect(formatBytes(1536)).toBe("2 KB") // rounds up
      expect(formatBytes(131072)).toBe("128 KB")
    })
  })

  describe("#given a size in the MiB range", () => {
    it("#when formatted #then returns 'N.N MB'", () => {
      expect(formatBytes(1024 * 1024)).toBe("1.0 MB")
      expect(formatBytes(1_500_000)).toBe("1.4 MB")
    })
  })

  describe("#given a size in the GiB range", () => {
    it("#when formatted #then returns 'N.NN GB'", () => {
      expect(formatBytes(2 * 1024 ** 3)).toBe("2.00 GB")
    })
  })
})

describe("formatKeyValueBlock", () => {
  describe("#given an empty rows array", () => {
    it("#when formatted #then returns ''", () => {
      expect(formatKeyValueBlock([])).toBe("")
    })
  })

  describe("#given rows of uneven key widths", () => {
    it("#when formatted #then values align at the same column", () => {
      // given
      const rows = [
        { key: "a", value: "1" },
        { key: "longer key", value: "2" },
        { key: "mid", value: "3" },
      ]
      // when
      const result = formatKeyValueBlock(rows)
      // then — longest key is "longer key" (10 chars). Each row uses 2-space indent,
      // then key:, then padding to the longest key, then 2 spaces, then the value.
      // So value column is at index 2 + 10 + 1 + 2 = 15 for every row.
      const lines = result.split("\n")
      expect(lines[0]).toMatch(/ {2}a: {11}1$/)
      expect(lines[1]).toMatch(/ {2}longer key: {2}2$/)
      expect(lines[2]).toMatch(/ {2}mid: {9}3$/)
    })
  })

  describe("#given a single row", () => {
    it("#when formatted #then renders with 2-space indent and 2-space value gap", () => {
      expect(formatKeyValueBlock([{ key: "x", value: "y" }])).toBe("  x:  y")
    })
  })
})

describe("truncatePreview", () => {
  describe("#given a short single-line text", () => {
    it("#when called #then returns it unchanged", () => {
      expect(truncatePreview("hello", 80)).toBe("hello")
    })
  })

  describe("#given a text longer than maxLen", () => {
    it("#when called #then truncates and appends ellipsis", () => {
      const result = truncatePreview("abcdefghij", 5)
      expect(result).toBe("abcde…")
    })
  })

  describe("#given a multi-line text", () => {
    it("#when called #then whitespace collapses into single spaces", () => {
      expect(truncatePreview("line one\n  line two\n\n  line three", 80)).toBe(
        "line one line two line three",
      )
    })
  })

  describe("#given trailing whitespace", () => {
    it("#when called #then trimmed", () => {
      expect(truncatePreview("  hello  ", 80)).toBe("hello")
    })
  })
})
