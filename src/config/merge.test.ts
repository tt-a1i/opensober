import { describe, expect, it } from "bun:test"
import { ConfigMergeError, deepMerge } from "./merge"

describe("deepMerge", () => {
  describe("#given override is undefined", () => {
    it("#when merged #then base is returned unchanged", () => {
      // given
      const base = { a: 1 }
      // when
      const result = deepMerge(base, undefined)
      // then
      expect(result).toEqual({ a: 1 })
    })
  })

  describe("#given base is undefined", () => {
    it("#when merged #then override is returned", () => {
      // when
      const result = deepMerge(undefined, { a: 1 })
      // then
      expect(result).toEqual({ a: 1 })
    })
  })

  describe("#given two disjoint plain objects", () => {
    it("#when merged #then result is the union of keys", () => {
      // when
      const result = deepMerge({ a: 1 }, { b: 2 })
      // then
      expect(result).toEqual({ a: 1, b: 2 })
    })
  })

  describe("#given two plain objects with overlapping primitive keys", () => {
    it("#when merged #then override value wins", () => {
      // when
      const result = deepMerge({ a: 1, b: 2 }, { a: 99 })
      // then
      expect(result).toEqual({ a: 99, b: 2 })
    })
  })

  describe("#given nested plain objects", () => {
    it("#when merged #then merge recurses key-by-key", () => {
      // given
      const base = { outer: { x: 1, y: 2 } }
      const override = { outer: { y: 99, z: 3 } }
      // when
      const result = deepMerge(base, override)
      // then
      expect(result).toEqual({ outer: { x: 1, y: 99, z: 3 } })
    })
  })

  describe("#given array values at the same key", () => {
    it("#when merged #then override array REPLACES base (no concat)", () => {
      // when
      const result = deepMerge({ list: [1, 2, 3] }, { list: [9] })
      // then
      expect(result).toEqual({ list: [9] })
    })
  })

  describe("#given mismatched types at the same key", () => {
    it("#when merged #then override wins wholesale", () => {
      // when
      const result = deepMerge({ a: 1 }, { a: { x: 2 } })
      // then
      expect(result).toEqual({ a: { x: 2 } })
    })
  })

  describe("#given override has explicit null", () => {
    it("#when merged #then null replaces (intentional override)", () => {
      // when
      const result = deepMerge({ a: 1 }, { a: null })
      // then
      expect(result).toEqual({ a: null })
    })
  })

  describe("#given a Date value", () => {
    it("#when merged #then Date is replaced wholesale, not recursed", () => {
      // given
      const d1 = new Date("2024-01-01")
      const d2 = new Date("2025-01-01")
      // when
      const result = deepMerge({ when: d1 }, { when: d2 })
      // then
      expect((result as { when: Date }).when).toBe(d2)
    })
  })

  describe("#given override has __proto__ at root", () => {
    it("#when merged #then ConfigMergeError with the root path", () => {
      // given
      const malicious = JSON.parse('{"__proto__": {"polluted": true}}')
      // when / then
      expect(() => deepMerge({ a: 1 }, malicious)).toThrow(ConfigMergeError)
      expect(() => deepMerge({ a: 1 }, malicious)).toThrow(/<root>/)
    })
  })

  describe("#given override has __proto__ deeply nested", () => {
    it("#when merged #then ConfigMergeError mentions the dotted path", () => {
      // given
      const malicious = JSON.parse('{"a": {"b": {"__proto__": {}}}}')
      // when / then
      expect(() => deepMerge({}, malicious)).toThrow(/a\.b/)
    })
  })

  describe("#given override has constructor key", () => {
    it("#when merged #then ConfigMergeError", () => {
      // when / then
      expect(() => deepMerge({}, JSON.parse('{"constructor": {"x": 1}}'))).toThrow(ConfigMergeError)
    })
  })

  describe("#given override has prototype key", () => {
    it("#when merged #then ConfigMergeError", () => {
      // when / then
      expect(() => deepMerge({}, JSON.parse('{"prototype": {}}'))).toThrow(ConfigMergeError)
    })
  })

  describe("#given a forbidden key inside an array element of a wholesale-replaced field", () => {
    it("#when merged #then still rejected (scan covers replaced subtrees)", () => {
      // given
      const malicious = JSON.parse('{"items": [{"__proto__": {}}]}')
      // when / then
      expect(() => deepMerge({}, malicious)).toThrow(/items\.\[0\]/)
    })
  })

  describe("#given the merge result", () => {
    it("#when merged #then prototype is plain Object (not polluted via forbidden keys)", () => {
      // when
      const result = deepMerge({ a: 1 }, { b: 2 }) as object
      // then
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    })

    it("#when merged #then base and override are not mutated", () => {
      // given
      const base = { a: { x: 1 } }
      const override = { a: { y: 2 } }
      // when
      const result = deepMerge(base, override)
      // then
      expect(base).toEqual({ a: { x: 1 } })
      expect(override).toEqual({ a: { y: 2 } })
      expect(result).not.toBe(base)
    })
  })
})
