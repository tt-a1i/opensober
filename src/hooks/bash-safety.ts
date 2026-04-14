// opensober — bash command safety hook.
//
// Strips null bytes from all string values in bash tool args.
// Defense-in-depth: opencode's native bash may already handle this,
// but null bytes can be used for command injection so we sanitize early.

function stripNullBytes(obj: unknown): void {
  if (obj === null || obj === undefined || typeof obj !== "object") return

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === "string") {
        obj[i] = obj[i].replaceAll("\0", "")
      } else {
        stripNullBytes(obj[i])
      }
    }
    return
  }

  const record = obj as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (typeof record[key] === "string") {
      record[key] = (record[key] as string).replaceAll("\0", "")
    } else {
      stripNullBytes(record[key])
    }
  }
}

export function sanitizeBashArgs(args: Record<string, unknown>): void {
  stripNullBytes(args)
}
