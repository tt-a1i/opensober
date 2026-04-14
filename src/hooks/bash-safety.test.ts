import { describe, expect, it } from "bun:test"
import { sanitizeBashArgs } from "./bash-safety"

describe("sanitizeBashArgs", () => {
  it("strips null bytes from command string", () => {
    const args = { command: "echo\x00hello" }
    sanitizeBashArgs(args)
    expect(args.command).toBe("echohello")
  })

  it("handles nested args", () => {
    const args = { command: "ls", options: { flag: "a\x00b" } }
    sanitizeBashArgs(args)
    expect((args.options as { flag: string }).flag).toBe("ab")
  })

  it("preserves non-string values", () => {
    const args = { command: "ls", timeout: 5000 }
    sanitizeBashArgs(args)
    expect(args.timeout).toBe(5000)
  })

  it("is a no-op for clean args", () => {
    const args = { command: "echo hello" }
    sanitizeBashArgs(args)
    expect(args.command).toBe("echo hello")
  })

  it("handles arrays", () => {
    const args = { command: "echo", items: ["a\x00b", "c"] }
    sanitizeBashArgs(args)
    expect(args.items).toEqual(["ab", "c"])
  })

  it("handles empty object gracefully", () => {
    const args = {}
    expect(() => sanitizeBashArgs(args)).not.toThrow()
  })
})
