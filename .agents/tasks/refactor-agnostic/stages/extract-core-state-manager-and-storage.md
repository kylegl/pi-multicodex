---
plan_id: refactor-agnostic
title: extract core state manager and storage
status: idle
updated: 2026-04-14T00:00:00Z
---

Move persistence, usage refresh, token refresh, cooldown bookkeeping, and account activation into `multicodex-core` behind injected collaborators.

## Steps
- [ ] Create `core/storage.ts` and define the platform-agnostic persistence contract: load/save adapter, canonical storage schema, and migration helpers for the legacy unversioned `{ accounts, activeEmail? }` file.
- [ ] Create `core/usage-client.ts` and move `fetchCodexUsage` into an injectable client that accepts the access token, optional account id, and abort signal while preserving timeout and retry semantics.
- [ ] Create `core/account-manager.ts` and move the stateful account manager behavior there: load/save, active/manual resolution, usage cache, usage refresh, selection activation, token validity, token refresh with per-account deduplication, and quota exhaustion handling.
- [ ] Keep the manager API compatible with the current adapter needs: `getAccounts`, `getAccount`, `getActiveAccount`, `getManualAccount`, `hasManualAccount`, `getAvailableManualAccount`, `setActiveAccount`, `setManualAccount`, `clearManualAccount`, `addOrUpdateAccount`, `getCachedUsage`, `refreshUsageForAccount`, `refreshUsageForAllAccounts`, `refreshUsageIfStale`, `activateBestAccount`, `ensureValidToken`, and `handleQuotaExceeded`.
- [ ] Inject the storage adapter, token refresher, usage client, clock, random source, and warning callback instead of hard-coding filesystem or pi APIs inside the manager.
- [ ] Preserve the current usage cache TTL, retry policy, token freshness threshold, and quota cooldown fallback exactly unless tests/docs explicitly change them.
- [ ] Clarify retry/backoff ownership: `usage-client` handles single-attempt fetch with timeout, while `account-manager` orchestrates bounded retries with backoff and cached fallback.
- [ ] Add migration tests that load the current legacy storage file, normalize it to the canonical schema, and verify the written-back result is idempotent.
- [ ] Add deterministic tests for cache hits, bounded retry/backoff, abort-like failures returning cached data, expired-token refresh, per-account refresh deduplication, and quota cooldown marking.
- [ ] Keep manual account selection session-local; do not persist manual overrides as part of storage migration.

## Success Criteria
- [ ] The core manager no longer imports node filesystem modules or pi runtime APIs directly.
- [ ] Legacy storage loads successfully and saves back in the canonical versioned shape without losing valid account records.
- [ ] The cache TTL, retry backoff, token refresh threshold, and cooldown behavior all match the current behavior contract.
- [ ] The new core tests cover migration, refresh, cache, and cooldown behavior with injected fakes.
