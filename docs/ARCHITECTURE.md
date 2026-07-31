# Architecture

Swarmwright is a single, modular Next.js application. Every server capability lives in a small, single-responsibility module under `src/server/` with contracts defined in `src/types/index.ts` and enforced by `SPEC.md`.

> **Why not a monorepo?** The original brief suggested a Turbo monorepo. For an open-source project at this stage we deliberately chose one deployable app with hard module boundaries: one `npm install`, one test command, one Docker image, no cross-package versioning friction. The module boundaries are drawn so packages can be extracted later (see ROADMAP). See LIMITATIONS.md.

## Module map

| Module | Path | Responsibility |
|---|---|---|
| Types | `src/types` | Shared contracts: events, provider adapter, plan schema, agent action protocol, tool SDK, DTOs. Frozen. |
| Auth | `src/server/auth` | Credentials signup/signin, DB sessions, httpOnly cookie, `requireUser`. |
| Events | `src/server/events` | Append-only event store (event sourcing) + in-process pub/sub bus for SSE. |
| Providers | `src/server/providers` | Normalized adapter interface, Mock provider, OpenAI-compatible adapter, registry, pricing. |
| Router | `src/server/router` | Deterministic model scoring/selection per task profile. |
| Usage | `src/server/usage` | Metering, cost estimation, budget checks, summary aggregation. |
| Orchestrator | `src/server/orchestrator` | Planner, task graph, agent runtime, recruitment, genomes, checkpoints, messages, engine. |
| Memory | `src/server/memory` | Scoped memories (conversation/agent/run/project/longterm/tool_perf), keyword retrieval, summarization. |
| Tools | `src/server/tools` | Tool spec validation, risk classification, child-process sandbox, factory pipeline. |
| Projects | `src/server/projects` | Projects, versioned files, path safety, export bundles. |
| Chat | `src/server/chat` | Conversations, streaming replies, council mode, branching. |

## The agent loop

1. **Plan** — `generatePlan` routes to the best available planning model, demands a single JSON document, and validates it with `planContentSchema` (one repair attempt on invalid output). Plans are stored, editable, and can require approval before execution.
2. **Schedule** — a `TaskGraph` (pure, unit-tested DAG) yields ready tasks. The engine creates agents for them: role → `matchGenome` (best historical configuration) → `routeModel` (deterministic scoring over connected providers). Caps: `maxAgents`, `maxConcurrentAgents`.
3. **Act** — each agent step builds a *scoped* context (never the whole project), asks the model for **one** structured `AgentAction` (zod-validated), and applies effects: file writes (versioned), tool calls (sandboxed, permission-gated), tool proposals (factory pipeline), messages (structured, routed), recruit requests (policy-checked), completion/failure (retries with backoff).
4. **Record** — every effect emits an event (`AGENT_STARTED`, `FILE_UPDATED`, `TOOL_COMPLETED`, …) into the append-only store. Budget checks run before every model call. Checkpoints snapshot resumable state every 15 events and on pause.
5. **Learn** — on completion/failure, `recordRunOutcome` updates the agent's genome (EMA on success rate, latency, cost; failure patterns; best categories).

## Event sourcing & the Time Machine

State is a fold over the event log (`reconstructRunState`). The UI never needs special snapshot endpoints: scrubbing the Time Machine = folding a prefix of the log. Forking = copying the folded state at a checkpoint into a new run (`branchOfId`), optionally with instruction/model overrides. This gives us resume-after-refresh for free (clients replay with `afterSeq`) and best-effort resume-after-restart (`instrumentation.ts` → `resumeInterruptedRuns`).

## Provider layer

`ProviderAdapter` normalizes: `listModels`, `testConnection`, `complete`, `stream`. The **Mock provider** is a first-class adapter that deterministically produces schema-valid plans and agent actions offline — it exists so the entire platform is explorable and testable without keys, and it powers the test suite. The **OpenAI-compatible adapter** covers OpenAI, OpenRouter, Groq, DeepSeek, Ollama and self-hosted endpoints via `baseUrl`. Errors normalize to `ProviderError(code, retryable)` so the router/engine can fall back cleanly.

API keys: AES-256-GCM encrypted at rest, decrypted lazily server-side, masked in UI, never logged, never returned to the client.

## Sandbox

`SandboxAdapter` runs tool code in a **separate Node child process** with: memory cap (`--max-old-space-size`), hard timeout (SIGKILL), scrubbed environment (`PATH` only), network stubbing when denied, temp-dir isolation with cleanup, and a stdout sentinel protocol for results + captured logs. High-risk permission classes always route through human approval. Remote sandbox providers (gVisor/Firecracker/Fly machines) can be added behind the same interface.

## Data model

29 models (see `prisma/schema.prisma`): identity (User/Session/Workspace), connections (ProviderConnection/ModelCost), work (Project/FileEntry/FileVersion), chat (Conversation/Message), orchestration (Plan/AgentRun/Agent/Task/AgentGenome), tools (ToolDefinition/ToolExecution/Approval), history (Event/Checkpoint/AuditLog), knowledge (MemoryItem/Artifact/UsageRecord). JSON payloads are stored as serialized strings so the schema stays portable between SQLite and PostgreSQL.

## Scaling path

The in-process engine is durable (DB-backed state, checkpoints, abort controllers) and correct for single-node deployments. The engine's seams — queue handoff, lock acquisition, event fanout — map 1:1 onto BullMQ/Redis; `docs/ROADMAP.md` describes the distributed adapter.
