// opensober — Hashline Edit: per-line content hash.
//
// We keep this dead simple: hash the raw line text (no line number, no terminator),
// take the first 8 hex characters of the digest. 32 bits of keyspace gives a
// per-file collision rate around 10⁻⁴ for a 1000-line file (birthday paradox).
// That's good enough as a "is this still the line you saw?" check, and short
// enough not to dominate the annotated output's column width.

import { createHash } from "node:crypto"

export type HashAlgorithm = "sha1" | "sha256"

const HASH_LENGTH = 8

export function computeLineHash(line: string, algorithm: HashAlgorithm): string {
  return createHash(algorithm).update(line, "utf8").digest("hex").slice(0, HASH_LENGTH)
}
