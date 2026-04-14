# opensober Roadmap

> Updated: 2026-04-14 | Current: v0.1.0

## v0.1.0 (shipped)

The "hand surgery knife" release. 7 tools, 1 hook, 3 agents, clean config, MIT license.

- [x] Config: 4-layer merge, Zod v4 strict, agent extends, prompt file:// resolution
- [x] Tools: read (hashline), edit (hashline), task (child session), grep, glob, ast_grep_search, ast_grep_replace
- [x] Hooks: tool.execute.after (truncation 120K + AGENTS.md context injection)
- [x] Agents: orchestrator (primary), explore (readonly), reviewer (readonly, delegates readonly-only)
- [x] CLI: doctor (0/1/2 exit), run
- [x] Permission: readonly + can_delegate + taint enforcement
- [x] Integration: server auth injection, graceful degradation, opencode config hook

---

## v0.2.0 — "Agent Intelligence"

**Theme: make agents actually good at using their tools.**

### Phase 1: Agent Prompts (highest ROI)

Currently orchestrator/explore/reviewer have zero system prompts. They don't know they have hashline edit, don't know when to delegate, don't know AST-grep exists.

- [ ] orchestrator prompt: explain hashline read→edit workflow, when to delegate to explore/reviewer, AST-grep use cases, permission rules
- [ ] explore prompt: search-only mindset, use grep/glob/ast_grep_search efficiently, never attempt edits
- [ ] reviewer prompt: readonly review approach, when to delegate to security-review subagent, structured review output format
- [ ] Prompt registered via config hook → opencode's AgentConfig.prompt
- [ ] Doctor shows "prompt: loaded" per agent

### Phase 2: LSP Tools (independent project, ~3K LOC)

6 IDE-grade tools that make agents dramatically better at understanding code.

- [ ] LSP client (vscode-jsonrpc, stdio transport)
- [ ] Server lifecycle manager (spawn, init handshake, idle timeout, SIGKILL fallback)
- [ ] Built-in server registry (~10 languages: TypeScript, Go, Python, Rust, Java, C/C++, Ruby, PHP)
- [ ] lsp_diagnostics — get errors/warnings before build
- [ ] lsp_goto_definition — jump to symbol definition
- [ ] lsp_find_references — find all usages
- [ ] lsp_rename — workspace-wide rename (write-class, assertCanWrite)
- [ ] lsp_symbols — document/workspace symbol search
- [ ] lsp_prepare_rename — validate rename before executing
- [ ] explore allowlist updated to include readonly LSP tools

### Phase 3: Session Resilience

Hooks that make long sessions survivable.

- [ ] Session recovery: missing tool results, thinking block issues, empty messages
- [ ] Preemptive compaction: monitor context usage, compact before hitting limits
- [ ] Compaction context preserver: re-inject critical context after compaction
- [ ] Thinking block validator: prevent API errors from malformed thinking blocks

---

## v0.3.0 — "Ecosystem"

**Theme: play well with existing tools and workflows.**

- [ ] .mcp.json loading + ${VAR} expansion
- [ ] .claude/rules/*.md conditional injection (globs + alwaysApply frontmatter)
- [ ] .claude/commands/*.md loading
- [ ] .claude/skills/*/SKILL.md loading
- [ ] skill-embedded MCP (stdio + HTTP)
- [ ] write tool (create new files, distinct from edit)
- [ ] Model fallback chains (per-agent, configurable)
- [ ] Background task execution (async task + task_status/task_result tools)

---

## v0.4.0 — "Observability"

**Theme: nothing is magic means you can see everything.**

- [ ] Execution Trace / `/why` command (what agent, what model, what hooks, what cost)
- [ ] Budget cap (token + $/session + $/day hard limits)
- [ ] Per-session cost tracking
- [ ] Hook call stack visualization
- [ ] doctor --explain (per-field provenance: "this value came from project layer")

---

## Non-goals (by design)

Things we intentionally don't do, per CONTRIBUTING.md's 9 rules:

- No keyword-driven mode switching
- No prompt-derived command execution
- No invisible automation that can't be disabled
- No telemetry (opt-in possible in future, never opt-out)
- No feature flags or backwards-compat shims
- No catch-all utilities (utils.ts, helpers.ts)

---

## Principles

1. **Add one concept, delete one.** The concept surface doesn't grow over time.
2. **Every behavior is visible, disable-able, and fails loud.**
3. **Match OmO's user value, not its complexity.** We ship fewer pieces that each work better.
4. **Prompts over code.** A well-prompted agent with 7 tools beats a mute agent with 26 tools.
