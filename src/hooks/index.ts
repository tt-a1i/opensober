// opensober — hook barrel.
//
// Exports for the two hook callbacks wired by the plugin entry (src/index.ts):
//   tool.execute.before — bash command safety (null-byte sanitization)
//   tool.execute.after  — generic truncation + AGENTS.md context injection

export { sanitizeBashArgs } from "./bash-safety"
export { clearSessionCache, collectAgentsMd, injectContext } from "./context-injection"
export { truncateToolOutput } from "./truncation"
