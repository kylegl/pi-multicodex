# Task Spec: refactor-agnostic

## Objectives

- Extract a **platform-agnostic multicodex-core** from the current monolithic `index.ts` so account state, selection, rotation policy, usage caching, and token refresh logic can be reused outside the pi extension runtime.
- Keep the **pi adapter** thin: it should own commands, provider registration, UI prompts/notifications, browser-launch behavior, and stream/event translation.
- Preserve current user-visible behavior and docs for the existing pi extension surface while enabling future non-pi consumers such as Mnemos bridges/gateways.
- Create stable seams by **behavior**, not by arbitrary file size.

## Non-goals

- No change to the core Codex selection policy unless explicitly called out in tests and docs.
- No redesign of the existing pi command UX in this task.
- No gateway/server implementation in this task beyond interfaces or stubs that prove the core can be reused.
- No migration to a new protocol or API surface for ChatGPT/Codex requests.
- No broad package/workspace restructuring unless required to keep the core importable; the first pass should prefer module boundaries over repo re-layout.
- In this first pass, `multicodex-core` and `multicodex-pi-adapter` refer to logical module boundaries inside the existing package unless a stronger packaging split is required by tests or distribution constraints.

## Current-state analysis

### Current repo state

- The current repo root is effectively a **single entrypoint**: `index.ts` contains the whole behavior surface.
- `index.test.ts` currently locks in the observed behavior for:
  - quota error classification
  - provider mirroring
  - usage response parsing
  - selection heuristics
  - manual account preference in streaming
  - quota-triggered rotation before any output
- The current README exposes a very small public surface:
  - `/multicodex-login`
  - `/multicodex-use`
  - `/multicodex-status`
  - local dev install via `pi -e ./index.ts`
- For this task, `/multicodex-use` is the canonical existing manual-switch command. Any rename such as `/multicodex-switch` is out of scope unless README, tests, and compatibility behavior are updated together.
- The monolith couples together:
  - filesystem persistence
  - token refresh
  - usage fetching
  - selection policy
  - provider registration
  - stream retry/rotation
  - browser login launch
  - error message formatting

### Reference implementation signal

The reference source under `.agents/sources/pi-multicodex/` already demonstrates a useful seam split:

- `storage.ts`
- `selection.ts`
- `usage.ts`
- `account-manager.ts`
- `stream-wrapper.ts`
- `provider.ts`
- `commands.ts`
- `hooks.ts`
- `status.ts`
- `auth.ts`
- `usage-client.ts`
- `refresh-race.test.ts`

That reference is **useful for boundaries**, but not all of its policy should be copied blindly:

- the source has a richer command/status surface than the current README
- the source has a lower-usage tie-breaker that is not currently part of the repo-root behavior contract
- the source introduces pi-auth/imported-auth behaviors that are adapter-specific and should not leak into the platform-agnostic core

### Current extraction problem

The current `index.ts` mixes three layers that should be separated:

1. **pure domain logic**
2. **storage / refresh orchestration**
3. **pi runtime integration**

This makes it hard to reuse the account-selection and rotation logic in any non-pi context.

## Behavior parity contract

This refactor must preserve the following behaviors unless a test and doc update explicitly changes them.

### 1) Account selection

- Manual account override wins when available.
- Auto-selection excludes exhausted accounts.
- Selection prefers accounts with **untouched** usage (`0%` in both windows) when available.
- If no untouched account is available, selection should prefer the account with the earliest eligible weekly reset among the usable set.
- If usage is unavailable for all candidates, fall back to a random available account.
- Selection must honor an explicit `excludeEmails` set during retries.

### 2) Usage parsing and refresh

- Parse the `wham/usage` payload into a normalized snapshot with primary/secondary windows.
- Convert `reset_at` seconds to millisecond timestamps.
- Cache usage snapshots for **5 minutes** by default.
- Retry transient usage fetch failures with bounded backoff.
- Preserve the current retry policy: 2 retries, backoff roughly `300ms` then `900ms`.
- Abort-like failures should not poison the cache path and should be treated as cancellations, not hard failures.

### 3) Token refresh

- Tokens are considered valid if they have at least 5 minutes of remaining life.
- Expired tokens must be refreshed before use.
- Successful refresh persists updated credentials back to managed storage.
- Per-account refresh deduplication is a valid improvement for this task, but it is not part of the current monolith's proven behavior contract. If added, it must be treated as an intentional enhancement with dedicated tests.

### 4) Quota/error rotation

- A quota/rate-limit error before any streamed output should trigger account cooldown + rotation + retry.
- Once any output has been forwarded, the stream must not silently rotate; it should forward the error and end.
- The retry loop should remain bounded; do not create unbounded account cycling.
- On quota hit, the failed account must be marked exhausted until its next reset time, or a fallback cooldown if no reset is known.

### 5) Provider/adapter behavior

- The provider must still mirror the underlying `openai-codex` model metadata.
- The stream wrapper must still inject the selected account identifier into request headers.
- The adapter must still rewrite provider metadata back to the caller-facing provider ID on events.
- If the pi provider is unavailable, startup should warn/skip registration rather than crash.

### 6) Public API compatibility

- Keep existing root exports working during the transition, especially those used by current tests and external consumers.
- If new core exports are introduced, the old names should remain available via a compatibility barrel until the migration is complete.

## Target architecture

### A) `multicodex-core`

The core boundary should be usable without pi extension runtime imports.

#### Owns

- account and storage models
- account CRUD and active/manual resolution
- selection policy and retry exclusion logic
- token validity/refresh orchestration
- usage snapshot cache and refresh policy
- quota exhaustion and cooldown bookkeeping
- state change notification hooks for adapters/UI
- storage migration normalization and schema validation

#### Must not own

- pi command registration
- pi UI notifications/prompts
- browser-launch logic
- provider mirroring / model registration
- assistant message event shaping
- any dependency on `@mariozechner/pi-coding-agent`

#### Dependency model

Core should accept injected collaborators rather than importing pi-specific APIs:

- `StorageAdapter` for load/save
- `TokenRefresher` for refresh-token exchange
- `UsageClient` for usage fetches
- `clock`/`random` overrides for deterministic testing
- optional `logger`/`warning` callbacks for non-fatal diagnostics

### B) `multicodex-pi-adapter`

The pi adapter boundary should be the only place that touches pi extension APIs.

#### Owns

- default extension export
- `/multicodex-login`, `/multicodex-use`, `/multicodex-status` command wiring
- provider registration for `openai-codex-responses`
- stream bridging and retry/rotation orchestration for pi requests
- UI prompts, selects, confirms, and notifications
- browser-open behavior for the OAuth login flow
- session hooks (`session_start`, `session_switch`, etc.)

#### Must not own

- account storage model rules
- selection policy decisions
- usage parsing logic
- token refresh policy
- quota bookkeeping policy

### C) Optional gateway layer

Not required for this task, but the core should be shaped so a future gateway can drive it with its own request protocol.

- gateway should reuse the same selection/refresh/storage core
- gateway should implement its own transport and streaming protocol
- gateway should not need any pi-specific code

## Module extraction map from current `index.ts`

> This is the concrete first-pass map for splitting the current monolith by behavior seam.

| Current region / functions | Target module | Notes |
| --- | --- | --- |
| `isQuotaErrorMessage`, `getErrorMessage`, `isAbortLikeError`, `getUsageHttpStatus`, `isRetryableUsageError`, `sleepWithSignal` | `core/errors.ts` and `core/retry.ts` | Keep retry classification pure and testable. |
| `resolveCodexOAuthFns`, `loginOpenAICodexCompat`, `refreshOpenAICodexTokenCompat`, `openLoginInBrowser` | `adapter/pi/oauth.ts` and `adapter/pi/browser.ts` | pi-specific OAuth/browser integration stays out of core. |
| `createErrorAssistantMessage`, `withProvider`, `createLinkedAbortController`, `createTimeoutController` | `adapter/pi/stream-utils.ts` | Event shaping and abort linking belong to the adapter. |
| `normalizeUsedPercent`, `normalizeResetAt`, `parseUsageWindow`, `parseCodexUsageResponse`, `isUsageUntouched`, `getNextResetAt`, `getWeeklyResetAt` | `core/usage.ts` | Keep usage normalization and reset selection pure and platform-agnostic. |
| `formatResetAt` | `adapter/pi/status.ts` (or adapter-local formatting module) | Human-readable status formatting is presentation logic and should stay out of core. |
| `fetchCodexUsage` | `core/usage-client.ts` or injected `UsageClient` implementation | Core should own the default logic, but the HTTP client must be injectable. |
| `Account`, `StorageData`, `isAccountAvailable`, `pickRandomAccount`, `pickEarliestWeeklyResetAccount`, `pickBestAccount` | `core/types.ts`, `core/selection.ts` | Selection is pure domain logic. |
| `AccountManager` (load/save, cache, refresh, cooldown, active/manual state, refresh dedupe, token refresh, quota handling) | `core/account-manager.ts` | This is the main reusable runtime abstraction. |
| `getOpenAICodexMirror`, `buildMulticodexProviderConfig` | `adapter/pi/provider.ts` | Mirror and provider registration are adapter-only. |
| `multicodexExtension` default export | `adapter/pi/index.ts` | Root entrypoint remains the pi extension. |
| `createStreamWrapper` | `adapter/pi/stream-wrapper.ts` | Keeps request rotation close to the provider bridge. |

### Recommended file layout

- `core/index.ts` — public core barrel
- `core/types.ts`
- `core/selection.ts`
- `core/usage.ts`
- `core/usage-client.ts`
- `core/storage.ts`
- `core/account-manager.ts`
- `core/errors.ts`
- `core/retry.ts`
- `adapter/pi/index.ts`
- `adapter/pi/provider.ts`
- `adapter/pi/stream-wrapper.ts`
- `adapter/pi/commands.ts`
- `adapter/pi/hooks.ts`
- `adapter/pi/status.ts`
- `adapter/pi/oauth.ts`
- `adapter/pi/browser.ts`
- `adapter/pi/stream-utils.ts`
- root `index.ts` as a compatibility barrel and default export shim during migration

## Public interfaces

### Root compatibility exports

The root `index.ts` compatibility barrel must continue to export the names that are exported today and used by the current tests:

- `Account`
- `AccountManager`
- `CodexUsageSnapshot`
- `ProviderModelDef`
- `buildMulticodexProviderConfig`
- `createStreamWrapper`
- `getNextResetAt`
- `getOpenAICodexMirror`
- `getWeeklyResetAt`
- `isQuotaErrorMessage`
- `isUsageUntouched`
- `parseCodexUsageResponse`
- `pickBestAccount`
- default export: the pi extension function

New core-only interfaces such as `StorageAdapter`, `UsageClient`, `TokenRefresher`, `StorageData`, or `createAccountManager` may be introduced, but they are not required to be root-stable in this task unless tests and docs are updated to make them public.

### Core behavior surface required for adapter parity

If `AccountManager` remains a class, it must support the methods the current adapter behavior depends on:

- `getAccounts()`
- `getAccount(email)`
- `getActiveAccount()`
- `getManualAccount()`
- `hasManualAccount()`
- `getAvailableManualAccount(options?)`
- `setActiveAccount(email)`
- `setManualAccount(email)`
- `clearManualAccount()`
- `addOrUpdateAccount(email, creds)`
- `getCachedUsage(email)`
- `refreshUsageForAccount(account, options?)`
- `refreshUsageForAllAccounts(options?)`
- `refreshUsageIfStale(accounts, options?)`
- `activateBestAccount(options?)`
- `ensureValidToken(account)`
- `handleQuotaExceeded(account, options?)`

Warning and diagnostics behavior may remain an injected callback or small logger surface rather than requiring a broader `onStateChange(...)` API in this task.

### Adapter exports

Keep the following adapter exports available for tests and compatibility:

- default export: the pi extension function
- `buildMulticodexProviderConfig`
- `createStreamWrapper`
- `getOpenAICodexMirror`
- `ProviderModelDef`

## Storage and migration strategy

### Canonical shape

The canonical storage shape should be versioned and stable:

- `version`
- `accounts[]`
- `activeEmail?`
- optional `$schema` metadata if the file format benefits from editor support

Account records should preserve:

- `email`
- `accessToken`
- `refreshToken`
- `expiresAt`
- `accountId?`
- `lastUsed?`
- `quotaExhaustedUntil?`
- `needsReauth?` if the core includes auth-failure tracking

### Migration behavior

- Treat storage migration as **additive and idempotent**.
- Required compatibility input for this task is the current monolith's file at `~/.pi/agent/multicodex.json` with the legacy unversioned shape `{ accounts, activeEmail? }`.
- The pi adapter owns the default file path; the core must receive storage through an injected adapter and must not hard-code the pi path.
- Support for additional legacy shapes from the reference implementation is optional unless this task adds explicit fixtures and regression tests for them.
- Corrupt-file salvage is optional scope; if implemented, the spec/tests must define exactly which fields are salvageable and what happens to malformed records.
- On successful load of a supported legacy file, write back the canonical versioned format.
- Do not persist adapter-only ephemeral state such as manual session overrides or other runtime-only session state.

### Path ownership

- The core must not hard-code a filesystem path.
- The pi adapter should supply the default path for pi installs.
- Non-pi consumers should be able to choose their own storage location while still using the same schema.

## Error and retry semantics

### Usage fetch

- Classify retryable usage fetch errors as:
  - abort-like errors
  - HTTP 429
  - HTTP 5xx
  - obvious network failures
- Retry with bounded backoff and then fall back to cached data if present.
- If a fetch is aborted, do not emit a hard warning unless the adapter explicitly wants to.
- If there is no cache and all retries fail, return `undefined` and let the adapter decide how to surface the warning.

### Token refresh

- Refresh only when the access token is close to expiry.
- Concurrent refreshes for the same account must reuse one in-flight promise.
- On refresh failure, surface a clear error and, if using `needsReauth`, mark the account accordingly.
- Refresh failures must not corrupt the persisted account record.

### Rotation during streaming

- The adapter should rotate only when the failure is a quota/rate-limit failure **before any output** is forwarded.
- Once the stream has emitted data, do not attempt a silent retry of the same request.
- Failed attempts must be excluded from subsequent retries for that request.
- Preserve abort semantics from the caller signal through to the provider stream.

### Operational warnings

- Non-fatal warnings should go through an injected logger/warning callback, not direct UI calls.
- The core should never assume a UI is present.

## Testing strategy

### Core tests

Add unit tests that are independent of pi runtime:

- quota error classification
- usage parsing and reset conversion
- untouched-usage detection
- selection heuristics
- exhausted-account exclusion
- account refresh caching behavior
- token refresh deduplication
- quota cooldown marking
- storage migration and salvage behavior

### Adapter tests

Keep or add tests for the pi boundary:

- provider config mirrors `openai-codex` metadata
- extension startup skips provider registration and warns when `openai-codex-responses` is unavailable
- stream wrapper forwards the selected account header
- manual account takes precedence over auto-selection
- quota-before-output triggers rotation
- quota-after-output does not retry silently
- command wiring still exposes the documented commands
- session hooks still refresh/activate accounts on startup/new sessions
- root compatibility barrel still exposes the current exported names used by `index.test.ts`

### Regression strategy

- Split the current `index.test.ts` into focused tests by module boundary.
- Preserve a small compatibility smoke suite at the root until the transition is complete.
- Use mocks for storage, token refresh, usage fetch, and base provider to keep tests deterministic.
- If adopting any source-implementation improvements such as `needsReauth` or refresh dedupe, add tests before wiring them into the adapter.

## Phased rollout plan

### Phase 1 — carve out pure helpers

- Move quota classification, usage parsing, selection helpers, and related types into core modules.
- Keep root exports as shims so nothing breaks.
- Add focused unit tests for the new pure modules.

### Phase 2 — extract core state manager

- Move account persistence, refresh orchestration, token refresh, cooldown handling, and usage caching into `multicodex-core`.
- Introduce storage and token-refresh injection points.
- Add migration tests for old storage files.
- Keep current external behavior unchanged.

### Phase 3 — rewire the pi adapter

- Replace direct monolith logic with core calls.
- Move commands, provider registration, hooks, and stream wrapper behavior into adapter modules.
- Preserve the documented command names and current user-visible output.
- Remove remaining core dependencies on pi runtime types.

### Phase 4 — non-pi validation

- Add at least one non-pi validation path that exercises the core without `@mariozechner/pi-coding-agent` imports.
- This validation may be a small test harness, CLI smoke script, or gateway spike.
- Shipping a productized gateway/service is optional; proving the core is reusable outside pi is required.

## Risks and open questions

- **Storage path canonicalization:** the current repo and the reference implementation use different storage file names/locations. The migration layer must choose one canonical path and keep backward-compatible reads from the other.
- **Selection heuristic divergence:** the reference implementation includes a lower-usage tie-breaker that is not part of the current repo behavior contract. Do not adopt it silently.
- **Auth-failure tracking:** the reference uses `needsReauth`. Decide whether this becomes part of the shared core state model or stays adapter-specific.
- **Manual override scope:** manual account selection should likely remain session-local and not be persisted; verify that no adapter expects persistence.
- **Core HTTP dependency:** decide whether `UsageClient` owns the `fetch` implementation or whether the adapter injects it for broader portability.
- **Gateway shape:** if a gateway follows, confirm whether it needs streaming event translation or only account/token selection.

## Definition of done

- The monolith has been split into a reusable core boundary and a pi-specific adapter boundary inside the existing package structure.
- Core logic no longer imports pi runtime APIs.
- Existing pi commands and provider behavior remain functionally equivalent to the current documented behavior in `README.md`, including `/multicodex-login`, `/multicodex-use`, and `/multicodex-status`.
- The bounded usage retry policy remains equivalent to the current code (`2` retries with approximately `300ms` then `900ms` backoff) unless tests/docs are updated together.
- The bounded stream-rotation policy remains equivalent to the current code (maximum `5` rotation retries) unless tests/docs are updated together.
- Legacy storage from the current monolith loads successfully and migrates to the canonical versioned schema without data loss for valid accounts.
- Retry/rotation, usage-cache behavior, and root compatibility exports are covered by regression tests.
- The repo includes one non-pi validation path that exercises the core without pi runtime imports.
- `README.md` includes minimal migration notes confirming the internal core/adapter split and that the existing pi install/command surface is unchanged.
- `npm run lint`, `npm run tsgo`, and `npm run test` all pass.
