# Changelog

## 0.1.0 (2026-04-14)

First release. An opencode plugin that doesn't try to be clever.

### Tools (7)

- **read** — hashline-annotated file reading (each line tagged with `N#hash` content digest; 2000-line / 200KB hard truncation)
- **edit** — atomic batch editing with hash verification (rejects the whole batch if any line changed since last read)
- **task** — child-session delegation via promptAsync + poll + messages (enforces readonly taint: readonly callers cannot reach writable targets)
- **grep** — ripgrep-powered content search with result truncation (200 results)
- **glob** — Bun.Glob file pattern matching with result truncation (200 results)
- **ast_grep_search** — AST-aware code pattern search via @ast-grep/napi (supports $VAR metavariables; 500 match cap)
- **ast_grep_replace** — AST-aware code replacement with metavariable substitution (default dry_run=true; write mode gated by readonly check)

### Hooks

- **tool.execute.after** — generic output truncation (120K char cap on all tool outputs) + AGENTS.md context injection (hierarchical collection from file directory to project root, per-session cached)

### Agents (3 built-in)

- **orchestrator** — primary agent, writable, can delegate to any agent
- **explore** — readonly subagent, cannot delegate (tools: read, grep, glob, ast_grep_search)
- **reviewer** — readonly subagent, can delegate only to other readonly agents

### Config

- 4-layer merge: default → user (`~/.config/opensober/config.jsonc`) → project (`.opensober/config.jsonc`) → CLI override (`--config`)
- Zod v4 strict validation with `$schema` passthrough for editor autocomplete
- Agent inheritance via `extends` with cycle detection
- `file://` prompt sources (absolute, `~/`, relative) resolved at registration time
- `tools.disabled` array to opt out of specific tools

### CLI

- `opensober doctor` — config health report (exit 0/1/2)
- `opensober run` — config load + summary

### Integration

- Plugin loads via `"plugin": ["file:///path/to/opensober/dist/index.js"]` in opencode.json
- Agents registered via `config` hook; orchestrator requires static `agent.orchestrator` entry in opencode.json for UI visibility
- Server auth injection (OPENCODE_SERVER_PASSWORD) with 3-path fallback
- Graceful degradation: missing config → console.warn + empty hooks (no crash)

### Known limitations

- LSP tools not included (planned for v0.2)
- .mcp.json / skill / Claude Code compat loaders deferred
- No background/async task execution (planned for v0.2)
- write tool (create new files) not included
- Agent system prompts not yet defined (orchestrator doesn't know how to optimally use its tools)
