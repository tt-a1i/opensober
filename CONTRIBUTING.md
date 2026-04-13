# Contributing to opensober

Thanks for looking. Before proposing changes, read the 9 hard rules below. They are not style
preferences; they are the product.

## The Nine Rules

1. **One in, one out.** Adding a new concept (agent / tool / hook / skill) requires removing one.
   We do not grow the concept surface over time.

2. **No invisible automation.** Any automatic behavior must be listed somewhere the user can see
   and be disable-able via config. Default visibility is the floor, not the ceiling.

3. **500 LOC hard cap.** Files over 500 lines are rejected. 200 LOC is the soft target.

4. **No feature flags. No back-compat shims.** A breaking change is a breaking change. Bump the
   version. Do not carry dead paths.

5. **Every hook answers: "what breaks without me?"** Answer must be concrete. If the answer is
   "things might look slightly off," the hook is deleted.

6. **The README stays clean.** No review screenshots. No Discord banners. No screeds about
   competitors. Code speaks.

7. **Telemetry is never opt-out.** If we ever ship telemetry (we currently do not), it is opt-in
   and documented in one paragraph.

8. **No prompt-derived command execution.** We do not scan the user's text for slash commands,
   keywords, or mode hints. The user types the thing or they do not get the thing.

9. **No keyword-driven mode switching.** Modes are selected explicitly or not at all. "ultrawork"
   and its cousins do not exist here.

## Development

```bash
bun install
bun run typecheck
bun test
bun run lint
bun run build
```

## Commit Style

Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
Present tense, imperative mood.

## Pull Requests

- One concern per PR.
- If you added a concept, state which concept you removed (rule 1).
- If you added automation, state how it is disclosed and disabled (rule 2).
- If you added a hook, state what breaks without it (rule 5).

PRs that skip these statements get asked to add them before review.

## Clean-Room Discipline

opensober is a clean-room implementation. Contributors must not copy code, prompt strings,
naming, or documentation from other agent-harness projects. Borrowing *ideas* and *algorithms*
is fine; borrowing *text* is not.
