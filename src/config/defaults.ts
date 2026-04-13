// opensober — built-in agent baselines.
//
// These are the three v1 agents (per v1-scope.md §1). Their permission flags are the
// load-bearing security invariants that the task tool will enforce at delegation time;
// changing them here changes the product's safety model.
//
// User config can override these by name — but the loader applies the override on top of
// these baselines, so e.g. setting `agents.explore.tools.allow = [...]` only shifts the
// allowlist; it cannot flip explore from readonly=true to readonly=false unless the user
// sets `readonly: false` explicitly.

import type { AgentDefinition } from "./schema"

/** Names of the agents that ship in the box. Used by the loader to seed the agent map. */
export const BUILTIN_AGENT_NAMES = ["orchestrator", "explore", "reviewer"] as const
export type BuiltinAgentName = (typeof BUILTIN_AGENT_NAMES)[number]

export const BUILTIN_AGENTS: Record<BuiltinAgentName, AgentDefinition> = {
  orchestrator: {
    readonly: false,
    can_delegate: true,
    description:
      "Default executor. Plans, delegates, and edits. Inherits the global model unless overridden.",
  },

  explore: {
    readonly: true,
    can_delegate: false,
    description:
      "Read-only exploration agent. Cannot edit, write, or delegate. Useful for fast " +
      "codebase questions where the answer is in the repo, not in another agent.",
    tools: {
      allow: ["grep", "glob", "read", "lsp_symbols", "lsp_goto_definition", "lsp_find_references"],
    },
  },

  reviewer: {
    readonly: true,
    can_delegate: true,
    description:
      "Read-only reviewer. May delegate to other readonly agents (e.g. a security-review " +
      "subagent) but never to a writable one — enforced by the task tool, not by convention.",
  },
}
