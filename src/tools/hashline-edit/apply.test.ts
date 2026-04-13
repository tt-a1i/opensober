import { describe, expect, it } from "bun:test"
import {
  applyEdits,
  type EditInstruction,
  EditOverlapError,
  EditRangeError,
  HashMismatchError,
} from "./apply"
import { computeLineHash } from "./hash"

const SHA1 = "sha1"
const h = (s: string) => computeLineHash(s, SHA1)

describe("applyEdits — happy paths", () => {
  describe("#given a single-line replace", () => {
    it("#when applied #then that line is replaced", () => {
      // given
      const text = "alpha\nbeta\ngamma\n"
      const edits: EditInstruction[] = [
        { lines: [2, 2], expected_hashes: [h("beta")], replacement: "BETA" },
      ]
      // when
      const result = applyEdits(text, edits, SHA1)
      // then
      expect(result).toBe("alpha\nBETA\ngamma\n")
    })
  })

  describe("#given a multi-line replace", () => {
    it("#when applied #then the whole range is replaced wholesale", () => {
      // given
      const text = "a\nb\nc\nd\n"
      const edits: EditInstruction[] = [
        {
          lines: [2, 3],
          expected_hashes: [h("b"), h("c")],
          replacement: "X\nY",
        },
      ]
      // when
      const result = applyEdits(text, edits, SHA1)
      // then
      expect(result).toBe("a\nX\nY\nd\n")
    })
  })

  describe("#given a delete via empty replacement", () => {
    it("#when applied #then the lines disappear and surrounding lines stay", () => {
      // given
      const text = "a\nb\nc\nd\n"
      const edits: EditInstruction[] = [
        { lines: [2, 3], expected_hashes: [h("b"), h("c")], replacement: "" },
      ]
      // when
      const result = applyEdits(text, edits, SHA1)
      // then
      expect(result).toBe("a\nd\n")
    })
  })

  describe("#given an insert via multi-line replacement", () => {
    it("#when applied #then 1 line becomes N lines (insert as 'replace anchor with itself + extras')", () => {
      // given
      const text = "a\nb\nc\n"
      const edits: EditInstruction[] = [
        { lines: [2, 2], expected_hashes: [h("b")], replacement: "b\n// added\n// also" },
      ]
      // when
      const result = applyEdits(text, edits, SHA1)
      // then
      expect(result).toBe("a\nb\n// added\n// also\nc\n")
    })
  })
})

describe("applyEdits — file metadata preservation", () => {
  describe("#given a CRLF file", () => {
    it("#when edited #then the result keeps CRLF line endings", () => {
      // given
      const text = "a\r\nb\r\nc\r\n"
      const edits: EditInstruction[] = [
        { lines: [2, 2], expected_hashes: [h("b")], replacement: "B" },
      ]
      // when
      const result = applyEdits(text, edits, SHA1)
      // then
      expect(result).toBe("a\r\nB\r\nc\r\n")
    })
  })

  describe("#given a file without a trailing newline", () => {
    it("#when edited #then no trailing newline is added", () => {
      // given
      const text = "a\nb\nc"
      const edits: EditInstruction[] = [
        { lines: [2, 2], expected_hashes: [h("b")], replacement: "B" },
      ]
      // when
      const result = applyEdits(text, edits, SHA1)
      // then
      expect(result).toBe("a\nB\nc")
    })
  })

  describe("#given a file with a UTF-8 BOM", () => {
    it("#when edited #then the BOM is preserved", () => {
      // given
      const text = "\uFEFFa\nb\n"
      const edits: EditInstruction[] = [
        { lines: [1, 1], expected_hashes: [h("a")], replacement: "A" },
      ]
      // when
      const result = applyEdits(text, edits, SHA1)
      // then
      expect(result).toBe("\uFEFFA\nb\n")
    })
  })
})

describe("applyEdits — multi-edit batches apply in reverse without drift", () => {
  describe("#given two non-overlapping edits in arbitrary order", () => {
    it("#when applied #then both land at their original line numbers", () => {
      // given
      const text = "a\nb\nc\nd\ne\n"
      const edits: EditInstruction[] = [
        // Out of source order on purpose: function should sort them.
        { lines: [4, 4], expected_hashes: [h("d")], replacement: "D" },
        { lines: [2, 2], expected_hashes: [h("b")], replacement: "B" },
      ]
      // when
      const result = applyEdits(text, edits, SHA1)
      // then
      expect(result).toBe("a\nB\nc\nD\ne\n")
    })
  })

  describe("#given an earlier-line replace that grows and a later-line edit", () => {
    it("#when applied #then later edit's hashes still match (because we apply in reverse)", () => {
      // given
      const text = "a\nb\nc\n"
      const edits: EditInstruction[] = [
        { lines: [1, 1], expected_hashes: [h("a")], replacement: "A1\nA2\nA3" },
        { lines: [3, 3], expected_hashes: [h("c")], replacement: "C" },
      ]
      // when
      const result = applyEdits(text, edits, SHA1)
      // then
      expect(result).toBe("A1\nA2\nA3\nb\nC\n")
    })
  })
})

describe("applyEdits — error surfaces (whole batch is rejected)", () => {
  describe("#given a hash that doesn't match the current file", () => {
    it("#when applied #then HashMismatchError and the file is unchanged", () => {
      // given
      const text = "a\nb\nc\n"
      const bogus = "00000000"
      const edits: EditInstruction[] = [
        { lines: [2, 2], expected_hashes: [bogus], replacement: "B" },
      ]
      // when / then
      expect(() => applyEdits(text, edits, SHA1)).toThrow(HashMismatchError)
    })
  })

  describe("#given expected_hashes count != range size", () => {
    it("#when applied #then EditRangeError", () => {
      // given
      const text = "a\nb\nc\n"
      const edits: EditInstruction[] = [
        { lines: [2, 3], expected_hashes: [h("b")], replacement: "X" },
      ]
      // when / then
      expect(() => applyEdits(text, edits, SHA1)).toThrow(EditRangeError)
    })
  })

  describe("#given a range past end of file", () => {
    it("#when applied #then EditRangeError", () => {
      // given
      const text = "a\nb\n"
      const edits: EditInstruction[] = [
        { lines: [3, 3], expected_hashes: [h("c")], replacement: "X" },
      ]
      // when / then
      expect(() => applyEdits(text, edits, SHA1)).toThrow(EditRangeError)
    })
  })

  describe("#given start > end in a range", () => {
    it("#when applied #then EditRangeError", () => {
      // given
      const text = "a\nb\nc\n"
      const edits: EditInstruction[] = [{ lines: [3, 2], expected_hashes: [], replacement: "X" }]
      // when / then
      expect(() => applyEdits(text, edits, SHA1)).toThrow(EditRangeError)
    })
  })

  describe("#given two overlapping edits", () => {
    it("#when applied #then EditOverlapError", () => {
      // given
      const text = "a\nb\nc\nd\n"
      const edits: EditInstruction[] = [
        { lines: [2, 3], expected_hashes: [h("b"), h("c")], replacement: "X" },
        { lines: [3, 4], expected_hashes: [h("c"), h("d")], replacement: "Y" },
      ]
      // when / then
      expect(() => applyEdits(text, edits, SHA1)).toThrow(EditOverlapError)
    })
  })

  describe("#given a hash failure in one of several edits", () => {
    it("#when applied #then nothing is written (whole batch rejected)", () => {
      // given
      const text = "a\nb\nc\n"
      const edits: EditInstruction[] = [
        { lines: [1, 1], expected_hashes: [h("a")], replacement: "A" },
        { lines: [3, 3], expected_hashes: ["00000000"], replacement: "C" }, // bad hash
      ]
      // when / then
      expect(() => applyEdits(text, edits, SHA1)).toThrow(HashMismatchError)
    })
  })
})
