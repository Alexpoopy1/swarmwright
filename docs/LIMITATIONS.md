# Limitations & Scope Decisions

This file documents where Swarmwright deliberately deviates from the original 35-section master brief, and the strongest-practical-version choices made. Nothing here is hidden — every item also appears in code comments where relevant.

## Structural

1. **Single modular Next.js app instead of a Turbo monorepo.** The brief *suggested* a monorepo and permitted adjustments "if a better architecture is justified". One install, one test command, one Docker image wins for an early open-source project. Module boundaries under `src/server/` are drawn for later extraction (ROADMAP).
2. **Prisma + SQLite by default** instead of Postgres-first. Zero-config local dev; the schema is Postgres-portable (JSON is stored as serialized strings; switching is a datasource-provider change — DEPLOYMENT.md).
3. **In-process durable engine instead of BullMQ/Redis/Temporal.** Run state, events, approvals and checkpoints are DB-persisted; runs survive browser refresh (SSE replay with `afterSeq`) and are resumed best-effort after server restart (`instrumentation.ts`). A BullMQ adapter is the top roadmap item. Consequence: single-node only; horizontal scaling needs the adapter.

## Providers & auth

4. **API-key connections only.** The brief asked for OAuth "for providers that support it" — most LLM providers are key-based; OAuth flows (GitHub Models etc.) are on the roadmap. No unsupported/scraped auth is used anywhere, per the brief's own rule.
5. **Two adapter implementations ship**: Mock (offline, complete) and OpenAI-compatible (covers OpenAI, OpenRouter, Groq, DeepSeek, Ollama, Together, vLLM…). Anthropic-native is roadmap; today it works via OpenAI-compatible gateways.
6. **Credentials auth** (email+password, bcrypt, DB sessions) instead of Auth.js/Clerk — fewer moving parts, no external dependency. SSO/OAuth-login is roadmap.

## Tools & sandbox

7. **Child-process sandbox** (memory cap, timeout, env scrub, network deny, temp-dir isolation) instead of Docker-in-Docker or microVMs by default. Stronger isolation plugs into `SandboxAdapter`. The Docker image runs the same sandbox inside the container.
8. **JavaScript tools execute**; Python tools are representable in the registry but execution is roadmap (needs a Python runner behind the same adapter).

## Features

9. **Project export is a JSON bundle**, not zip (zero-dependency); zip import/export is near-term roadmap.
10. **Particle orbs are canvas-2D** (GPU-efficient, reduced-motion aware, pausable). The brief's WebGL/R3F option is roadmap; canvas fully implements the specified state behaviors (idle/generating/pulse/fragment/reassemble/collapse).
11. **Memory retrieval is keyword/relevance-based**, not vector-semantic (pluggable embedders roadmap). Scope boundaries, expiration, deletion, export and inspection are implemented.
12. **Image attachments in chat** are not in 0.1 (vision flags exist in the model metadata and router).
13. **Playwright e2e** is roadmap; 0.1 ships unit + integration + orchestration suites (Vitest) that run in CI.

## Testing & CI

14. Tests use ephemeral SQLite databases and the Mock provider — no live API keys required in CI.
15. GitHub Actions runs tests, typecheck, lint and a production build on every PR.

## Honest status

The completion criteria from the brief are tracked in `docs/RELEASE-CHECKLIST.md` (generated with the final test/build report). Anything not verifiably working is listed there, not claimed.
