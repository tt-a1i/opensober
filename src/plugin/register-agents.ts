// opensober — register our agents into opencode's config.
//
// The `Hooks.config` callback receives opencode's Config object and mutates it
// in-place. We inject our ResolvedAgent definitions into `config.agent` so that
// opencode recognizes agent names used in `session.prompt({ body: { agent } })`.
//
// Mapping:
//   ResolvedAgent.model       → AgentConfig.model
//   ResolvedAgent.description → AgentConfig.description
//   ResolvedAgent.tools       → AgentConfig.tools (allow/deny → { name: bool })
//   "orchestrator"            → mode "primary" (appears in UI agent tab)
//   all others                → mode "subagent" (delegation target only)
//
// We do NOT pass `prompt` here because our prompt might be a file:// path that
// hasn't been resolved to text yet. Prompt resolution lands in a later round.
//
// Existing entries in opencode's agent config are preserved — if a user already
// defined the same agent name in their opencode.json, our definition does not
// overwrite it.

import type { Config } from "@opencode-ai/plugin"
import type { ResolvedAgent } from "../config/extends"
import type { ResolvedConfig } from "../config/types"
import { TOOL_NAMES } from "../tools"

// opencode SDK defines AgentConfig inline inside Config.agent; pull the shape
// from the Config type rather than importing a separate named export.
type AgentConfig = NonNullable<NonNullable<Config["agent"]>[string]>

export function registerAgents(openCodeConfig: Config, ourConfig: ResolvedConfig): void {
  if (openCodeConfig.agent === undefined) {
    openCodeConfig.agent = {}
  }

  for (const [name, agent] of Object.entries(ourConfig.agents)) {
    // Respect user's opencode-level overrides — don't clobber.
    if (openCodeConfig.agent[name] !== undefined) continue
    openCodeConfig.agent[name] = toAgentConfig(name, agent)
  }
}

function toAgentConfig(name: string, agent: ResolvedAgent): AgentConfig {
  const config: AgentConfig = {
    model: agent.model,
    // Orchestrator is the primary UI agent; everything else is a delegation target.
    mode: name === "orchestrator" ? "primary" : "subagent",
  }

  // Only set description if it's a real string — AgentConfig.description is
  // optional-not-undefined under exactOptionalPropertyTypes.
  if (agent.description !== undefined) {
    config.description = agent.description
  }

  // Translate our allow/deny lists to opencode's { toolName: boolean } format.
  if (agent.tools !== undefined) {
    const toolMap: Record<string, boolean> = {}
    if (agent.tools.allow !== undefined) {
      for (const t of TOOL_NAMES) {
        toolMap[t] = agent.tools.allow.includes(t)
      }
    } else if (agent.tools.deny !== undefined) {
      for (const t of TOOL_NAMES) {
        toolMap[t] = !agent.tools.deny.includes(t)
      }
    }
    if (Object.keys(toolMap).length > 0) {
      config.tools = toolMap
    }
  }

  return config
}
