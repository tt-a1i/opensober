# opensober

> *Stay sober. Nothing is magic.*

**English** | [简体中文](./README.zh-CN.md)

An opencode plugin that doesn't try to be clever. Agent tools keep getting smarter, more magical, more opinionated. opensober goes the other way: every behavior is visible, disable-able, and fails loud.

**Status:** v0.1.x, API not yet stable. Not yet published to npm.

## Why

- **No invisible automation.** No keyword-driven modes. No prompt-derived command execution. Every context injection is named in config.
- **Readonly agents cannot escape their sandbox.** A readonly agent delegating to a writable agent is rejected at runtime — enforced by the `task` tool, not by documentation.
- **Edits can't silently clobber stale state.** `read` annotates each line with a content hash; `edit` rejects the whole batch if any hash has changed.

## Install

```bash
bun add opensober
```

Peer requirement: `@opencode-ai/plugin ^1.4.0`. Bun-only (>= 1.3.0); no Node fallback.

## Quickstart

Create `.opensober/config.jsonc` at your project root:

```jsonc
{
  "version": 1,
  "model": "anthropic/claude-opus-4-6",
  "agents": {
    "quick": {
      "extends": "orchestrator",
      "model": "openai/gpt-5-mini"
    }
  }
}
```

Check it loads cleanly:

```
$ bunx opensober doctor

== opensober doctor ==

config
  version:       1
  global model:  anthropic/claude-opus-4-6
  layers:
    default       (built-in)
    project       /repo/.opensober/config.jsonc

agents
  explore         anthropic/claude-opus-4-6      readonly, no-delegate
  orchestrator    anthropic/claude-opus-4-6      writable, delegates
  reviewer        anthropic/claude-opus-4-6      readonly, delegates (readonly-only)
  quick           openai/gpt-5-mini              writable, delegates

tools
  edit, read, task

warnings
  (none)
```

Exit codes: `0` clean, `1` warnings, `2` config failed to load.

## Commands

| Command | Purpose |
|---|---|
| `bunx opensober doctor`  | Health check: config summary, agents, tools, warnings |
| `bunx opensober run`     | Load config and print a session-ready summary |
| `bunx opensober install` | *(not yet implemented)* |

Both `doctor` and `run` take `--cwd <dir>` and `--config <path>`.

## Config layering

Four layers merge in order (later wins):

1. **default** — built-in baselines
2. **user** — `~/.config/opensober/config.jsonc`
3. **project** — `<project-root>/.opensober/config.jsonc`
4. **cli-override** — `--config <path>`

Project root is the nearest ancestor directory containing `.git`. If none is found, the project layer is silently skipped — single-file or CI scratch directories just work.

## Built-in agents

Three agents ship in the box:

- `orchestrator` — writable, may delegate to any agent
- `explore` — readonly, cannot delegate
- `reviewer` — readonly, may delegate only to other readonly agents

User-defined agents extend these via `extends`. Permission flags (`readonly`, `can_delegate`) inherit from the parent chain; overriding them explicitly is allowed but the `task` tool still enforces that readonly callers cannot reach writable targets.

## Learn more

- [`v1-scope.md`](./v1-scope.md) — frozen v1 scope
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — the nine hard rules
- [`round-7.5-memo.md`](./round-7.5-memo.md) — SDK investigation memo

## License

[MIT](./LICENSE)
