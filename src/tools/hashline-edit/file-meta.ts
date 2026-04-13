// opensober — Hashline Edit: file-level metadata.
//
// We split a file into line-content + three pieces of metadata:
//   - hasBOM:           UTF-8 BOM at the start? we drop it from the parsed lines but
//                       reattach it on reconstruction so we don't accidentally strip it
//                       out from under the user's editor.
//   - newline:          \n or \r\n (whichever wins by count). We pick the dominant style
//                       so a Windows-style file remains Windows-style after editing.
//   - trailingNewline:  did the file end with a newline? POSIX prefers yes, but plenty
//                       of files (and git's last commit hook) care about preserving the
//                       original answer either way.
//
// `parseFile` and `reconstructFile` are the only public functions; they round-trip
// any input that uses one consistent newline style and an optional UTF-8 BOM.

const UTF8_BOM = "\uFEFF"

export interface FileMetadata {
  readonly hasBOM: boolean
  readonly newline: "\n" | "\r\n"
  readonly trailingNewline: boolean
}

export interface ParsedFile {
  readonly meta: FileMetadata
  /** Each line's text only — no trailing newline characters. */
  readonly lines: readonly string[]
}

function detectNewline(text: string): "\n" | "\r\n" {
  // Count CRLF occurrences. If any exist, treat as CRLF; otherwise default to LF.
  // Mixed line endings are not common enough in practice to deserve a third "mixed" case.
  return text.includes("\r\n") ? "\r\n" : "\n"
}

export function parseFile(text: string): ParsedFile {
  const hasBOM = text.startsWith(UTF8_BOM)
  const body = hasBOM ? text.slice(UTF8_BOM.length) : text
  const newline = detectNewline(body)
  const trailingNewline = body.endsWith(newline)

  // Strip the trailing newline (if present) before splitting so we don't get a phantom
  // empty trailing element in the lines array.
  const trimmed = trailingNewline ? body.slice(0, -newline.length) : body
  // Splitting on /\r\n|\n/ tolerates the rare mixed-line file by treating both as separators.
  // The dominant newline detected above is what reconstruct will use to rejoin them.
  const lines = trimmed === "" ? [] : trimmed.split(/\r\n|\n/)

  return { meta: { hasBOM, newline, trailingNewline }, lines }
}

export function reconstructFile(lines: readonly string[], meta: FileMetadata): string {
  const body =
    lines.join(meta.newline) + (meta.trailingNewline && lines.length > 0 ? meta.newline : "")
  return meta.hasBOM ? UTF8_BOM + body : body
}
