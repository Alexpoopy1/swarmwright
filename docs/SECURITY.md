# Security Model

Swarmwright is highly automated **but never uncontrollable**. This document describes the trust boundaries and controls.

## Secrets

- Provider API keys are encrypted with **AES-256-GCM** using `SECRET_ENCRYPTION_KEY` (see `.env.example`). Set a real key — the dev default prints a warning banner in the UI (`/app/providers`).
- Keys are decrypted only on the server, at call time. API responses return only a masked hint (`sk-…wxyz`) stored at creation time.
- Keys never appear in logs, events, or client payloads.

## Authentication & sessions

- Credentials auth: bcrypt password hashing, 30-day DB sessions, httpOnly `SameSite=Lax` cookies.
- Every API route calls `requireUser()`; workspace isolation is enforced by scoping every query to the caller's workspace.

## Agent code execution

- Agent-authored tools **never run in the main process**. They run in a child-process sandbox: memory cap, hard timeout (SIGKILL), scrubbed environment, temp-directory isolation + cleanup, and network disabled by default (stubbed `http`/`https`/`net`/`fetch`).
- Tool specs are validated (zod), risk-classified from declared permissions *and* source scanning (`child_process`, `fs.rm`, `fetch(`, …).
- **High-risk permissions always require explicit human approval**: network, secrets, package install, DB writes, file deletion, shell, deploy, git push.
- Approval state is durable (DB rows) — closing the browser cannot lose a pending decision.

## Autonomy modes

| Mode | Behavior |
|---|---|
| `observe` | Engine plans and simulates; nothing executes without approval. |
| `ask_all` | Approval required before every tool execution. |
| `ask_risky` | Approval required for medium/high-risk tools and recruitment. |
| `auto` | Executes within sandbox + budget limits. High-risk permissions still ask. |

## Budgets & limits

Before every model call the engine checks run budget and token limits (`checkRunBudget`). 80% → `BUDGET_WARNING`; exceeded → `BUDGET_EXCEEDED` + run paused. Time, agent-count, retry and recursion caps are enforced by the engine and recruitment policy.

## LLM output handling

- All structured model output is validated with zod (plan schema, agent action protocol, tool specs). One repair attempt, then a structured failure.
- The UI displays only user-safe activity summaries ("Writing API routes") — never private chain-of-thought.
- Planner/agent prompts demand single-JSON responses; markdown fences are stripped and re-validated.

## Web & transport

- All UI is React-rendered (auto-escaped); markdown is rendered via react-markdown without `dangerouslySetInnerHTML`.
- Path safety for project files rejects `..`, absolute paths, null bytes, overlong names.
- Deploy behind HTTPS in production (see DEPLOYMENT.md). Rate limiting / WAF is the deployer's responsibility (roadmap: built-in edge middleware).

## Reporting

Please report vulnerabilities privately (see README contact) — do not open public issues for security reports.
