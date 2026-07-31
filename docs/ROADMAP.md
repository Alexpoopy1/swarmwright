# Roadmap

## Near term (0.2)
- **Distributed engine adapter** — BullMQ + Redis behind the orchestrator seams (run queue, per-run locks, event fanout), enabling multi-process and multi-node workers.
- **Zip project export/import** and Git repository import (clone → file tree).
- **Playwright e2e suite** — sign-up → connect mock → demo run → Time Machine fork.
- **Anthropic-native adapter** (Messages API) and native streaming tool-calling.
- **WebGL orb renderer** (React Three Fiber) behind the existing effects toggle, canvas-2D remains the fallback.

## Mid term (0.3–0.4)
- **OAuth provider connections** (PKCE, token rotation, encrypted refresh tokens) where providers officially support it.
- **Remote sandbox providers** — Firecracker microVMs / Fly Machines / gVisor behind `SandboxAdapter`.
- **MCP interoperability** — expose registered tools as MCP tools; consume external MCP servers.
- **Semantic memory retrieval** — optional embedding index per scope with pluggable embedders.
- **Multi-user workspaces** — roles, shared runs, approval delegation.
- **Rate limiting + audit export** for team deployments.

## Longer term
- **Monorepo extraction** — `packages/orchestrator`, `packages/provider-adapters`, `packages/tool-sdk` once the module boundaries prove stable (they were drawn for this).
- **Genome marketplace** — share/import tuned agent genomes across installations.
- **Run branching UI v2** — visual branch tree, three-way compare, merge results.
- **Mobile-responsive inspector** for monitoring runs on the go.

## Won't do (by design)
- Scraping private browser sessions or imitating unsupported OAuth flows.
- Silent model retraining (genome learning is transparent configuration optimization only).
- Executing agent code in the main process.
