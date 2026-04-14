# Progress: refactor-agnostic

## Status checklist
- [x] Task scaffold created under `.agents/tasks/refactor-agnostic`
- [x] Restructure scope + architecture captured
- [x] Draft concrete module/file move plan against current `index.ts`
- [x] Reviewer feedback applied to align plan with spec
- [x] Implement `multicodex-core` extraction (first pass)
- [x] Rewire existing pi extension to use core
- [x] Add regression tests for parity
- [x] Add non-pi validation path via core-only tests
- [ ] (Optional) Add gateway prototype for Mnemos integration

## Current notes
- The refactor landed as a logical split inside the existing package: `core/` owns domain/state logic and `adapter/pi/` owns pi runtime wiring.
- Root `index.ts` remains the compatibility barrel + default export shim.
- Validation currently passes with `npm run lint`, `npm run tsgo`, and `npm run test`.

## Next step
Optional follow-up only: tighten a few parity-focused tests if we want stronger regression locking around exact warning emission and exact retry/cache timing constants.

## Review
- What's correct
  - The implementation follows the intended architecture: `core/` contains selection, usage parsing, retry helpers, storage migration, usage fetching, and `AccountManager`; `adapter/pi/` contains OAuth/browser integration, provider wiring, stream translation/rotation, commands, hooks, status formatting, and pi-owned filesystem path handling.
  - Behavior parity is largely preserved in code and tests: manual override wins, exhausted accounts are excluded, `excludeEmails` is honored, usage parsing normalizes `reset_at` to ms, usage caching and bounded retry live in the core manager, token refresh uses a 5-minute threshold plus per-account dedupe, quota-before-output rotates while quota-after-output is surfaced, provider metadata is mirrored/re-written, and the root compatibility exports still resolve.
  - The module split matches the extraction map closely, with `adapter/pi/storage.ts` added as the pi-owned path adapter while keeping the core path-agnostic.
  - A non-pi validation path exists through the core Vitest suites (`core/*.test.ts`) with injected fakes and no pi runtime imports in the core tree.
- Fixed: Issue and resolution
  - Added the missing README migration note that explains the internal `core/` + `adapter/pi/` split while explicitly confirming that the pi install flow and documented commands are unchanged.
  - Updated this progress file to reflect that the implementation, adapter rewiring, non-pi validation path, and parity test sweep have been completed.
- Note: Observations
  - All required checks passed during review: `npm run lint`, `npm run tsgo`, and `npm run test`.
  - Remaining gaps are minor and mostly about test precision rather than implementation correctness: there is no direct assertion that startup warning emission happens from the extension entrypoint when `openai-codex-responses` is unavailable, and the tests do not lock the exact `300ms/900ms` backoff or 5-minute cache TTL values even though the code currently matches the spec.
