---
plan_id: refactor-agnostic
title: extract pure helpers and shared types
status: idle
updated: 2026-04-14T00:00:00Z
---

Extract the quota, usage, retry, and account-selection helpers into platform-agnostic modules with no pi runtime imports.

## Steps
- [ ] Create `core/types.ts` and move the shared data model there: `Account`, `StorageData`, and the canonical persisted account fields used by selection and persistence.
- [ ] Create `core/errors.ts` and move `isQuotaErrorMessage`, `getErrorMessage`, `isAbortLikeError`, `getUsageHttpStatus`, and `isRetryableUsageError` into it.
- [ ] Create `core/retry.ts` and move `sleepWithSignal` into it unchanged in behavior.
- [ ] Create `core/usage.ts` and move `CodexUsageSnapshot`, `normalizeUsedPercent`, `normalizeResetAt`, `parseUsageWindow`, `parseCodexUsageResponse`, `isUsageUntouched`, `getNextResetAt`, and `getWeeklyResetAt` into it.
- [ ] Create `core/selection.ts` and move `isAccountAvailable`, `pickRandomAccount`, `pickEarliestWeeklyResetAccount`, and `pickBestAccount` into it.
- [ ] Create `core/index.ts` as a barrel that re-exports the current root-stable helper surface from the new core modules.
- [ ] Keep `formatResetAt` out of core; it belongs in the pi adapter because it is presentation logic, not domain logic.
- [ ] Split the current helper assertions out of `index.test.ts` into focused core tests that import only `core/*` modules.
- [ ] Update the root `index.ts` to re-export the moved helper names through the new barrel without changing behavior.

## Success Criteria
- [ ] `core/*` modules can be imported without `@mariozechner/pi-ai` or `@mariozechner/pi-coding-agent`.
- [ ] Unit coverage exists for quota classification, usage parsing/reset conversion, untouched-usage detection, and selection heuristics.
- [ ] The root compatibility surface still exports `isQuotaErrorMessage`, `parseCodexUsageResponse`, `isUsageUntouched`, `getNextResetAt`, `getWeeklyResetAt`, and `pickBestAccount`.
- [ ] No observable behavior changes for selection, parsing, or retry classification.
