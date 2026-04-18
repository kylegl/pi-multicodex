# MultiCodex Extension

![MultiCodex](./assets/multicodex.png)

MultiCodex is a **pi** extension that lets you use **multiple ChatGPT Codex OAuth accounts** with the built-in **`openai-codex-responses`** API.

It helps you **maximize usable Codex quota** across accounts:

- **Automatic rotation on quota/rate-limit errors** (e.g. 429, usage limit).
- **Prefers untouched accounts** (0% used in both windows) so fresh quota windows don’t sit unused.
- Otherwise, **prefers the account whose weekly window resets soonest**.

## Install (recommended)

```bash
pi install npm:pi-multicodex
```

After installing, restart `pi`.

## Install (local dev)

From this directory:

```bash
pi -e ./index.ts
```

## Quick start

1. Add at least one account:

   ```
   /multicodex-login your@email.com
   ```

2. Use Codex normally. When a quota window is hit, MultiCodex will rotate to another available account automatically.

## Commands

- `/multicodex-login <email>`
  - Adds/updates an account in the rotation pool.
- `/multicodex-remove [email]`
  - Removes an account from the rotation pool (prompts if email is omitted).
- `/multicodex-use`
  - Manually pick an account for the current session (until rotation clears it).
- `/multicodex-status`
  - Shows accounts + cached usage info + which one is currently active.

## Internal structure note

The package is now split into a platform-agnostic core under `core/` and a pi-specific adapter under `adapter/pi/`.
This is an internal refactor only: the pi install flow and the documented `/multicodex-login`, `/multicodex-use`, and `/multicodex-status` command surface are unchanged.

## How account selection works (high level)

When pi starts / when a new session starts, the extension:

1. Loads your saved accounts.
2. Fetches usage info for each account (cached for a few minutes).
3. Picks an account using these heuristics:
   - Prefer accounts that are **untouched** (0% used in both windows).
   - Otherwise prefer the account whose **weekly** quota window **resets soonest** (5h window is ignored for selection).
   - Otherwise pick a random available account.

When streaming and a quota/rate-limit error happens **before any tokens are generated**, it:

- Marks the account as exhausted until its reset (or a fallback cooldown)
- Rotates to another account and retries

## Public API

When used as a pi extension, only the default export is required:

- `default` — registers the MultiCodex provider, commands, and session hooks.

For tests and advanced integrations, these named exports are considered public:

- `AccountManager`
- `buildMulticodexProviderConfig`
- `getOpenAICodexMirror`
- `pickBestAccount`
- `createStreamWrapper`
- `isQuotaErrorMessage`
- `parseCodexUsageResponse`
- `isUsageUntouched`
- `getNextResetAt`
- `getWeeklyResetAt`
- Types: `Account`, `StorageData`, `CodexUsageSnapshot`, `ProviderModelDef`

Everything else under `core/` and `adapter/pi/` should be treated as internal implementation detail.

## Checks

```bash
npm run lint
npm run tsgo
npm run test
```
