// opensober — Hashline Edit: validate and apply edit instructions.
//
// Pipeline (per Round 5 user reminders):
//   1. Per-edit structural validation (range valid, hash count matches range size).
//   2. No-overlap check across edits, on ORIGINAL line numbers.
//   3. Hash validation against current file content.
//   4. Apply in REVERSE order by startLine — line numbers above any earlier-applied
//      edit stay unchanged, so we never have to re-index.
//
// Per Round 5 Q5: any failure in steps 1–3 rejects the WHOLE batch — no partial
// application. The function either returns the full new file text or throws.
//
// Replacement semantics:
//   replacement = ""           -> delete the line range
//   replacement = "abc"        -> single line "abc"
//   replacement = "a\nb"       -> two lines "a", "b"
//   replacement = "abc\n"      -> two lines "abc", "" (trailing newline = trailing blank)
// The split honours both \n and \r\n as separators, but reconstruction always uses
// the FILE's detected newline style. This is a deliberate normalization: keeping
// mixed line endings inside a single file is not worth the surface complexity.

import { type FileMetadata, parseFile, reconstructFile } from "./file-meta"
import { computeLineHash, type HashAlgorithm } from "./hash"

export interface EditInstruction {
  /** 1-indexed inclusive [startLine, endLine]. */
  readonly lines: readonly [number, number]
  /** One hash per line in the range, in order. */
  readonly expected_hashes: readonly string[]
  /** Replacement text. "" deletes; multi-line strings expand into multiple lines. */
  readonly replacement: string
}

export class HashMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "HashMismatchError"
  }
}

export class EditRangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EditRangeError"
  }
}

export class EditOverlapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EditOverlapError"
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation steps
// ─────────────────────────────────────────────────────────────────────────────

function validateEditStructure(edit: EditInstruction, lineCount: number, idx: number): void {
  const [start, end] = edit.lines
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    throw new EditRangeError(
      `edit #${idx}: invalid range [${start}, ${end}] — must be 1-indexed and start <= end`,
    )
  }
  if (end > lineCount) {
    throw new EditRangeError(
      `edit #${idx}: range [${start}, ${end}] extends past file length ${lineCount}`,
    )
  }
  const expected = end - start + 1
  if (edit.expected_hashes.length !== expected) {
    throw new EditRangeError(
      `edit #${idx}: expected_hashes has ${edit.expected_hashes.length} entries but range covers ${expected} lines`,
    )
  }
}

function validateNoOverlap(edits: readonly EditInstruction[]): void {
  // Sort copies of the ranges by startLine and check adjacent pairs.
  const sorted = edits
    .map((e, i) => ({ start: e.lines[0], end: e.lines[1], idx: i }))
    .sort((a, b) => a.start - b.start)
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    if (prev === undefined || curr === undefined) continue
    if (curr.start <= prev.end) {
      throw new EditOverlapError(
        `edits #${prev.idx} ([${prev.start}, ${prev.end}]) and #${curr.idx} ([${curr.start}, ${curr.end}]) overlap`,
      )
    }
  }
}

function validateHashes(
  edit: EditInstruction,
  lines: readonly string[],
  algorithm: HashAlgorithm,
  idx: number,
): void {
  const [start, end] = edit.lines
  for (let lineNum = start; lineNum <= end; lineNum++) {
    const expected = edit.expected_hashes[lineNum - start]
    const actual = computeLineHash(lines[lineNum - 1] ?? "", algorithm)
    if (expected !== actual) {
      throw new HashMismatchError(
        `edit #${idx}: line ${lineNum} hash mismatch (expected ${expected}, got ${actual}) — ` +
          "the file changed since it was read; re-read it and retry",
      )
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Replacement splitting
// ─────────────────────────────────────────────────────────────────────────────

function splitReplacement(replacement: string): string[] {
  if (replacement === "") return []
  return replacement.split(/\r\n|\n/)
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

export function applyEdits(
  text: string,
  edits: readonly EditInstruction[],
  algorithm: HashAlgorithm,
): string {
  const { lines, meta } = parseFile(text)

  // 1. Per-edit structural validation
  for (let i = 0; i < edits.length; i++) {
    validateEditStructure(edits[i] as EditInstruction, lines.length, i)
  }

  // 2. Cross-edit overlap check on ORIGINAL ranges (before any reindexing)
  validateNoOverlap(edits)

  // 3. Hash validation against current content (after structural is known clean)
  for (let i = 0; i < edits.length; i++) {
    validateHashes(edits[i] as EditInstruction, lines, algorithm, i)
  }

  // 4. Apply in REVERSE order so earlier-line edits don't shift later edits' indices.
  const sortedReverse = [...edits].sort((a, b) => b.lines[0] - a.lines[0])
  const newLines = [...lines]
  for (const edit of sortedReverse) {
    const [start, end] = edit.lines
    const replacementLines = splitReplacement(edit.replacement)
    newLines.splice(start - 1, end - start + 1, ...replacementLines)
  }

  return reconstructFile(newLines, meta)
}

// Re-exports for callers that need to construct sentinel meta objects in tests, etc.
export type { FileMetadata }
