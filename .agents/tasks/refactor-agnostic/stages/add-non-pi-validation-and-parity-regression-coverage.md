---
plan_id: refactor-agnostic
title: add non-pi validation and parity regression coverage
status: idle
updated: 2026-04-14T00:00:00Z
---

Prove the extracted core works without pi runtime imports, then finish the regression sweep by moving the remaining behavioral assertions into focused module tests.

## Steps
- [ ] Add one non-pi validation path that imports only `core/*` and exercises selection, refresh, caching, and quota handling with fake storage, fake token refresh, and fake usage fetch collaborators.
- [ ] Keep the validation lightweight: a Vitest suite or small smoke harness is enough as long as it proves the core can be used without `@mariozechner/pi-coding-agent`.
- [ ] Split the remaining assertions from `index.test.ts` into module-focused tests so root coverage can shrink to a compatibility smoke test.
- [ ] Preserve the parity contract in tests for: manual account precedence, usage parsing, untouched detection, cached usage refresh, token refresh threshold, per-account refresh deduplication, quota-before-output rotation (max 5 retries), quota-after-output non-retry behavior, `excludeEmails` honored during retries, selected account header injection, warn/skip when `openai-codex-responses` unavailable, session hook behavior on startup/new session, command wiring exposure, and root compatibility export smoke.
- [ ] Add or update README notes only as needed to explain the internal core/adapter split while keeping the public pi command surface unchanged.
- [ ] Run the full validation matrix at the end of the rollout: `npm run lint`, `npm run tsgo`, and `npm run test`.

## Success Criteria
- [ ] At least one validation path imports the extracted core without pi runtime packages.
- [ ] The regression suite covers the full behavior parity contract from the spec.
- [ ] The root compatibility tests are reduced to a small smoke layer that proves the legacy exports and entrypoint still work.
- [ ] The repository documentation still describes the same user-visible commands and behavior.
- [ ] All checks pass.
