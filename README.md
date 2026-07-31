<div align="center">

# ⬡ Swarmwright

**An open-source autonomous AI development workspace.**

Connect any model. Coordinate agent swarms. Ship software — with your hands on the controls.

`Next.js 15` · `React 19` · `TypeScript (strict)` · `Prisma` · `Tailwind` · `MIT License`

</div>

---

Swarmwright is a browser-based workspace where a single goal — *"Build a task manager with auth, tests, docs and Docker"* — becomes a **structured plan**, then a **swarm of specialized agents** that write files, build their own tools, run them in a sandbox, review each other's work, and report back. Every step is **event-sourced**, so you can scrub through the entire run in the **Swarm Time Machine**, fork it from any point, and learn which agent configurations actually work via the **Agent Genome** system.

It works **fully offline** out of the box via the built-in **Mock provider**, so you can explore every workflow before connecting a paid API key.

## Two modes

| Mode | What it does |
|---|---|
| **Chat Mode** | Multi-provider streaming chat with markdown, syntax highlighting, token/cost display, regenerate / edit-and-resend / branch, model comparison and **Council Mode** (several models answer independently, a synthesizer model delivers the strongest combined answer). |
| **Agentic Mode** | Goal → structured plan (editable, approvable) → dynamic agent roles → parallel task execution with dependency tracking → files, tools, tests, artifacts — with pause / resume / stop / retry / fork at any moment. |

## Flagship features

- **🧬 Agent Genome** — transparent, inspectable performance learning over agent *configurations* (role, model, prompt strategy, tools, temperature). After every run, genomes update their success rate, latency and cost. Clone, compare, lock, export, or disable learning entirely. No silent model retraining — ever.
- **⏳ Swarm Time Machine** — every run is an append-only event log. Scrub backward and forward, see which agents existed at any moment, watch cost accumulate, then **fork the run from any checkpoint** with new instructions or a different model and compare branches side by side.
- **🛠 Agent Tool Factory** — agents can identify a missing capability, propose a tool (schema + implementation + tests), run the tests in a sandbox, and register it for reuse. High-risk permissions (network, shell, secrets, deploys…) always require explicit human approval.
- **🕸 Live Swarm Graph** — a real-time force-directed map of coordinator, agents, tasks, dependencies and messages, with particle orbs that reflect *actual* agent state (pulse on tool calls, fragment on failure, collapse on completion).

## Safety & control

Autonomy is a dial, not a leap: **observe → ask before every tool → ask for risky tools → fully automatic within sandbox**. Global budget / token / time / agent-count limits are enforced by the orchestrator before every model call. Secrets are encrypted at rest (AES-256-GCM) and never reach the browser. Agent-generated code runs in an isolated child-process sandbox — never in the main process. No git pushes or deploys without explicit approval.

## Quick start

```bash
git clone https://github.com/swarmwright/swarmwright.git
cd swarmwright
npm install
cp .env.example .env          # set SECRET_ENCRYPTION_KEY (openssl rand -hex 32)
npx prisma db push            # creates the SQLite database
npm run dev                   # http://localhost:3000
```

Then: **Sign up → Onboarding → "Use Mock provider" → Run guided demo.**
You'll watch a full swarm build a task manager — no API key required.

Connect a real provider anytime (OpenAI, OpenRouter, Groq, DeepSeek, Ollama, or any OpenAI-compatible endpoint) from **Providers → Add connection**. Keys are encrypted at rest and only ever used server-side.

### Docker

```bash
docker compose up --build     # app on :3000, SQLite volume included
# optional: PROFILE=postgres docker compose --profile postgres up   # PostgreSQL instead of SQLite
```

## How it works

```
┌──────────────────────────────────────────────────────────────────┐
│  Next.js App Router                                              │
│  ┌─────────────┐   ┌──────────────────────────────────────────┐  │
│  │  React UI    │   │  API routes (REST + SSE)                 │  │
│  │  chat · runs │──▶│  auth · providers · chat · runs · tools  │  │
│  │  swarm · time│   └───────────────┬──────────────────────────┘  │
│  └─────────────┘                   │                             │
│                          ┌─────────▼─────────┐                   │
│                          │   Orchestrator    │                   │
│                          │  planner · task   │──▶ Provider       │
│                          │  graph · agents · │    adapters       │
│                          │  recruitment ·    │    (mock,         │
│                          │  genomes ·        │    OpenAI-compat) │
│                          │  checkpoints      │                   │
│                          └─────────┬─────────┘                   │
│            ┌───────────────────────┼─────────────────────┐       │
│     ┌──────▼──────┐        ┌───────▼───────┐      ┌──────▼─────┐ │
│     │ Event store │        │ Tool sandbox  │      │  Memory    │ │
│     │ (sourcing)  │        │ (child proc)  │      │  (scoped)  │ │
│     └──────┬──────┘        └───────────────┘      └────────────┘ │
│            │                                                     │
│     ┌──────▼──────────────────────────────────────────────┐      │
│     │   Prisma — SQLite (default) / PostgreSQL            │      │
│     └─────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────┘
```

Deep dive: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/PROVIDERS.md](docs/PROVIDERS.md) · [docs/SECURITY.md](docs/SECURITY.md)

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Vitest suite (orchestrator, task graph, router, genomes, sandbox, auth…) |
| `npm run lint` | ESLint |
| `npm run db:push` / `db:migrate` / `db:studio` | Prisma database workflows |

## Screenshots

> `docs/screenshots/` — capture the landing page, chat workspace, an active swarm run, and the Time Machine after running the guided demo. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#screenshots) for the exact shots to take.

## Roadmap highlights

OAuth provider connections · BullMQ/Redis distributed engine adapter · remote sandbox providers (Firecracker/Fly.io) · WebGL orb renderer · zip project export · Playwright e2e suite · MCP tool interoperability. Full list: [docs/ROADMAP.md](docs/ROADMAP.md).

Known scope decisions and honest limitations: [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Contributing

We'd love your help — good first issues are tagged. Read [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) — build something great.
