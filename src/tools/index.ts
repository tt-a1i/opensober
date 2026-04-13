// opensober — tool registration barrel.
//
// Called by the plugin entry to produce the Hooks.tool map opencode expects.
// Each tool is wired lazily at this point — the per-tool `createXxxTool(config)`
// factories close over the resolved config so runtime permission and algorithm
// decisions have everything they need.

import type { ToolDefinition } from "@opencode-ai/plugin"
import type { ResolvedConfig } from "../config/types"
import { createEditTool } from "./edit/edit"
import { createReadTool } from "./read/read"
import { createTaskTool } from "./task/task"

/** Names of tools opensober registers in v1. Used by the CLI's summary view. */
export const TOOL_NAMES = ["read", "edit", "task"] as const
export type ToolName = (typeof TOOL_NAMES)[number]

export function createTools(config: ResolvedConfig): Record<ToolName, ToolDefinition> {
  return {
    read: createReadTool(config),
    edit: createEditTool(config),
    task: createTaskTool(config),
  }
}

export { assertCanDelegate, assertCanWrite, ToolPermissionError } from "./common/guards"
export { createEditTool } from "./edit/edit"
// Re-exports so consumers can reach the factories / errors directly when needed.
export { createReadTool } from "./read/read"
export { createTaskTool } from "./task/task"
