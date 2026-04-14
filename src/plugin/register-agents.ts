// opensober — register our agents into opencode's config.
//
// The `Hooks.config` callback receives opencode's Config object and mutates it
// in-place. We inject our ResolvedAgent definitions into `config.agent` so that
// opencode recognizes agent names used in `session.prompt({ body: { agent } })`.
//
// Mapping:
//   ResolvedAgent.model       → AgentConfig.model
//   ResolvedAgent.description → AgentConfig.description
//   ResolvedAgent.prompt      → AgentConfig.prompt (file:// resolved to text HERE)
//   ResolvedAgent.tools       → AgentConfig.tools (allow/deny → { name: bool })
//   "orchestrator"            → mode "primary" (appears in UI agent tab)
//   all others                → mode "subagent" (delegation target only)
//
// Prompt file reading happens at registration time (not at config-parse time)
// so we keep the config layer free of I/O. If a prompt file is missing, we log
// a warning and skip the prompt rather than failing plugin load.
//
// Existing entries in opencode's agent config are preserved — if a user already
// defined the same agent name in their opencode.json, our definition does not
// overwrite it.

import { existsSync, readFileSync } from "node:fs"
import type { Config } from "@opencode-ai/plugin"
import type { ResolvedAgent } from "../config/extends"
import { parsePromptSource } from "../config/prompt-source"
import type { ResolvedConfig } from "../config/types"
import { TOOL_NAMES } from "../tools"

// opencode SDK defines AgentConfig inline inside Config.agent; pull the shape
// from the Config type rather than importing a separate named export.
type AgentConfig = NonNullable<NonNullable<Config["agent"]>[string]>

export function registerAgents(
  openCodeConfig: Config,
  ourConfig: ResolvedConfig,
  configDir: string,
): void {
  if (openCodeConfig.agent === undefined) {
    openCodeConfig.agent = {}
  }

  for (const [name, agent] of Object.entries(ourConfig.agents)) {
    // Respect user's opencode-level overrides — don't clobber.
    if (openCodeConfig.agent[name] !== undefined) continue
    openCodeConfig.agent[name] = toAgentConfig(name, agent, configDir)
  }
}

function toAgentConfig(name: string, agent: ResolvedAgent, configDir: string): AgentConfig {
  const config: AgentConfig = {
    model: agent.model,
    mode: name === "orchestrator" ? "primary" : "subagent",
  }

  if (agent.description !== undefined) {
    config.description = agent.description
  }

  // Resolve prompt and prompt_append file:// paths to real text content.
  const promptText = resolvePromptText(agent.prompt, configDir, name, "prompt")
  const appendText = resolvePromptText(agent.prompt_append, configDir, name, "prompt_append")

  if (promptText !== undefined || appendText !== undefined) {
    const parts: string[] = []
    if (promptText !== undefined) parts.push(promptText)
    if (appendText !== undefined) parts.push(appendText)
    config.prompt = parts.join("\n\n")
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

/**
 * Read a prompt source string (file:// or relative path) to its text content.
 * Returns undefined if the source is not set or the file doesn't exist (with a
 * console.warn so the user knows). Never throws — a missing prompt file should
 * not prevent the plugin from loading.
 */
function resolvePromptText(
  source: string | undefined,
  configDir: string,
  agentName: string,
  field: string,
): string | undefined {
  if (source === undefined) return undefined

  try {
    const parsed = parsePromptSource(source, configDir)
    if (!existsSync(parsed.path)) {
      console.warn(
        `[opensober] agent "${agentName}".${field}: file not found at ${parsed.path} — skipping`,
      )
      return undefined
    }
    return readFileSync(parsed.path, "utf8")
  } catch (e) {
    console.warn(
      `[opensober] agent "${agentName}".${field}: failed to resolve "${source}" — ${(e as Error).message}`,
    )
    return undefined
  }
}
