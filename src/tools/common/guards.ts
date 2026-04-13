// opensober — tool-layer permission guards.
//
// Pure, config-aware checks used by write-class tools (edit, future write) and by
// the delegate-class tool (task). Keeping them here — not inside each tool — means
// the safety contract in v1-scope §1 (agent readonly / can_delegate) lands exactly
// once, testable in isolation, and consumed the same way everywhere.
//
// These are runtime enforcement. The schema layer already rejects obvious misuse
// (e.g. unknown agent names inside `extends`), but it can't know which tool the
// agent is about to call. That's what these functions are for.

import type { ResolvedConfig } from "../../config/types"

export class ToolPermissionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ToolPermissionError"
  }
}

/**
 * Throws ToolPermissionError if the caller agent is readonly.
 * Call this at the top of every write-class tool's execute().
 */
export function assertCanWrite(callerAgent: string, config: ResolvedConfig): void {
  const caller = config.agents[callerAgent]
  if (caller === undefined) {
    throw new ToolPermissionError(
      `agent "${callerAgent}" not found in config; refusing write-class tool call`,
    )
  }
  if (caller.readonly) {
    throw new ToolPermissionError(
      `agent "${callerAgent}" is readonly; write-class tools are not available for this agent`,
    )
  }
}

/**
 * Throws ToolPermissionError unless the caller is allowed to delegate to the target.
 * Two checks, in this order:
 *   1. caller.can_delegate === true
 *   2. if caller.readonly === true, target.readonly must also be true
 *      (readonly taint — a readonly agent cannot escape its sandbox by delegating
 *      to a writable one).
 */
export function assertCanDelegate(
  callerAgent: string,
  targetAgent: string,
  config: ResolvedConfig,
): void {
  const caller = config.agents[callerAgent]
  if (caller === undefined) {
    throw new ToolPermissionError(`caller agent "${callerAgent}" not found in config`)
  }
  if (!caller.can_delegate) {
    throw new ToolPermissionError(
      `agent "${callerAgent}" cannot delegate (can_delegate=false in config)`,
    )
  }

  const target = config.agents[targetAgent]
  if (target === undefined) {
    throw new ToolPermissionError(`delegation target agent "${targetAgent}" not found in config`)
  }

  if (caller.readonly && !target.readonly) {
    throw new ToolPermissionError(
      `readonly agent "${callerAgent}" cannot delegate to writable agent "${targetAgent}"; ` +
        "the target must also be readonly (readonly cannot be escaped via delegation)",
    )
  }
}
