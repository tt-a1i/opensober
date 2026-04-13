// opensober — shared output formatters for tool return strings.
//
// Three helpers keep every tool's output visually consistent:
//   - formatBytes:         human size string, stable scale (B / KB / MB / GB)
//   - formatKeyValueBlock: aligned `key:  value` block used by edit / task
//   - truncatePreview:     single-line preview of possibly-multiline text
//
// Style (Round 7 Q1 = A): label + indentation, no markdown, no XML.

export function formatBytes(bytes: number): string {
  if (bytes < 0) return `${bytes} B` // round-trippable even for oddities
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export interface KVRow {
  readonly key: string
  readonly value: string
}

/**
 * Render a block of `key: value` rows with a 2-space indent and keys right-padded
 * so the values land in a single aligned column. Returns "" for an empty rows array.
 */
export function formatKeyValueBlock(rows: readonly KVRow[], indent = "  "): string {
  if (rows.length === 0) return ""
  const maxKey = Math.max(...rows.map((r) => r.key.length))
  return rows
    .map((r) => {
      const pad = " ".repeat(maxKey - r.key.length)
      return `${indent}${r.key}:${pad}  ${r.value}`
    })
    .join("\n")
}

/**
 * Collapse whitespace and clamp to `maxLen` characters. If truncation happens,
 * a single ellipsis ("…") is appended. Used for prompt/text previews where the
 * full content would bloat a tool-output header.
 */
export function truncatePreview(text: string, maxLen: number): string {
  const flat = text.replace(/\s+/g, " ").trim()
  if (flat.length <= maxLen) return flat
  return `${flat.slice(0, maxLen)}…`
}
