# Changelog

All notable changes to Swarmwright are documented here. Format based on [Keep a Changelog](https://keepachangelog.com).

## [0.1.0] — 2026-07-31

Initial open-source release.

### Added
- **Chat Mode** — streaming multi-provider chat, markdown + syntax highlighting, per-message token/cost metadata, regenerate, edit-and-resend (branching), model picker, Council Mode, conversation search/archive/export.
- **Agentic Mode** — goal → structured plan (editable, approvable; plan_only / plan_approve / auto modes) → dynamic agent swarm with task DAG, parallel execution, retries with backoff, loop detection, failure recovery.
- **Agent Genome system** — transparent performance learning over agent configurations; inspect, clone, compare, lock, reset, export/import, disable learning.
- **Swarm Time Machine** — event-sourced run history; scrub, replay, inspect state at any event, fork from checkpoints with instruction/model overrides, branch comparison.
- **Agent Tool Factory** — agents propose tools (schema + implementation + tests), sandboxed test runs, risk classification, approval gates, reusable per-project registry.
- **Provider layer** — normalized adapter interface; Mock provider (full offline demo + testability) and OpenAI-compatible adapter (OpenAI, OpenRouter, Groq, DeepSeek, Ollama, self-hosted); AES-256-GCM encrypted key storage; deterministic model router with manual override.
- **Live swarm visualization** — force-directed graph of coordinator/agents/tasks/messages with canvas particle orbs reflecting real agent state; thinking bubbles (user-safe summaries); reduced-motion + effects-off support.
- **Safety** — autonomy dial (observe → ask_all → ask_risky → auto), durable approvals, budget/token/time/agent limits enforced before model calls, child-process sandbox (timeout, memory cap, network deny, env scrubbing).
- **Workspace** — projects with versioned files, conversations, runs, artifacts, memories, usage/cost dashboard, audit log.
- **Ops** — SQLite default (PostgreSQL-ready), Dockerfile + compose, GitHub Actions CI, Vitest suite, full docs.
