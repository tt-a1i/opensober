// opensober — opencode plugin entry.
//
// This file is intentionally thin. Wiring for the plugin lifecycle lives under
// ./plugin (to be added in a later step). For now we expose a placeholder so the
// build pipeline is exercisable.

export const NAME = "opensober"
export const VERSION = "0.1.0"

export default function opensober(): never {
  throw new Error(
    "opensober: plugin entry not wired yet. The lifecycle (config/tools/hooks/agents) lands next.",
  )
}
