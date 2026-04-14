// opensober — opencode plugin entry.
//
// Initialization order:
//   1. injectServerAuth — before any client.session.* call
//   2. loadConfig — eager so config errors surface at plugin-load time
//   3. createTools — closes over config + client
//
// Hooks:
//   config               — registers opensober agents into opencode's agent map
//   tool                 — the v1 tools (read / edit / task / grep / glob)
//   tool.execute.after   — generic truncation + AGENTS.md context injection

import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import { loadConfig } from "./config/loader"
import { injectContext, truncateToolOutput } from "./hooks"
import { registerAgents } from "./plugin/register-agents"
import { createTools } from "./tools"
import { injectServerAuth } from "./tools/common/auth"

export const NAME = "opensober"
export const VERSION = "0.1.0"

const opensober: Plugin = async (input: PluginInput): Promise<Hooks> => {
  injectServerAuth(input.client)
  const { config } = loadConfig({ cwd: input.directory })
  return {
    config: async (openCodeConfig) => {
      registerAgents(openCodeConfig, config, input.directory)
    },
    tool: createTools(config, { client: input.client }),
    "tool.execute.after": async (toolInput, output) => {
      // 1. Truncation first (before context injection adds more text).
      output.output = truncateToolOutput(output.output)

      // 2. Context injection: only for our `read` tool.
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
