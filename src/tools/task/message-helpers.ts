// opensober — shared message extraction helpers.
//
// Used by both runner.ts (synchronous child polling) and manager.ts
// (background task polling) to pull text out of opencode session messages.

type AnyRecord = Record<string, unknown>

/**
 * Extract concatenated text from an array of message parts, keeping only
 * parts with `{ type: "text", text: string }`.
 */
export function extractTextFromParts(parts: unknown[]): string {
  return parts
    .filter((p): p is { type: "text"; text: string } => {
      const r = p as AnyRecord
      return r.type === "text" && typeof r.text === "string"
    })
    .map((p) => p.text)
    .join("\n\n")
}

/**
 * Walk messages backwards to find the last assistant message.
 * Returns the `info` record and `parts` array, or null if none found.
 */
export function findLastAssistantMessage(
  messages: unknown[],
): { info: AnyRecord; parts: unknown[] } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as AnyRecord
    const info = msg.info as AnyRecord | undefined
    if (info?.role === "assistant") {
      return { info, parts: (msg.parts as unknown[]) ?? [] }
    }
  }
  return null
}
