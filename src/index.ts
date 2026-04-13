// opensober — opencode plugin entry.
//
// Eager loadConfig at plugin-load time so any config error surfaces here, not
// later at first hook invocation. Errors are intentionally NOT wrapped: keeping
// ConfigLoadError / ZodError / ExtendsError as-is lets the CLI's error formatter
// (and any future opencode-side reporter) display them with their original shape.
//
// No hooks are registered yet; they land in later rounds. This module's only job
// today is to fail loudly on bad config and to satisfy the @opencode-ai/plugin
// contract so opencode can load us at all.

import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import { loadConfig } from "./config/loader"

export const NAME = "opensober"
export const VERSION = "0.1.0"

const opensober: Plugin = async (input: PluginInput): Promise<Hooks> => {
  loadConfig({ cwd: input.directory })
  return {}
}

export default opensober
