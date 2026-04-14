// opensober — opencode plugin entry.
//
// Initialization order:
//   1. injectServerAuth — before any client.session.* call, so password-protected
//      opencode servers work.
//   2. loadConfig — eager so config errors surface at plugin-load time.
//   3. createTools — closes over config + client for runtime use.
//
// Hooks:
//   config  — registers opensober agents into opencode's agent map so that
//             session.prompt({ body: { agent: "explore" } }) resolves.
//   tool    — the three v1 tools (read / edit / task).
//
// Errors from loadConfig propagate unwrapped (see Round 4 design: "don't wrap").

import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import { loadConfig } from "./config/loader"
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
  }
}

export default opensober
