// opensober — CLI error formatter.
//
// Centralized so every subcommand reports config errors the same way. Each error
// class gets its own header so a user can scan the screen and immediately know which
// stage failed: file IO, JSONC syntax, schema, or agent extends.
//
// The sink is parameterized so tests can capture lines without mocking console.

import pico from "picocolors"
import { ZodError } from "zod"
// ExtendsCycleError extends ExtendsError, so a single instanceof catches both.
import { ExtendsError } from "../config/extends"
import { ConfigLoadError } from "../config/loader"

export type ErrorSink = (line: string) => void

const DEFAULT_SINK: ErrorSink = (line) => {
  console.error(line)
}

export function formatError(err: unknown, write: ErrorSink = DEFAULT_SINK): void {
  if (err instanceof ConfigLoadError) {
    write(pico.red("config load error:"))
    write(err.message)
    return
  }

  if (err instanceof ZodError) {
    write(pico.red("config schema error:"))
    for (const issue of err.issues) {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>"
      write(`  ${path}: ${issue.message}`)
    }
    return
  }

  // ExtendsCycleError extends ExtendsError, so this single check covers both.
  if (err instanceof ExtendsError) {
    write(pico.red("agent extends error:"))
    write(err.message)
    return
  }

  if (err instanceof Error) {
    write(`${pico.red("error:")} ${err.message}`)
    return
  }

  write(`${pico.red("unknown error:")} ${String(err)}`)
}
