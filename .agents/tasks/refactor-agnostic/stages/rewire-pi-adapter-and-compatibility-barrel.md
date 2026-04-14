---
plan_id: refactor-agnostic
title: rewire pi adapter and compatibility barrel
status: idle
updated: 2026-04-14T00:00:00Z
---

Move pi-specific wiring out of the monolith so the adapter becomes a thin integration layer over the new core modules.

## Steps
- [ ] Create `adapter/pi/storage.ts` to own the default `~/.pi/agent/multicodex.json` path and implement the core storage interface using `node:fs`, `node:path`, and `node:os`.
- [ ] Create `adapter/pi/oauth.ts` and move `resolveCodexOAuthFns`, `loginOpenAICodexCompat`, and `refreshOpenAICodexTokenCompat` there.
- [ ] Create `adapter/pi/browser.ts` and move `openLoginInBrowser` there, keeping browser-open failures as warnings.
- [ ] Create `adapter/pi/stream-utils.ts` and move `createErrorAssistantMessage`, `withProvider`, `createLinkedAbortController`, and `createTimeoutController` there.
- [ ] Create `adapter/pi/status.ts` and move `formatResetAt` there.
- [ ] Create `adapter/pi/provider.ts` and move `getOpenAICodexMirror` plus `buildMulticodexProviderConfig` there.
- [ ] Create `adapter/pi/stream-wrapper.ts` and move `createStreamWrapper` there, preserving header injection, provider-id rewriting, quota-before-output rotation, and the bounded retry loop with max 5 rotation retries.
- [ ] Create `adapter/pi/commands.ts` and move the `/multicodex-login`, `/multicodex-use`, and `/multicodex-status` handlers there without changing the user-visible strings or menu flow.
- [ ] Create `adapter/pi/hooks.ts` and move the `session_start` and `session_switch` orchestration there.
- [ ] Create `adapter/pi/index.ts` as the default extension entrypoint that wires the core manager, pi storage adapter, provider registration, commands, hooks, and warning routing together.
- [ ] Update the root `index.ts` to act as a compatibility barrel and default-export shim that preserves the existing public names, including `Account`, `AccountManager`, `CodexUsageSnapshot`, `ProviderModelDef`, `buildMulticodexProviderConfig`, `createStreamWrapper`, `getNextResetAt`, `getOpenAICodexMirror`, `getWeeklyResetAt`, `isQuotaErrorMessage`, `isUsageUntouched`, `parseCodexUsageResponse`, `pickBestAccount`, and the default pi extension function.
- [ ] Keep provider registration defensive: if `openai-codex-responses` is unavailable, warn and skip registration rather than crashing startup.
- [ ] Move the adapter-focused assertions out of `index.test.ts` into dedicated pi-adapter tests for: provider mirroring, manual selection, stream rotation (with max-5 bound), event translation, `excludeEmails` honored during retries, selected account header injection, warn/skip when `openai-codex-responses` unavailable, session hook behavior on startup/new session, command wiring exposure, and root compatibility export smoke.

## Success Criteria
- [ ] The pi adapter owns all pi-specific API usage and the core tree remains pi-free.
- [ ] The documented command surface and current output strings remain unchanged.
- [ ] The provider still mirrors `openai-codex` metadata, stream events still come back with the caller-facing provider id, and the stream rotation bound is max 5 retries matching current behavior.
- [ ] Root imports used by the current tests still resolve through the compatibility barrel.
