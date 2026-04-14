---
id: refactor-agnostic
spec: .agents/tasks/refactor-agnostic/spec.md
status: completed
updated: 2026-04-14T09:56:17Z
---

Extract a platform-agnostic `multicodex-core` from the monolith, then rewire the pi adapter around it without changing the documented user-facing surface.

## Stages
- [x] Stage 1:
  - Title: Extract pure helpers and shared types
  - Instructions: [extract-pure-helpers-and-shared-types.md](./stages/extract-pure-helpers-and-shared-types.md)
  - Depends On: none

- [x] Stage 2:
  - Title: Extract core state manager and storage
  - Instructions: [extract-core-state-manager-and-storage.md](./stages/extract-core-state-manager-and-storage.md)
  - Depends On: 1

- [x] Stage 3:
  - Title: Rewire pi adapter and compatibility barrel
  - Instructions: [rewire-pi-adapter-and-compatibility-barrel.md](./stages/rewire-pi-adapter-and-compatibility-barrel.md)
  - Depends On: 2

- [x] Stage 4:
  - Title: Add non-pi validation and parity regression coverage
  - Instructions: [add-non-pi-validation-and-parity-regression-coverage.md](./stages/add-non-pi-validation-and-parity-regression-coverage.md)
  - Depends On: 3

## Behavior parity constraints

This refactor must preserve exact behavior parity for the following:

- **Account selection**: manual override wins, auto-selection excludes exhausted accounts, prefers untouched (0% usage), prefers earliest weekly reset, falls back to random if usage unavailable, honors `excludeEmails` during retries
- **Usage parsing and refresh**: parse `wham/usage` payload, convert `reset_at` to ms timestamps, cache for 5 minutes, retry transient failures (2 retries, ~300ms then ~900ms backoff), treat abort-like failures as cancellations
- **Token refresh**: valid if ≥5 minutes remaining, refresh expired tokens, persist updated credentials, per-account refresh deduplication required
- **Quota/error rotation**: quota/rate-limit before any output triggers account cooldown + rotation + retry, once output forwarded do not rotate silently, bounded retry loop, on quota hit mark exhausted until next reset or fallback cooldown
- **Provider/adapter behavior**: mirror `openai-codex` metadata, inject selected account into request headers, rewrite provider metadata back to caller-facing ID on events, warn/skip if `openai-codex-responses` unavailable at startup
- **Public API compatibility**: existing root exports work, including those used by tests and external consumers

## Dependency rationale
- Stage 1 must land first because the selection, usage, and retry helpers are the pure seams that every later core module imports.
- Stage 2 depends on Stage 1 because the state manager should be assembled on top of the extracted helpers and shared types, not by re-implementing them.
- Stage 3 depends on Stage 2 because the pi adapter should become a thin consumer of the new core manager, storage adapter, and usage/token collaborators.
- Stage 4 depends on Stage 3 because the final parity sweep should validate both the non-pi core reuse path and the adapter/root compatibility surface after the rewiring is complete.

## Risks and edge cases
- Storage migration must preserve the current legacy `~/.pi/agent/multicodex.json` shape while still writing a canonical versioned schema once the core loads it.
- The reference implementation’s lower-usage tie-breaker must not leak into the current selection policy unless tests/docs explicitly opt into it.
- Manual account selection should stay session-local; do not persist adapter-only session overrides into storage.
- Token refresh deduplication is required: concurrent refreshes for the same account must share one in-flight promise. This is a spec requirement with dedicated test coverage.
- Adapter-specific browser launch failures must remain warnings, not hard crashes, in environments without an openable browser.
