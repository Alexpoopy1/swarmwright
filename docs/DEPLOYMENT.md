# Deployment Guide

## Local development

```bash
npm install
cp .env.example .env          # set SECRET_ENCRYPTION_KEY
npx prisma db push
npm run dev                   # http://localhost:3000
```

## Docker (single node, recommended for self-hosting)

```bash
export SECRET_ENCRYPTION_KEY=$(openssl rand -hex 32)
docker compose up --build -d
```

- SQLite database persists in the `swarm-data` volume (`/app/data`).
- Sandbox subprocesses run inside the same container (isolated child processes with resource caps). For hostile multi-tenant use, put the app behind a remote sandbox adapter (see ARCHITECTURE.md).

## PostgreSQL

1. `docker compose --profile postgres up -d db` (or any managed Postgres).
2. In `prisma/schema.prisma`, set `provider = "postgresql"`.
3. `DATABASE_URL="postgresql://swarm:swarm@localhost:5432/swarmwright" npx prisma db push`
4. Set the same `DATABASE_URL` for the app (`docker compose` env or `.env`).

## Production checklist

- [ ] Real `SECRET_ENCRYPTION_KEY` (32+ bytes, from a secrets manager)
- [ ] HTTPS termination (reverse proxy: Caddy/Traefik/nginx). SSE endpoints need `proxy_buffering off` and long read timeouts.
- [ ] `npm run build && npm start` behind a process manager (or the Docker image)
- [ ] Regular backups of the database (runs, genomes, memories live there)
- [ ] Decide exposure: the app has no multi-tenant isolation beyond workspaces — run one instance per team.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `file:./dev.db` | Prisma connection (SQLite path or Postgres URL) |
| `SECRET_ENCRYPTION_KEY` | dev default | AES-256-GCM key for provider secrets |
| `SANDBOX_TIMEOUT_MS` | `15000` | Max wall time per tool execution |
| `SANDBOX_MEMORY_MB` | `256` | Heap cap for sandboxed tools |
| `SANDBOX_NETWORK` | `deny` | Network policy for sandboxed tools |

## Screenshots (for README maintainers)

After `npm run dev` + guided demo, capture into `docs/screenshots/`:
1. `landing.png` — `/`
2. `chat.png` — `/app/chat` with a streamed answer
3. `swarm.png` — `/app/runs/[id]` mid-run (swarm tab)
4. `time-machine.png` — `/app/runs/[id]/timemachine`
5. `genomes.png` — `/app/genomes`
6. `usage.png` — `/app/usage`

## Scaling notes

Single-node by design today. The orchestrator seams map onto BullMQ/Redis (job queue, run locks, event fanout) — see ROADMAP.md for the distributed adapter plan.
