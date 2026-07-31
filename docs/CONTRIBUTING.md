# Contributing to Swarmwright

Thanks for your interest! This project welcomes contributors of all experience levels.

## Ground rules (from the project's engineering rules)

1. No fake buttons — every control wires to a real API.
2. No placeholder workflows presented as complete.
3. No secrets to the browser; no keys in logs.
4. No private chain-of-thought in the UI — user-safe activity summaries only.
5. No untrusted code in the main process — sandbox everything.
6. No silent budget overruns; no destructive actions without approval.
7. Strict TypeScript — `npx tsc --noEmit` must stay clean.
8. All model-generated structured output is zod-validated.
9. Tests actually run in CI — don't claim otherwise.

## Setup

```bash
npm install && cp .env.example .env && npx prisma db push && npm run dev
npm test        # vitest suite
npm run lint
```

## Where to start

- Issues labeled **good first issue** — small, well-scoped.
- **Provider adapters** — see `docs/PROVIDERS.md` and `src/server/providers/mock.ts` for a complete reference implementation.
- **Tool examples** — new bundled tool templates in the registry.
- **Docs & screenshots** — always appreciated.

## Architecture orientation

Read `SPEC.md` (binding contracts) and `docs/ARCHITECTURE.md` first. Shared contracts live in `src/types/index.ts` — changes there require maintainer discussion (open an issue first).

## Pull requests

- One concern per PR. Fill the template.
- New behavior ⇒ new tests. Run `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build` before submitting.
- Keep the design system (dark, calm, copper accent, no gradients) and accessibility requirements (keyboard, focus rings, non-color status indicators, reduced motion).

## Commit style

Conventional-ish, human-readable: `orchestrator: add loop-detection recovery`, `providers: add mistral adapter`, `ui: fix kanban focus order`.

## Security reports

Privately, via the contact in the README — never as public issues. See `docs/SECURITY.md`.
