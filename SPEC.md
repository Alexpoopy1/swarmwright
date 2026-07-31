# SWARMWRIGHT — Master Specification (SPEC.md)

Single source of truth. Implement to these contracts exactly. If something is
ambiguous, make the strongest reasonable decision and note it in code comments —
never change shared contracts in `src/types/index.ts`, `prisma/schema.prisma`,
or `src/server/{db,json,env}.ts` / `src/server/crypto/secrets.ts` (frozen).

## 1. Product definition

- **Name:** Swarmwright
- **Tagline:** An open-source autonomous AI development workspace — connect any model, coordinate agent swarms, ship software.
- **What it is:** A browser-based workspace with two modes — **Chat Mode** (direct multi-model conversation, streaming, council mode) and **Agentic Mode** (goal → structured plan → dynamic agent swarm → files, tools, tests, artifacts — with full human control, event-sourced history, and a visual Time Machine).
- **Flagship features:** (1) **Agent Genome** — transparent performance learning over agent configurations; (2) **Swarm Time Machine** — event-sourced scrub/fork/branch of any run.
- **Target users:** developers, technical founders, AI power users.
- **Differentiation:** provider-agnostic routing + dynamic recruitment + self-built tools + complete controllability (pause/resume/stop/approve/fork) + honest limits.
- **License:** MIT.

## 2. Stack (frozen — do not add/remove deps without noting in docs/LIMITATIONS.md)

Next.js 15 App Router · React 19 · strict TypeScript · Tailwind 3 · Prisma + SQLite (Postgres-switchable) · Zod · Zustand · Framer Motion · d3-force (SVG swarm graph) · react-markdown + remark-gfm + rehype-highlight · lucide-react · Vitest. bcryptjs for password hashing. Node 20.

Architecture: **single modular Next.js app** (deliberate deviation from the master prompt's monorepo; documented in README + LIMITATIONS). All server logic under `src/server/<module>` with clean module boundaries. API surface in `src/app/api/**`. UI in `src/app/**` + `src/components/**`.

## 3. Directory & ownership map

```
prisma/schema.prisma            [FROZEN — main agent owns]
src/types/index.ts              [FROZEN — shared contracts]
src/server/db.ts json.ts env.ts crypto/secrets.ts   [FROZEN]
src/server/events/              [FROZEN — main agent owns] event store + SSE bus
src/server/auth/                server-data      signup/signin/signout/session helpers
src/server/providers/           server-data      adapters (mock, openai-compatible), registry, pricing
src/server/router/              server-data      model router
src/server/usage/               server-data      metering + budget checks
src/server/tools/               server-data      tool SDK, sandbox adapter, factory
src/server/projects/            server-data      project + file service (versions, export)
src/server/chat/                server-data      conversation service + council mode
src/server/orchestrator/        orchestrator     engine, planner, taskGraph, agentRuntime, recruitment, checkpoints, genome, messages, prompts
src/server/memory/              orchestrator     scoped memory service
src/instrumentation.ts          orchestrator     resumeInterruptedRuns hook
src/app/api/**                  api-routes       REST/SSE route handlers
src/app/(public pages)          agent-ui-shell   landing, signin, signup, onboarding
src/app/app/**                  agent-ui-shell   shell layout + dashboard/providers/projects/settings/usage/genomes/tools pages
src/app/app/chat/**             agent-ui-work    chat workspace
src/app/app/runs/**             agent-ui-work    agentic workspace, time machine
src/components/ui/**            agent-ui-shell   primitives (button, toggle, slider, segmented, tooltip, dialog, command palette, resizable panes, empty/loading states)
src/components/swarm/**         agent-ui-work    swarm graph, agent orb particles, thinking bubble, timeline scrubber, plan editor, task board, inspector, event stream, approvals panel
src/lib/api.ts, format.ts       agent-ui-shell   typed fetch wrapper, formatters
src/lib/sse.ts, stores.ts       agent-ui-work    SSE hook, zustand stores
tests/**                        owner = module author (orchestrator.test, taskGraph.test, router.test, genome.test, tools.test, sandbox.test, planner.test, events.test, recovery.test)
docs/**                         main agent       README etc.
docker, .github                 main agent
```

## 4. Server contracts (signatures are binding)

### 4.1 auth — `src/server/auth/index.ts`
```ts
export const SESSION_COOKIE = "sw_session";
export async function signUp(input: { email: string; name: string; password: string }): Promise<{ userId: string }>; // 400 on duplicate email; bcrypt hash; creates default Workspace "Personal"
export async function signIn(input: { email: string; password: string }): Promise<{ token: string; expiresAt: Date }>; // throws AuthError("invalid_credentials")
export async function signOut(token: string): Promise<void>;
export async function getSessionUser(): Promise<{ id: string; email: string; name: string } | null>; // reads cookie via next/headers
export async function requireUser(): Promise<{ id: string; email: string; name: string }>; // throws AuthError("unauthorized")
export async function getDefaultWorkspaceId(userId: string): Promise<string>;
export class AuthError extends Error { constructor(public code: string, msg?: string) }
```
Session token: `crypto.randomBytes(32).hex`, 30-day expiry, httpOnly sameSite=lax cookie set by route handlers.

### 4.2 events — `src/server/events/store.ts` + `bus.ts`
```ts
// store.ts
export async function emitEvent(e: {
  runId?: string | null; projectId?: string | null; type: EventType;
  actorType?: EventActorType; actorId?: string | null; summary?: string; payload?: unknown;
}): Promise<SwarmEvent>;            // persists (Event row; seq = autoincrement id) + publishes to bus
export async function listEvents(opts: { runId?: string; projectId?: string; afterSeq?: number; limit?: number }): Promise<SwarmEvent[]>;
export function reconstructRunState(events: SwarmEvent[]): RunSnapshot; // fold events → state-at-time (Time Machine)
// bus.ts — in-process pub/sub fanout for SSE
export function subscribe(runId: string, listener: (e: SwarmEvent) => void): () => void;
```
`reconstructRunState` folds: RUN_CREATED→status/goal, PLAN_CREATED→plan, AGENT_*/TASK_*→maps, BUDGET_*/TOOL_* accumulate cost when payload carries `costUsd`.

### 4.3 providers — `src/server/providers/`
```ts
// registry.ts
export function getAdapter(provider: string): ProviderAdapter; // "mock" | "openai" | "openrouter" | "groq" | "deepseek" | "ollama" | "openai-compatible" (anthropic → documented as openai-compatible baseUrl or roadmap)
export async function connectionConfig(connectionId: string): Promise<ProviderConnectionConfig>; // loads row + decrypts secret server-side
export async function listConnectionModels(connectionId: string): Promise<ModelInfo[]>;
// pricing.ts
export function estimateCostUsd(provider: string, model: string, tokensIn: number, tokensOut: number): number; // uses ModelCost table w/ static fallback table
export const FALLBACK_MODELS: ModelInfo[]; // static metadata for known models
```
- **MockProvider** (`mock.ts`): offline, deterministic, streams word-by-word with ~8ms delay. Behavior: if `jsonMode` and system prompt contains `"PLANNER"`, returns a valid `PlanContent` JSON built from the user's goal (6–10 tasks incl. design/frontend/backend/db/tests/review/docs with sensible dependsOn). If system prompt contains `"AGENT"`, returns a rotating valid `AgentAction` JSON sequence driven by the task (status → file_write(s) with real small code files → optional tool_propose once → message → task_complete). Otherwise conversational markdown answer echoing context. Token counts estimated via `ceil(chars/4)`. Model ids: `mock-planner-1`, `mock-coder-1`, `mock-fast-1` (contextLimit 32768, supportsTools true, cost 0).
- **OpenAICompatAdapter** (`openaiCompat.ts`): fetch-based; `POST {baseUrl}/chat/completions` with `Authorization: Bearer <apiKey>` when present (Ollama needs none); streaming via SSE line parsing (`data:` frames, `[DONE]`); `jsonMode` → `response_format: { type: "json_object" }` (best-effort, wrapped in try). Error normalization: map HTTP 401/403→`auth`, 429→`rate_limit`, 5xx→`provider_error`, network→`unreachable`; thrown as `ProviderError(code, message, retryable)`. Default baseUrls: openai `https://api.openai.com/v1`, openrouter `https://openrouter.ai/api/v1`, groq `https://api.groq.com/openai/v1`, deepseek `https://api.deepseek.com/v1`, ollama `http://localhost:11434/v1`. listModels: `GET /models` with fallback to FALLBACK_MODELS per provider.
```ts
export class ProviderError extends Error { constructor(public code: "auth"|"rate_limit"|"provider_error"|"unreachable"|"invalid_response", msg: string, public retryable: boolean) }
```

### 4.4 router — `src/server/router/modelRouter.ts`
```ts
export async function routeModel(workspaceId: string, profile: TaskProfile): Promise<RouteDecision | null>; // null when no providers connected
```
Scoring over all connected providers' models: hard filters (forceProvider/forceModel, needsTools→supportsTools, needsVision→supportsVision, minContext) then score = qualityBase(taskType↔model heuristics: prefer larger/better models for planning/review, fast for docs) * qualityWeight − costPenalty − latencyPenalty + availabilityBonus(connection.status==="ok") + genomeBonus (AgentGenome.successRate for matching role/taskType). Deterministic, unit-testable (factor pure `scoreModel(profile, model, ctx): number`).

### 4.5 usage — `src/server/usage/meter.ts`
```ts
export async function recordUsage(u: { workspaceId: string; projectId?: string; runId?: string; agentId?: string; provider: string; model: string; tokensIn: number; tokensOut: number; kind: string }): Promise<{ costUsd: number }>; // writes UsageRecord; increments AgentRun.costUsd/tokensUsed + Agent aggregates when ids given
export async function checkRunBudget(runId: string): Promise<{ ok: boolean; reason?: string }>; // false when cost>=budget or tokens>=tokenLimit
export async function usageSummary(workspaceId: string): Promise<UsageSummary>;
```

### 4.6 orchestrator — `src/server/orchestrator/`
- `taskGraph.ts` (pure, heavily unit-tested):
```ts
export class TaskGraph {
  constructor(tasks: PlanTask[]);
  readyTasks(completed: Set<string>, active: Set<string>, failed: Set<string>): PlanTask[]; // deps satisfied, not started
  hasCycle(): boolean;
  dependentsOf(id: string): string[];
  isComplete(completed: Set<string>): boolean;
}
```
- `planner.ts`:
```ts
export async function generatePlan(workspaceId: string, goal: string, opts?: { instructionOverride?: string }): Promise<PlanContent>; // routes model (taskType planning), system prompt contains "PLANNER", jsonMode, zod-validate, one repair retry ("return valid JSON only")
```
- `engine.ts` — durable in-process engine (globalThis singleton map runId→controller):
```ts
export async function startRun(input: StartRunInput & { workspaceId: string }): Promise<{ runId: string }>;
export async function pauseRun(runId: string): Promise<void>;
export async function resumeRun(runId: string): Promise<void>;
export async function stopRun(runId: string): Promise<void>;
export async function retryTask(runId: string, taskId: string): Promise<void>;
export async function forkRun(runId: string, opts: { checkpointId?: string; instructionOverride?: string; forceModel?: { provider: string; model: string } }): Promise<{ runId: string }>;
export async function resumeInterruptedRuns(): Promise<void>; // called from instrumentation; resumes runs left in running/paused after restart from latest checkpoint (best effort)
```
Engine behavior: create run row (status queued→planning), generate plan (unless planOverride), persist Plan + events (RUN_CREATED, PLAN_CREATED, TASK_CREATED…), mode `plan_only`→stop at awaiting plan; `plan_approve`→status awaiting_approval until plan approved (approval row or PATCH plan status); `auto`→immediately. Then main loop (async, per-run AbortController, serialized per run): create agents for ready tasks (role→genome match→routeModel; respect maxAgents + maxConcurrentAgents default 4), run agent loops concurrently with dependency tracking; each agent step: build context (run memory + project memory retrieval + task description + recent structured messages — never whole project) → adapter.complete(jsonMode, system prompt contains "AGENT <role>") → zod-validate action (one retry) → apply effects: file_write→project file service (+FILE_CREATED/UPDATED), tool_call→tool factory execute (permission gate), tool_propose→factory pipeline, message→AGENT_MESSAGE + routed to target agent's context, recruit_request→recruitment policy (caps + approval when autonomy!=auto), task_complete/failed→task state, retries w/ exponential backoff (maxAttempts, TASK_RETRIED). Loop detection: if >12 consecutive steps complete no task and write no file → force task_failed(recovery) + emit. Budget/token checks before each model call (BUDGET_WARNING at 80%, BUDGET_EXCEEDED→pause). Checkpoint every 15 events + on pause (CHECKPOINT_CREATED, stateJson=RunSnapshot). On all tasks complete → final synthesis memory + RUN_COMPLETED + genome updates. On unhandled error → RUN_FAILED with structured error. Every state change emits its event with meaningful payload (include agent/task snapshots for Time Machine fold). Pause/resume/stop honored between steps; approvals: when autonomy requires, create Approval, set run awaiting_approval, wait (poll every 1s with AbortSignal) until decided/timeout(10min→reject).
- `agentRuntime.ts`: the per-agent step loop used by engine (kept separate for testability): `export async function runAgentStep(ctx: AgentContext): Promise<AgentStepResult>` and `buildAgentContext(...)`.
- `recruitment.ts`: `evaluateRecruitment(runId): Promise<{action:"none"}|{action:"recruit",role:string,reason:string,taskType:TaskProfile["taskType"]}|{action:"merge"|"retire",agentId:string,reason:string}>` — triggers on >2 ready tasks unassigned, agent failed twice, blocked>60s; hard caps from run limits.
- `genome.ts`:
```ts
export async function matchGenome(workspaceId: string, role: string, taskType: string): Promise<AgentGenome | null>; // best successRate with >=3 runs matching role/category; else null
export async function seedDefaultGenomes(workspaceId: string): Promise<void>; // planner/architect/coder/reviewer/tester/docs (mock provider models)
export async function recordRunOutcome(agentId: string, outcome: { success: boolean; latencyMs: number; costUsd: number; failurePattern?: string; taskCategory: string }): Promise<void>; // EMA update α=0.3, skip when genome.locked or !learningEnabled; emit GENOME_UPDATED
```
- `checkpoints.ts`: `createCheckpoint(runId,label)`, `latestCheckpoint(runId)`, `restoreSnapshot(runId, checkpointId): Promise<RunSnapshot>`.
- `messages.ts`: structured inter-agent mail: `sendAgentMessage({runId,fromAgentId,to,summary,payload,confidence,requestedAction})` (persist to run memory scope + AGENT_MESSAGE event) and `inboxFor(agentId)`.
- `prompts.ts`: system prompt builders. Planner prompt MUST contain the exact token `PLANNER`; agent prompt MUST start with `AGENT <role>`; both demand single-JSON responses matching the zod schemas and include the schema shape. Never request or display chain-of-thought.

### 4.7 memory — `src/server/memory/index.ts`
```ts
export async function saveMemory(m: { workspaceId: string; projectId?: string; runId?: string; agentId?: string; scope: MemoryScope; key: string; content: string; expiresAt?: Date }): Promise<void>; // emits MEMORY_SAVED when runId
export async function retrieveMemory(q: { workspaceId: string; scopes: MemoryScope[]; projectId?: string; runId?: string; agentId?: string; query?: string; limit?: number }): Promise<Array<{ key: string; content: string; scope: string }>>; // keyword relevance scoring (term overlap), recency tiebreak; excludes expired
export async function summarizeScope(...): Promise<string>; // compress long memories via routed model, fallback: truncation
export async function deleteMemory(id: string): Promise<void>;
```

### 4.8 tools — `src/server/tools/`
- `sdk.ts`:
```ts
export function validateToolSpec(input: unknown): ToolSpec; // zod; name /^[a-z][a-z0-9_]{2,40}$/
export function classifyRisk(spec: { permissions: ToolPermission[]; sourceCode: string }): RiskLevel; // high when HIGH_RISK_PERMISSIONS ∩ perms or source matches /(child_process|fs\.rm|rm -rf|fetch\(|http)/
export function requiresApproval(risk: RiskLevel, autonomy: AutonomyMode): boolean; // high always; medium unless auto; low only when ask_all
```
- `sandbox.ts` — `LocalProcessSandbox implements SandboxAdapter` (default) + `getSandbox(): SandboxAdapter`. Implementation: write wrapper to `sandbox-tmp/<uuid>/` (gitignored, cleaned after), spawn `node --max-old-space-size=<mb> runner.js`; runner loads tool source with `new Function`, applies input, captures console into logs, JSON-serializes result to stdout with sentinel lines `__SW_RESULT__...__SW_END__`; hard kill on timeout; env scrubbed (only PATH); network "deny" enforced by monkey-patching http/https/net/fetch inside runner when policy denies; shell tools refused unless policy allows and command passes allowlist; `deniedCommands` default `["rm -rf /", "sudo", "curl | sh"]`. Never run tool code in-process.
- `factory.ts`:
```ts
export async function proposeTool(args: { projectId: string; runId?: string; agentId?: string; proposal: /* tool_propose action payload */ any; autonomy: AutonomyMode }): Promise<{ toolId: string; status: string }>; // validate → classify → run tests in sandbox (TEST_STARTED/COMPLETED) → repair once on failure → status approved (low risk, tests pass) or pending_approval (+TOOL_APPROVAL_REQUIRED + Approval row) → TOOL_PROPOSED/TOOL_REGISTERED events
export async function executeTool(args: { toolId: string; input: Record<string, unknown>; runId?: string; agentId?: string; taskId?: string; autonomy: AutonomyMode }): Promise<ToolRunResult>; // permission gate + approval flow + ToolExecution row + TOOL_STARTED/COMPLETED/FAILED
export async function approveTool(toolId: string, approve: boolean): Promise<void>;
```

### 4.9 projects — `src/server/projects/index.ts`
```ts
export async function createProject(workspaceId: string, input: { name: string; description?: string }): Promise<Project>;
export async function listProjects(workspaceId: string): Promise<Project[]>;
export async function upsertFile(projectId: string, path: string, content: string, opts?: { language?: string }): Promise<FileEntry>; // versions: bump version + FileVersion snapshot; returns row
export async function getFile(projectId: string, path: string): Promise<FileEntry | null>;
export async function listFiles(projectId: string): Promise<Array<{ path: string; version: number; updatedAt: Date }>>;
export async function exportProjectBundle(projectId: string): Promise<{ name: string; files: Array<{ path: string; content: string }> }>; // JSON bundle (zip documented as roadmap)
```
Path safety: reject `..`, absolute paths, >240 chars, null bytes.

### 4.10 chat — `src/server/chat/service.ts`
```ts
export async function createConversation(workspaceId: string, input: { title?: string; projectId?: string; mode?: "chat" | "council" }): Promise<Conversation>;
export async function listConversations(workspaceId: string, opts?: { query?: string }): Promise<Conversation[]>; // searchable by title/message content (LIKE)
export async function postUserMessage(conversationId: string, content: string): Promise<Message>;
export async function* streamAssistantReply(args: { conversationId: string; connectionId?: string; model?: string; parentMessageId?: string }): AsyncGenerator<ChatChunk>; // history (last 30 msgs) → route or override → adapter.stream → yield chunks → persist Message w/ usage+cost+provider/model metadata
export async function councilReply(args: { conversationId: string; connectionIds: string[] }): Promise<{ messageId: string }>; // ask up to 3 connections concurrently → synthesize with best model ("strongest answer") → persist single assistant message with metadataJson.council = per-model answers
export async function branchConversation(conversationId: string, fromMessageId: string): Promise<{ conversationId: string }>; // copies messages up to fromMessageId
```

## 5. API surface (`src/app/api/**`, route handlers, `export const runtime = "nodejs"`)

All authenticated via `requireUser()` → 401 `{error}`. JSON bodies validated with zod → 400. Errors → `{error: string, code?}` with sensible status. List endpoints support `?limit`.

| Route | Methods | Purpose |
|---|---|---|
| `/api/auth/signup` `/signin` `/signout` | POST | sets/clears session cookie |
| `/api/me` | GET | current user + default workspace id |
| `/api/providers` | GET,POST | list (masked, never secret) / create connection (encrypt secret) |
| `/api/providers/[id]` | PATCH,DELETE | update label/baseUrl/secret, disconnect |
| `/api/providers/[id]/test` | POST | adapter.testConnection → status update |
| `/api/providers/[id]/models` | GET | listConnectionModels |
| `/api/chat/conversations` | GET(?query),POST | list/create |
| `/api/chat/conversations/[id]` | GET,DELETE,PATCH | detail w/ messages; delete; rename/archive |
| `/api/chat/conversations/[id]/messages` | POST | postUserMessage |
| `/api/chat/stream` | POST | SSE stream of `{delta}` then `{done, messageId}`; body `{conversationId, connectionId?, model?, parentMessageId?, mode?: "chat"\|"council", connectionIds?: string[]}` |
| `/api/chat/conversations/[id]/branch` | POST | branch from message |
| `/api/projects` | GET,POST | list/create |
| `/api/projects/[id]` | GET,PATCH,DELETE | detail (+files list, runs), rename, delete |
| `/api/projects/[id]/files` | GET | list files |
| `/api/projects/[id]/file` | GET(?path),PUT | read/upsert file (path in query/body) |
| `/api/projects/[id]/export` | GET | JSON bundle download |
| `/api/runs` | GET(?projectId),POST | list / startRun |
| `/api/runs/[id]` | GET | full run detail: run, plan, agents, tasks, approvals, latestCheckpoint, cost |
| `/api/runs/[id]/control` | POST | `{action: "pause"\|"resume"\|"stop"\|"retry", taskId?}` |
| `/api/runs/[id]/events` | GET | SSE: replay `afterSeq` then live bus |
| `/api/runs/[id]/events-list` | GET | JSON events `?afterSeq&limit` (Time Machine paging) |
| `/api/runs/[id]/fork` | POST | forkRun |
| `/api/runs/[id]/checkpoints` | GET | list checkpoints |
| `/api/plans/[id]` | GET,PATCH | read / edit plan contentJson (PLAN_EDITED) |
| `/api/plans/[id]/decision` | POST | `{decision:"approve"\|"reject"}` → PLAN_APPROVED/REJECTED; approve executes when mode plan_approve |
| `/api/approvals/[id]` | POST | `{decision:"approve"\|"reject"}` (APPROVAL_RESOLVED) |
| `/api/genomes` | GET,POST | list / create(clone via POST {fromId}) |
| `/api/genomes/[id]` | PATCH,DELETE | lock/unlock, reset learning, toggle learningEnabled, edit prompts; export = GET with `?format=export` |
| `/api/tools` | GET(?projectId),POST | list / manual create (goes through proposeTool validation) |
| `/api/tools/[id]` | GET,PATCH,DELETE | detail incl. executions; rename/archive; delete |
| `/api/tools/[id]/execute` | POST | `{input}` → executeTool (autonomy from body or "ask_risky") |
| `/api/tools/[id]/approve` | POST | approveTool |
| `/api/usage/summary` | GET | UsageSummary for workspace |
| `/api/demo` | POST | one-click guided demo: creates project "Demo Task Manager" + run (goal from master prompt §30) on mock provider, autonomy ask_risky, mode auto → `{runId}` |

## 6. UI contract

### 6.1 Design system
Dark, calm, technical. Palette from `tailwind.config.ts` (ink backgrounds, copper accent `#c97c43`, sage success `#6f9470`, ember danger `#c9573f`). No blue-purple gradients, no glassmorphism, radii `rounded-md` (6px), borders `border-ink-700`, text `text-stone-200/300/400`. lucide-react icons, 14px base text, mono for code/ids. Framer Motion: only 150–250ms ease-out fades/slides; respect `prefers-reduced-motion`. Every screen has loading skeleton + empty state + error state. All interactive elements keyboard-accessible with visible `focus-visible:ring-1 ring-copper-500`. Status uses color **and** icon/label (non-color indicator).

Primitives in `src/components/ui/`: `Button` (primary/secondary/ghost/danger), `Toggle`, `Slider`, `SegmentedControl`, `Tooltip`, `Dialog`, `Input`, `Select`, `Badge`, `Spinner`, `EmptyState`, `CommandPalette` (Ctrl/Cmd+K, actions: navigate all pages, new project, new chat, new run, pause/resume current run), `ResizablePanels` (horizontal split w/ drag handle + keyboard resize), `Tabs`, `Toast` (minimal).

### 6.2 Pages
- `/` landing: hero (name, tagline, CTA "Open workspace"/"GitHub"), feature grid (Chat, Agentic swarms, Genome, Time Machine, Tool factory, Safety), architecture strip, footer. Static, fast.
- `/signin`, `/signup`: centered card, client validation, error display → redirect `/app`.
- `/onboarding`: 6-step wizard (welcome → connect provider [mock one-click OR api-key form w/ provider picker+baseUrl] → test connection → automation preference (autonomy) → default budget → create first project + optional guided demo). Skippable.
- `/app` shell (`src/app/app/layout.tsx`): left sidebar (Projects, Chat, Agent runs, Genomes, Tools, Providers, Usage, Settings + New buttons), top bar (workspace name, command palette trigger, autonomy indicator, sign out). Auth-guarded (server component checks session, redirect /signin).
- `/app/dashboard`: cards — active runs (live status via SSE), recent conversations, cost this week, quick actions (New chat, New run, Guided demo).
- `/app/providers`: connection list (provider, label, masked key, status badge, test/disconnect), add-connection dialog (provider select, label, api key, baseUrl override, "Use Mock provider (no key needed)"), model list per connection.
- `/app/projects`, `/app/projects/new`, `/app/projects/[id]`: file browser tree (left), code viewer w/ highlight.js (center), file version history + diff (simple line diff), project runs list, export button.
- `/app/chat`: conversation list (search, archive) + chat pane: streaming markdown, syntax highlight, per-message provider/model + token/cost chip, regenerate, edit-and-resend (creates branch), stop generation (AbortController→POST stream aborted), copy/export (.md download), model picker (connected models), council mode toggle (pick 2–3 connections), token/context usage bar.
- `/app/runs`: run list w/ status badges, cost, branch indicator; new run dialog (project, goal textarea, mode plan_only/plan_approve/auto, autonomy observe/ask_all/ask_risky/auto, budget/token/time/agent sliders).
- `/app/runs/[id]` — the agentic workspace (ResizablePanels):
  - Left/main tabs: **Plan** (document view + editable sections pre-approval, approve/reject bar, edit → PATCH), **Board** (kanban by task status w/ dependency hints), **Swarm** (d3-force SVG graph: coordinator center, agents as nodes w/ orb-mini, tasks as squares, edges=deps/messages; pan/zoom, click inspect, pause/resume/stop agent buttons, filter by status/provider), **Timeline** (Time Machine inline).
  - Right inspector: active agents list, selected agent detail (role, genome, provider/model, tokens, cost, confidence, current bubble), approvals queue (approve/reject w/ risk badge + detail), global controls (pause/resume/stop/fork), budget progress bars.
  - Bottom panel tabs: Event stream (virtualized-ish list, filter by type), Agent messages, Tool calls, Files changed.
  - Thinking bubbles near agent names (user-safe summaries only). Particle orbs: `AgentOrb` canvas component — 120–200 particles on a sphere projected orthographically; speed ∝ activity, pulse on tool call (event-driven), fragment scatter on failure, reassemble, gentle collapse+fade on completion; streams of particles along message edges in swarm graph. Toggle "Effects: on/off" persisted in localStorage; reduced-motion → static ring; canvas 2D only (WebGL documented as roadmap).
- `/app/runs/[id]/timemachine`: full-screen Time Machine — horizontal event scrubber (play/pause, speed, drag), state-at-time reconstruction client-side from events (agents present, task graph, files touched per event, cost accumulation curve), event detail pane, "Fork from here" button (→ fork dialog with instruction/model override → navigates to new run), branch compare view (two runs side-by-side: status, tasks completed, cost, files).
- `/app/genomes`: genome cards (role, provider/model, success rate bar, avg cost/latency, runs, best categories chips, locked toggle, learning toggle), compare drawer (select 2 → side-by-side table), clone, reset-learned-data, export/import JSON.
- `/app/tools`: registry table (name, type, version, risk badge, status, author agent, executions), tool detail (source, tests, schemas, execution history, run-in-sandbox panel w/ JSON input), tool builder (form: name/type/description/schema JSON/source/tests/permissions → validate → test → save), approve/reject pending tools.
- `/app/usage`: UsageSummary dashboard — totals, per-provider/model bars, per-run table, budget inputs (stored in workspace settingsJson).
- `/app/settings`: profile, workspace name, default autonomy/budget/limits, effects toggle, reduced-motion respect note, danger zone (clear memories, reset genomes).

### 6.3 Client data layer
`src/lib/api.ts` typed fetch wrapper (throws on !ok with server message), `src/lib/sse.ts` EventSource wrapper w/ auto-reconnect + `afterSeq` cursor, `src/lib/stores.ts` zustand: `useRunStore` (events fold, agent/task maps, cost), `useUiStore` (effects toggle, sidebar, palette). Format helpers `src/lib/format.ts` (cost $0.0001, tokens 12.4k, duration).

## 7. Engineering rules (binding, from master prompt §32)
No fake buttons (every control wires to a real API), no placeholder-as-complete, no hardcoded provider responses (mock is an explicit provider), no secrets to client, no chain-of-thought display, no in-process untrusted code, no silent budget overflow, no destructive action without confirm, no god-files (split modules), TS errors must be zero in files you own (`npx tsc --noEmit`), all external calls error-handled, all model JSON zod-validated, durable state in DB, real tests actually executed.

## 8. Testing (Vitest, `tests/`, run with `npm test`)
Global setup (`tests/setup.ts`): copy schema to temp db `file:/tmp/sw-test-<rand>.db` via `npx prisma db push --skip-generate`, set process.env.DATABASE_URL before importing modules, cleanup after. Required suites:
- `taskGraph.test.ts` — ready set, deps, cycle detect, completion.
- `router.test.ts` — scoring filters (tools/vision/context), force override, cheapest-vs-quality.
- `planner.test.ts` — mock provider produces schema-valid plan; invalid JSON repaired once.
- `genome.test.ts` — EMA math, locked/learning-disabled skip, seeding idempotent.
- `sandbox.test.ts` — benign tool runs+returns, timeout kills, network-deny blocks fetch, dangerous source classified high-risk.
- `orchestrator.test.ts` — full mock run: start→plan→agents→files written→RUN_COMPLETED; pause/resume; stop; budget-exceeded pauses; fork creates branch run; events persisted & reconstructRunState consistent.
- `events.test.ts` — emit/list/reconstruct fold.
- `auth.test.ts` — signup/signin/wrong-password/session.
Every suite must actually pass; output goes in the final report.

## 9. Docs & release (main agent)
README (first-screen explanation, quickstart `npm install && npx prisma db push && npm run dev`, mock provider note, screenshots placeholders, feature map, architecture diagram (ascii), scripts), docs/ARCHITECTURE.md, docs/PROVIDERS.md, docs/SECURITY.md, docs/DEPLOYMENT.md, docs/CONTRIBUTING.md, docs/ROADMAP.md, docs/LIMITATIONS.md (honest deviations: monorepo→single app, BullMQ/Redis→in-process durable engine w/ adapter notes, OAuth→api-key (OAuth flows roadmap), zip export→JSON bundle, Playwright→roadmap, WebGL→canvas), LICENSE MIT, .github/workflows/ci.yml (install, prisma generate, db push, vitest, tsc, build), issue+PR templates, CODE_OF_CONDUCT.md, CHANGELOG.md, Dockerfile + docker-compose.yml (app service; optional postgres profile with instructions), .env.example (exists).
