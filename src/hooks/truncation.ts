// opensober — generic tool-output truncation.
//
// Safety net applied to ALL tool outputs via tool.execute.after. Prevents any
// single tool call from consuming too much context window. Truncation is
// line-aligned so the agent doesn't see a broken partial line.
//
// This runs BEFORE context injection — we want to truncate the raw tool output
// first, then append context blocks on top.

const MAX_OUTPUT_CHARS = 120_000 // ~30k tokens at 4 chars/token

/**
 * If `text` exceeds MAX_OUTPUT_CHARS, truncate to the last complete line within
 * the limit and append a truncation notice. Returns the text unchanged if under.
 */
export function truncateToolOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text

  // Find the last newline within the budget.
  const cutPoint = text.lastIndexOf("\n", MAX_OUTPUT_CHARS)
  const safeCut = cutPoint > 0 ? cutPoint : MAX_OUTPUT_CHARS

  const kept = text.slice(0, safeCut)
  const droppedChars = text.length - safeCut
  const droppedLines = text.slice(safeCut).split("\n").length - 1

  return (
    `${kept}\n\n` +
    `[... truncated: ${droppedChars.toLocaleString()} more characters / ~${droppedLines} lines. ` +
    "Use more specific queries (grep with glob filter, or read with line ranges) to narrow results.]"
  )
}
