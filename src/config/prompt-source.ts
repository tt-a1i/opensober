// opensober — prompt source string parser.
//
// v1 supports exactly three forms (per v1-scope.md §9). Anything else is rejected:
//
//   1. file:///abs/path.md          absolute path on disk
//   2. file://~/rel/to/home.md      home-directory expansion
//   3. ./rel.md  or  rel.md         project-relative, resolved against the config file's dir
//
// The intentionally-rejected form is `file://relative/...` because by URL spec the segment
// after `file://` is the host, which makes the meaning ambiguous. Failing loud beats guessing.
//
// This module is split into two functions on purpose:
//   - validatePromptSourceSyntax: pure syntax check, used by Zod refines (no I/O, no path ctx)
//   - parsePromptSource:          resolves to an on-disk path, needs the caller's configDir

import { homedir } from "node:os"
import { resolve } from "node:path"

export type PromptSourceKind = "file-absolute" | "file-home" | "relative"

export interface PromptSource {
  /** Original string as written by the user, kept for diagnostics. */
  readonly raw: string
  readonly kind: PromptSourceKind
  /** Resolved absolute filesystem path (no I/O performed yet). */
  readonly path: string
}

export class PromptSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PromptSourceError"
  }
}

const FILE_ABSOLUTE = "file:///"
const FILE_HOME = "file://~/"
const FILE_PREFIX = "file://"

// RFC 3986 `scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )` followed by ":".
// Used to detect ANY URI-like input so we can reject schemes we don't support.
const URI_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

/**
 * Throws PromptSourceError if `raw` does not match one of the three supported forms
 * (per v1-scope.md §9). The "bare relative path" form is the catch-all default; everything
 * with a scheme other than file:///… or file://~/… is rejected, and bare absolute paths
 * are rejected too so users go through file:/// for that case.
 */
export function validatePromptSourceSyntax(raw: string): void {
  if (raw.length === 0) {
    throw new PromptSourceError("prompt source must not be empty")
  }
  if (raw.includes("\0")) {
    throw new PromptSourceError("prompt source must not contain NUL bytes")
  }

  // The two supported file:// forms.
  if (raw.startsWith(FILE_ABSOLUTE) || raw.startsWith(FILE_HOME)) {
    return
  }

  // A scheme other than the two file:// forms above (file://relative/, https://, ssh://, etc.)
  // is explicitly rejected. file://relative/ is ambiguous (host vs path); other schemes are
  // out of scope for v1.
  if (URI_SCHEME_RE.test(raw)) {
    throw new PromptSourceError(
      `unsupported prompt source: ${raw}\n` +
        "  Allowed forms (per v1-scope §9):\n" +
        "    1. file:///abs/path.md\n" +
        "    2. file://~/rel/to/home.md\n" +
        "    3. ./rel.md  or  rel.md  (project-relative; no scheme; no leading '/')",
    )
  }

  // Bare absolute paths (e.g. /etc/prompt.md) are rejected on purpose: file:/// is the
  // documented way to refer to absolute paths. Forcing one canonical syntax keeps the
  // surface small and unambiguous.
  if (raw.startsWith("/")) {
    throw new PromptSourceError(
      `bare absolute path is not supported: ${raw}\n` +
        "  Use file:///abs/path instead, or write a relative path (no leading '/').",
    )
  }

  // Bare relative path — accepted.
}

/**
 * Resolve a prompt source string against `configDir` (the directory of the config file).
 * Performs no disk I/O; returns the resolved path so callers can decide when/how to read it.
 */
export function parsePromptSource(raw: string, configDir: string): PromptSource {
  validatePromptSourceSyntax(raw)

  if (raw.startsWith(FILE_ABSOLUTE)) {
    const path = raw.slice(FILE_PREFIX.length) // keeps the leading "/"
    return { raw, kind: "file-absolute", path }
  }

  if (raw.startsWith(FILE_HOME)) {
    const tail = raw.slice(FILE_HOME.length)
    return { raw, kind: "file-home", path: resolve(homedir(), tail) }
  }

  // The validator above guarantees `raw` is now a bare relative path — no scheme,
  // no leading '/'. Resolve it against the config file's directory.
  return { raw, kind: "relative", path: resolve(configDir, raw) }
}
