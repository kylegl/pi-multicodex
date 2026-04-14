# Restructure scope and target architecture

## Why this task exists
Current implementation is tightly coupled to pi extension APIs and `openai-codex-responses` provider wiring. We need a platform-agnostic core so multicodex can power other consumers (Mnemos, standalone CLIs/services, MCP gateways).

## Target end state

### A) `multicodex-core` (platform-agnostic library)
Responsibilities:
- account/state model
- state persistence interface + JSON file adapter
- active account resolution
- account rotation/selection policy
- token validity/refresh orchestration
- quota exhaustion and cooldown logic
- usage snapshot cache + refresh policy

Constraints:
- no pi extension imports
- no UI concerns
- no direct command registration

### B) `multicodex-pi-adapter` (pi extension layer)
Responsibilities:
- pi command wiring (`/multicodex-login`, `/multicodex-switch`, etc.)
- pi provider registration and stream integration
- UI prompts/notifications
- translate pi-specific events into core operations

### C) Optional `multicodex-gateway` (service layer)
Responsibilities:
- exposes OpenAI-compatible chat endpoint for non-pi consumers
- uses `multicodex-core` for account/token/rotation
- can be used by Mnemos via `MNEMOS_OPENAI_URL=http://127.0.0.1:<port>/v1`

## Suggested migration phases

1. **Extract domain types + storage interface**
2. **Extract account manager + rotation policy into core**
3. **Extract usage fetch + refresh orchestration**
4. **Refit existing pi extension to consume core**
5. **Add gateway prototype and integration tests**

## Definition of done
- pi extension behavior remains functionally equivalent
- core package has unit tests independent of pi runtime
- at least one non-pi consumer (gateway or CLI) runs against the same core
- minimal migration notes added to README
