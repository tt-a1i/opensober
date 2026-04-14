// opensober — tool registration barrel.
//
// Called by the plugin entry to produce the Hooks.tool map opencode expects.
// Each tool is wired lazily at this point — the per-tool `createXxxTool(config)`
// factories close over the resolved config so runtime permission and algorithm
// decisions have everything they need.
//
// `config.tools.disabled` filters out entries before they're returned. Unknown
// names in the list are ignored silently; `doctor` surfaces them separately so
// users notice typos without the plugin failing to load.

import type { ToolDefinition } from "@opencode-ai/plugin"
import type { OpencodeClient } from "@opencode-ai/sdk"
import type { ResolvedConfig } from "../config/types"
import { createEditTool } from "./edit/edit"
import { createGlobTool } from "./glob/glob"
import { createGrepTool } from "./grep/grep"
import { createReadTool } from "./read/read"
import { createTaskTool } from "./task/task"

/** Names of tools opensober ships in v1. Used by the CLI's summary view and by doctor. */
export const TOOL_NAMES = ["read", "edit", "task", "grep", "glob"] as const
export type ToolName = (typeof TOOL_NAMES)[number]

/** Runtime dependencies that tools need beyond config. */
export interface ToolDependencies {
  readonly client: OpencodeClient
}

export function createTools(
  config: ResolvedConfig,
  deps: ToolDependencies,
): Partial<Record<ToolName, ToolDefinition>> {
  const all: Record<ToolName, ToolDefinition> = {
    read: createReadTool(config),
    edit: createEditTool(config),
    task: createTaskTool(config, deps),
    grep: createGrepTool(config),
    glob: createGlobTool(config),
  }

  const disabled = new Set(config.tools.disabled)
  const result: Partial<Record<ToolName, ToolDefinition>> = {}
  for (const name of TOOL_NAMES) {
    if (disabled.has(name)) continue
    result[name] = all[name]
  }
  return result
}

export { assertCanDelegate, assertCanWrite, ToolPermissionError } from "./common/guards"
export { createEditTool } from "./edit/edit"
export { createReadTool } from "./read/read"
export { createTaskTool } from "./task/task"
