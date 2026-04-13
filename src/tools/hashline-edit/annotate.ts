// opensober — Hashline Edit: render a file with per-line hashes for the agent to read.
//
// Output format (per Round 5 Q3, decided):
//   {lineNum}#{8charHash}  {line content as-is}
//
// Each annotated line is joined with "\n" regardless of the file's native newline
// style. The annotated string is purely for display to the agent; the file's
// original newline + BOM + trailing-newline metadata is recovered separately by
// applyEdits via parseFile, so this layer doesn't need to preserve them.

import { parseFile } from "./file-meta"
import { computeLineHash, type HashAlgorithm } from "./hash"

const COLUMN_SEPARATOR = "  "

export interface AnnotatedRead {
  /** Text to show the agent: one annotated row per source line, joined by "\n". */
  readonly annotated: string
  /** 1-indexed lineNum -> 8-char hex hash, useful for tools that want to verify later. */
  readonly hashes: ReadonlyMap<number, string>
}

export function annotate(text: string, algorithm: HashAlgorithm): AnnotatedRead {
  const { lines } = parseFile(text)
  const hashes = new Map<number, string>()
  const rows: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    const lineNum = i + 1
    const hash = computeLineHash(line, algorithm)
    hashes.set(lineNum, hash)
    rows.push(`${lineNum}#${hash}${COLUMN_SEPARATOR}${line}`)
  }

  return { annotated: rows.join("\n"), hashes }
}
