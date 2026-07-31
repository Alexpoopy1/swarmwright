import type {
  ChatChunk,
  ChatParams,
  ModelInfo,
  ProviderAdapter,
  ProviderConnectionConfig,
} from "@/types";

/**
 * MockProvider (SPEC §4.3) — a real, fully offline, deterministic provider.
 *
 * - `jsonMode` + system prompt containing "PLANNER" → a valid PlanContent JSON
 *   document derived from the user's goal (8 tasks, DAG over t1..t8).
 * - `jsonMode` + system prompt starting with "AGENT " → one valid AgentAction
 *   JSON per call, chosen by a deterministic rotation driven by a hash of the
 *   last user message and the number of prior assistant messages in
 *   `params.messages` (status → file_writes → tool_propose once per
 *   conversation → message → task_complete after ~5 actions).
 * - Otherwise → a conversational markdown reply echoing the context.
 *
 * Token counts are estimated as ceil(chars/4). Chat replies stream
 * word-by-word (~8ms apart); JSON payloads stream in a few chunks.
 */

const STREAM_WORD_DELAY_MS = 8;

export const MOCK_MODELS: ModelInfo[] = [
  {
    provider: "mock",
    model: "mock-planner-1",
    label: "Mock Planner (offline)",
    contextLimit: 32768,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    inputPer1k: 0,
    outputPer1k: 0,
  },
  {
    provider: "mock",
    model: "mock-coder-1",
    label: "Mock Coder (offline)",
    contextLimit: 32768,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    inputPer1k: 0,
    outputPer1k: 0,
  },
  {
    provider: "mock",
    model: "mock-fast-1",
    label: "Mock Fast (offline)",
    contextLimit: 32768,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    inputPer1k: 0,
    outputPer1k: 0,
  },
];

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Deterministic 32-bit FNV-1a hash. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function slugify(text: string, fallback = "project"): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

/** Significant words of the goal, used to make outputs goal-specific. */
function keywords(goal: string): string[] {
  const stop = new Set([
    "the", "a", "an", "and", "or", "of", "to", "for", "with", "that", "this",
    "build", "create", "make", "app", "application", "system", "please", "me",
    "it", "in", "on", "is", "be", "as", "by", "at", "from", "use", "using",
  ]);
  const words = goal
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
  return [...new Set(words)].slice(0, 6);
}

function systemPrompt(params: ChatParams): string {
  return params.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
}

function lastUserMessage(params: ChatParams): string {
  const msg = [...params.messages].reverse().find((m) => m.role === "user");
  return msg?.content ?? "";
}

function oneLine(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// ─────────────────────────────────────────────────────────────
// PLANNER output — valid per planContentSchema
// ─────────────────────────────────────────────────────────────

function buildPlan(goalRaw: string): string {
  const goal = oneLine(goalRaw, 200) || "Build the requested project";
  const kws = keywords(goalRaw);
  const focus = kws.slice(0, 3).join(", ") || "core features";
  const slug = slugify(goalRaw);

  const plan = {
    summary: `Plan for: ${goal}. The work is decomposed into design, database, backend, frontend, integration, testing, review and documentation tasks with explicit dependencies so independent streams run in parallel.`,
    userGoals: [
      goal,
      `Deliver a working, tested implementation covering ${focus}.`,
      "Keep the architecture simple enough for a small team to maintain.",
    ],
    functionalRequirements: [
      `Users can perform the primary workflow described by: ${oneLine(goalRaw, 80)}.`,
      `Core domain logic for ${focus} is implemented and covered by automated tests.`,
      "The interface exposes every feature through a clear, navigable UI.",
      "Data is persisted reliably and survives restarts.",
    ],
    nonFunctionalRequirements: [
      "Responses render in under 200ms for typical operations.",
      "The codebase follows strict TypeScript with no implicit any.",
      "All external inputs are validated at the boundary.",
    ],
    assumptions: [
      "A single-node deployment is sufficient for the first release.",
      "Users access the app through a modern evergreen browser.",
    ],
    constraints: [
      "No paid third-party services may be required to run the project.",
      "The first iteration ships without real-time collaboration.",
    ],
    proposedArchitecture: `A modular layered architecture for ${slug}: a domain layer owning the ${focus} logic, an application layer exposing use-cases, and a thin delivery layer (UI + API). Persistence is isolated behind a repository interface so the storage engine can be swapped.`,
    techChoices: [
      { name: "TypeScript", reason: "Type safety across the whole stack reduces integration bugs." },
      { name: "SQLite", reason: "Zero-config durable storage that matches a single-node deployment." },
      { name: "Vitest", reason: "Fast unit tests colocated with the source they verify." },
    ],
    workstreams: ["design", "data", "backend", "frontend", "quality", "docs"],
    tasks: [
      {
        id: "t1",
        title: `Design the ${slug} architecture`,
        description: `Produce the component breakdown, data flow and module boundaries for: ${goal}.`,
        dependsOn: [],
        role: "Solution architect",
        skills: ["system-design", "api-design"],
        parallelizable: true,
        taskType: "design",
      },
      {
        id: "t2",
        title: "Design the data model and schema",
        description: `Define entities, relationships and migrations needed to persist ${focus}.`,
        dependsOn: ["t1"],
        role: "Database engineer",
        skills: ["data-modeling", "sql"],
        parallelizable: true,
        taskType: "coding",
      },
      {
        id: "t3",
        title: "Implement the backend services",
        description: `Implement domain logic and API endpoints covering ${focus} on top of the schema from t2.`,
        dependsOn: ["t2"],
        role: "Backend engineer",
        skills: ["typescript", "api", "validation"],
        parallelizable: true,
        taskType: "coding",
      },
      {
        id: "t4",
        title: "Build the user interface",
        description: `Implement the screens and components for the primary workflow: ${oneLine(goalRaw, 80)}.`,
        dependsOn: ["t1"],
        role: "Frontend engineer",
        skills: ["react", "css", "accessibility"],
        parallelizable: true,
        taskType: "coding",
      },
      {
        id: "t5",
        title: "Integrate frontend with backend",
        description: "Wire the UI to the API, add loading/error states and end-to-end data flow.",
        dependsOn: ["t3", "t4"],
        role: "Full-stack engineer",
        skills: ["integration", "state-management"],
        parallelizable: false,
        taskType: "coding",
      },
      {
        id: "t6",
        title: "Write automated tests",
        description: `Unit-test the domain logic (${focus}) and add integration tests for the primary workflow.`,
        dependsOn: ["t5"],
        role: "QA engineer",
        skills: ["testing", "vitest"],
        parallelizable: true,
        taskType: "testing",
      },
      {
        id: "t7",
        title: "Review and harden the implementation",
        description: "Review the merged work for correctness, security issues and edge cases; fix findings.",
        dependsOn: ["t6"],
        role: "Staff reviewer",
        skills: ["code-review", "security"],
        parallelizable: false,
        taskType: "review",
      },
      {
        id: "t8",
        title: "Write user and developer documentation",
        description: `Document setup, usage and architecture decisions for ${slug} in the README and docs/.`,
        dependsOn: ["t5"],
        role: "Technical writer",
        skills: ["documentation", "markdown"],
        parallelizable: true,
        taskType: "documentation",
      },
    ],
    risks: [
      {
        risk: `Scope around ${focus} grows beyond the first iteration.`,
        mitigation: "Keep the task list as the contract; defer new ideas to a follow-up milestone.",
      },
      {
        risk: "Integration between frontend and backend reveals contract mismatches.",
        mitigation: "t5 owns the shared types; t6 verifies the integration with tests.",
      },
    ],
    testingStrategy: `Unit tests for every domain module (${focus}), integration tests over the API surface, and a final acceptance pass against the definition of done.`,
    securityConsiderations: [
      "Validate and sanitize all user input at the API boundary.",
      "Never log secrets or personal data.",
      "Parameterize all database queries.",
    ],
    deploymentStrategy: "Ship as a single self-contained service; run migrations at startup; document a one-command local setup.",
    definitionOfDone: [
      "All tasks t1–t8 are completed and reviewed.",
      "The test suite passes from a clean checkout.",
      `The primary workflow (${oneLine(goalRaw, 60)}) works end to end.`,
      "Documentation is complete enough for a new developer to run the project.",
    ],
  };
  return JSON.stringify(plan);
}

// ─────────────────────────────────────────────────────────────
// AGENT output — valid per agentActionSchema
// ─────────────────────────────────────────────────────────────

function codeFileFor(goal: string, slug: string, h: number, step: number): { path: string; content: string } {
  const kws = keywords(goal);
  const entity = kws[0] ?? "item";
  const Entity = entity.charAt(0).toUpperCase() + entity.slice(1);
  const pick = (h + step) % 5;

  if (pick === 0) {
    return {
      path: "README.md",
      content: [
        `# ${slug}`,
        "",
        `Goal: ${oneLine(goal, 160)}`,
        "",
        "## Overview",
        "",
        `This project implements ${kws.join(", ") || "the requested features"}.`,
        "It is organized into small, testable TypeScript modules under `src/`.",
        "",
        "## Development",
        "",
        "- `npm test` — run the test suite",
        "- `src/` — application source",
        "- `tests/` — unit tests",
        "",
      ].join("\n"),
    };
  }
  if (pick === 1) {
    return {
      path: `src/${slug}/store.ts`,
      content: [
        `/** In-memory store for ${entity} records (goal: ${oneLine(goal, 60)}). */`,
        `export interface ${Entity}Record {`,
        "  id: string;",
        "  title: string;",
        "  done: boolean;",
        "}",
        "",
        `export class ${Entity}Store {`,
        `  private records = new Map<string, ${Entity}Record>();`,
        "",
        `  add(record: ${Entity}Record): void {`,
        "    if (!record.id) throw new Error(\"id is required\");",
        "    this.records.set(record.id, record);",
        "  }",
        "",
        `  get(id: string): ${Entity}Record | undefined {`,
        "    return this.records.get(id);",
        "  }",
        "",
        `  list(): ${Entity}Record[] {`,
        "    return [...this.records.values()];",
        "  }",
        "",
        "  markDone(id: string): boolean {",
        "    const rec = this.records.get(id);",
        "    if (!rec) return false;",
        "    rec.done = true;",
        "    return true;",
        "  }",
        "}",
        "",
      ].join("\n"),
    };
  }
  if (pick === 2) {
    return {
      path: `src/${slug}/utils.ts`,
      content: [
        `/** Helpers for ${slug} (goal: ${oneLine(goal, 60)}). */`,
        "",
        "export function slugify(text: string): string {",
        "  return text",
        "    .toLowerCase()",
        "    .replace(/[^a-z0-9]+/g, \"-\")",
        "    .replace(/^-+|-+$/g, \"\");",
        "}",
        "",
        `export function isValid${Entity}Title(title: string): boolean {`,
        "  return title.trim().length >= 1 && title.length <= 200;",
        "}",
        "",
        "export function formatCount(n: number, noun: string): string {",
        "  return `${n} ${noun}${n === 1 ? \"\" : \"s\"}`;",
        "}",
        "",
      ].join("\n"),
    };
  }
  if (pick === 3) {
    return {
      path: `src/${slug}/index.ts`,
      content: [
        `/** Entry point for ${slug}: ${oneLine(goal, 70)} */`,
        `import { ${Entity}Store } from \"./store\";`,
        "",
        `export function createApp() {`,
        `  const store = new ${Entity}Store();`,
        "  return {",
        `    add(title: string) {`,
        "      const id = Math.random().toString(36).slice(2, 10);",
        "      store.add({ id, title, done: false });",
        "      return id;",
        "    },",
        "    complete(id: string) {",
        "      return store.markDone(id);",
        "    },",
        "    list() {",
        "      return store.list();",
        "    },",
        "  };",
        "}",
        "",
      ].join("\n"),
    };
  }
  return {
    path: `tests/${slug}.test.ts`,
    content: [
      `import { describe, expect, it } from \"vitest\";`,
      `import { createApp } from \"../src/${slug}/index\";`,
      "",
      `describe(\"${slug}\", () => {`,
      `  it(\"supports the core ${entity} workflow\", () => {`,
      "    const app = createApp();",
      `    const id = app.add(\"write ${entity} module\");`,
      "    expect(app.list()).toHaveLength(1);",
      "    expect(app.complete(id)).toBe(true);",
      "    expect(app.list()[0].done).toBe(true);",
      "  });",
      "});",
      "",
    ].join("\n"),
  };
}

const BUBBLES = [
  "Writing API routes",
  "Sketching the data model",
  "Implementing core logic",
  "Wiring up components",
  "Adding validation",
  "Drafting tests",
];

function buildAgentAction(params: ChatParams): string {
  const lastUser = lastUserMessage(params);
  const goal = lastUser || "the assigned task";
  const slug = slugify(goal, "feature");
  const h = hash(lastUser);
  const priorAssistant = params.messages.filter((m) => m.role === "assistant");
  const step = priorAssistant.length;
  const alreadyProposed = priorAssistant.some((m) => m.content.includes("\"tool_propose\""));
  const toolStep = 1 + (h % 3); // 1..3 — deterministic per conversation

  let action: Record<string, unknown>;

  if (step >= 5) {
    action = {
      type: "task_complete",
      result: `Completed the work for: ${oneLine(goal, 90)}. Files were written, tests added and the coordinator was kept informed.`,
      confidence: 0.85,
    };
  } else if (step === 0) {
    action = { type: "status", bubble: BUBBLES[h % BUBBLES.length] };
  } else if (!alreadyProposed && step === toolStep) {
    const useCsv = h % 2 === 1;
    action = useCsv
      ? {
          type: "tool_propose",
          name: "csv_parse",
          description: "Parse CSV text into an array of row objects keyed by the header line.",
          toolType: "js_function",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          },
          permissions: [],
          sourceCode: [
            "module.exports = function (input) {",
            "  const lines = String(input.text || \"\").trim().split(/\\r?\\n/);",
            "  if (lines.length === 0) return [];",
            "  const headers = lines[0].split(\",\").map((h) => h.trim());",
            "  return lines.slice(1).map((line) => {",
            "    const cells = line.split(\",\");",
            "    const row = {};",
            "    headers.forEach((h, i) => { row[h] = (cells[i] || \"\").trim(); });",
            "    return row;",
            "  });",
            "};",
            "",
          ].join("\n"),
          testCode: [
            "const rows = tool({ text: \"name,age\\nAda,36\\nAlan,41\" });",
            "assert.equal(rows.length, 2, \"parses two rows\");",
            "assert.equal(rows[0].name, \"Ada\", \"maps header keys\");",
            "assert.equal(rows[1].age, \"41\", \"keeps cell values\");",
            "",
          ].join("\n"),
          reason: `Importing tabular data may be needed for: ${oneLine(goal, 60)}.`,
        }
      : {
          type: "tool_propose",
          name: "slugify",
          description: "Convert arbitrary text into a lowercase URL-safe slug.",
          toolType: "js_function",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          },
          permissions: [],
          sourceCode: [
            "module.exports = function (input) {",
            "  return String(input.text || \"\")",
            "    .toLowerCase()",
            "    .replace(/[^a-z0-9]+/g, \"-\")",
            "    .replace(/^-+|-+$/g, \"\");",
            "};",
            "",
          ].join("\n"),
          testCode: [
            "assert.equal(tool({ text: \"Hello World!\" }), \"hello-world\", \"basic slug\");",
            "assert.equal(tool({ text: \"  --Weird__Input-- \" }), \"weird-input\", \"strips junk\");",
            "",
          ].join("\n"),
          reason: `Stable slugs are useful across the files produced for: ${oneLine(goal, 60)}.`,
        };
  } else if (step === 3) {
    action = {
      type: "message",
      to: "coordinator",
      summary: `Progress on ${oneLine(goal, 60)}: core files are in place; continuing with the remaining modules.`,
      payload: { filesWritten: Math.min(step, 2) },
      confidence: 0.7,
      requestedAction: "",
    };
  } else {
    const file = codeFileFor(goal, slug, h, step);
    action = {
      type: "file_write",
      path: file.path,
      content: file.content,
      summary: `Write ${file.path} for ${oneLine(goal, 50)}`,
    };
  }

  return JSON.stringify(action);
}

// ─────────────────────────────────────────────────────────────
// Chat fallback
// ─────────────────────────────────────────────────────────────

function buildChatReply(params: ChatParams): string {
  const lastUser = lastUserMessage(params);
  const exchanges = params.messages.filter((m) => m.role === "user").length;
  const kws = keywords(lastUser);
  const topic = kws.slice(0, 4).join(", ") || oneLine(lastUser, 60) || "your request";
  return [
    `Here's a take on **${topic}** (offline mock model — no external API involved).`,
    "",
    `- You asked: "${oneLine(lastUser, 140)}"`,
    `- This is message #${exchanges} in our conversation, so I'm answering with the full thread in mind.`,
    kws.length > 0
      ? `- The key themes I picked up: ${kws.map((k) => `\`${k}\``).join(", ")}.`
      : "- Your message was short, so I'm keeping the answer general.",
    "",
    `A good next step would be to break "${oneLine(lastUser, 60)}" into small, verifiable pieces — happy to keep going in this thread.`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────

function generateContent(params: ChatParams): string {
  const sys = systemPrompt(params);
  if (params.jsonMode && sys.includes("PLANNER")) return buildPlan(lastUserMessage(params));
  if (params.jsonMode && /(^|\n)\s*AGENT\s/.test(sys)) return buildAgentAction(params);
  return buildChatReply(params);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockProvider implements ProviderAdapter {
  readonly provider = "mock";

  async listModels(): Promise<ModelInfo[]> {
    return MOCK_MODELS;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }

  async complete(
    _config: ProviderConnectionConfig,
    params: ChatParams
  ): Promise<{ content: string; tokensIn: number; tokensOut: number }> {
    const content = generateContent(params);
    const input = params.messages.map((m) => m.content).join("\n");
    return {
      content,
      tokensIn: estimateTokens(input),
      tokensOut: estimateTokens(content),
    };
  }

  async *stream(
    _config: ProviderConnectionConfig,
    params: ChatParams
  ): AsyncGenerator<ChatChunk, void, unknown> {
    if (params.signal?.aborted) return;
    const content = generateContent(params);
    const input = params.messages.map((m) => m.content).join("\n");

    if (params.jsonMode) {
      // JSON payloads go out in a few larger chunks.
      const chunks = 3;
      const size = Math.ceil(content.length / chunks);
      for (let i = 0; i < content.length; i += size) {
        yield { delta: content.slice(i, i + size), done: false };
      }
    } else {
      // Word-by-word streaming, ~8ms apart.
      const words = content.split(/(?<=\s)/);
      for (const word of words) {
        if (params.signal?.aborted) return;
        yield { delta: word, done: false };
        await sleep(STREAM_WORD_DELAY_MS);
      }
    }
    yield {
      delta: "",
      done: true,
      usage: { tokensIn: estimateTokens(input), tokensOut: estimateTokens(content) },
    };
  }
}

export const mockProvider = new MockProvider();
