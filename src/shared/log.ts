// opensober — per-session logger.
//
// Goals:
// 1. Per-session JSONL file under the XDG state directory, so `jq`/grep work out of the box.
// 2. Honour the XDG Base Directory spec properly:
//      precedence = OPENSOBER_STATE_DIR  >  $XDG_STATE_HOME/opensober  >  ~/.local/state/opensober
//    The first slot is an escape hatch for tests and unusual setups; the middle slot is what
//    Linux users with a custom XDG layout expect us to follow; the last slot is the spec default.
// 3. Zero third-party deps.
//
// Rotation, colored stderr, and verbosity flags land later when the plugin lifecycle starts
// using the logger.

import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

type Level = "debug" | "info" | "warn" | "error"

interface LogRecord {
  ts: string
  level: Level
  msg: string
  data?: unknown
}

function resolveStateDir(): string {
  const override = process.env.OPENSOBER_STATE_DIR
  if (override) return override
  const xdgState = process.env.XDG_STATE_HOME
  if (xdgState) return join(xdgState, "opensober")
  return join(homedir(), ".local", "state", "opensober")
}

const STATE_DIR = resolveStateDir()

function resolveLogPath(sessionId: string): string {
  return join(STATE_DIR, "sessions", `${sessionId}.log`)
}

function serialize(record: LogRecord): string {
  return `${JSON.stringify(record)}\n`
}

export interface Logger {
  readonly path: string
  debug(msg: string, data?: unknown): void
  info(msg: string, data?: unknown): void
  warn(msg: string, data?: unknown): void
  error(msg: string, data?: unknown): void
}

export function createLogger(sessionId: string): Logger {
  const path = resolveLogPath(sessionId)
  mkdirSync(dirname(path), { recursive: true })

  const write = (level: Level, msg: string, data?: unknown): void => {
    const record: LogRecord = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...(data !== undefined ? { data } : {}),
    }
    try {
      appendFileSync(path, serialize(record), "utf8")
    } catch {
      // Never let logging crash the caller. If disk is full or perms are wrong,
      // we silently drop. The user will notice via missing logs, not crashes.
    }
  }

  return {
    path,
    debug: (msg, data) => write("debug", msg, data),
    info: (msg, data) => write("info", msg, data),
    warn: (msg, data) => write("warn", msg, data),
    error: (msg, data) => write("error", msg, data),
  }
}
