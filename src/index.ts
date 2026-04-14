// opensober — opencode plugin entry.
//
// Initialization order:
//   1. injectServerAuth — before any client.session.* call
//   2. loadConfig — eager, but GRACEFUL: if no config exists, we still load
//      with a degraded warning instead of crashing the entire plugin
//   3. createTools — closes over config + client
//
// Hooks:
//   config               — registers opensober agents into opencode's agent map
//   tool                 — the v1 tools (read / edit / write / task / grep / glob / ast_grep)
//   tool.execute.before  — bash command safety (null-byte sanitization)
//   tool.execute.after   — generic truncation + AGENTS.md context injection

import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import { loadConfig } from "./config/loader"
import type { LoaderResult } from "./config/types"
import { injectContext, sanitizeBashArgs, truncateToolOutput } from "./hooks"
import { registerAgents } from "./plugin/register-agents"
import { createTools } from "./tools"
import { injectServerAuth } from "./tools/common/auth"

const opensober: Plugin = async (input: PluginInput): Promise<Hooks> => {
  injectServerAuth(input.client)

  // Graceful config loading: if config is missing or broken, warn but don't crash.
  // A crashed plugin means zero tools registered — worse than degraded mode.
  let loaded: LoaderResult | null = null
  try {
    loaded = loadConfig({ cwd: input.directory })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(
      `[opensober] config load failed — plugin running in degraded mode (no tools, no agents).\n` +
        `  Error: ${msg}\n` +
        `  Fix: create .opensober/config.jsonc in your project root or ~/.config/opensober/config.jsonc\n` +
        `  Minimum content: { "version": 1, "model": "your-provider/your-model" }`,
    )
    // Return empty hooks — opencode continues with its own built-in tools.
    return {}
  }

  const { config } = loaded
  return {
    config: async (openCodeConfig) => {
      registerAgents(openCodeConfig, config, input.directory)
    },
    tool: createTools(config, { client: input.client }),
    "tool.execute.before": async (toolInput, output) => {
      if (toolInput.tool === "bash") {
        sanitizeBashArgs(output.args)
      }
    },
    "tool.execute.after": async (toolInput, output) => {
      output.output = truncateToolOutput(output.output)
      if (toolInput.tool === "read") {
        const filePath = (toolInput.args as { file?: string })?.file
        if (typeof filePath === "string") {
          output.output = injectContext(output.output, filePath, toolInput.sessionID)
        }
      }
    },
  }
}

export default opensober
export const server = opensober
