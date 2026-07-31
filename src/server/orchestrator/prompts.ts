import type { PlanTask } from "@/types";

/**
 * System prompt builders (SPEC §4.6).
 *
 * Hard rules baked into every prompt:
 * - The model answers with exactly ONE JSON object — no markdown prose,
 *   no commentary, no chain-of-thought. We never request or display
 *   chain-of-thought; bubble texts are short user-safe activity summaries.
 * - The schema shape is embedded textually so schema-less models (mock,
 *   small local models) still produce valid output.
 */

const PLAN_SCHEMA_SHAPE = `{
  "summary": string,                       // one-paragraph plan overview
  "userGoals": string[],
  "functionalRequirements": string[],
  "nonFunctionalRequirements": string[],
  "assumptions": string[],
  "constraints": string[],
  "proposedArchitecture": string,
  "techChoices": [{ "name": string, "reason": string }],
  "workstreams": string[],
  "tasks": [                               // at least 1
    {
      "id": string,                        // short stable id, e.g. "t1"
      "title": string,
      "description": string,
      "dependsOn": string[],               // ids of tasks that must finish first; [] for roots
      "role": string,                      // dynamic role name, e.g. "Frontend engineer"
      "skills": string[],
      "parallelizable": boolean,
      "taskType": "planning" | "coding" | "review" | "documentation" | "design" | "testing" | "research" | "general"
    }
  ],
  "risks": [{ "risk": string, "mitigation": string }],
  "testingStrategy": string,
  "securityConsiderations": string[],
  "deploymentStrategy": string,
  "definitionOfDone": string[]
}`;

const ACTION_SCHEMA_SHAPE = `Exactly one of these action objects:
{ "type": "status", "bubble": string }                    // ≤120 chars, user-safe progress note
{ "type": "message", "to": string, "summary": string, "payload": object, "confidence": number, "requestedAction": string }
{ "type": "file_write", "path": string, "content": string, "summary": string }
{ "type": "tool_call", "toolName": string, "input": object, "reason": string }
{ "type": "tool_propose", "name": string, "description": string, "toolType": "js_function"|"http"|"shell"|"file_transform"|"search"|"code_analysis"|"automation", "inputSchema": object, "permissions": string[], "sourceCode": string, "testCode": string, "reason": string }
{ "type": "recruit_request", "role": string, "reason": string, "taskType": string }
{ "type": "task_complete", "result": string, "confidence": number }
{ "type": "task_failed", "error": string, "retryable": boolean }`;

export function plannerSystemPrompt(): string {
  return `PLANNER — you are the planning brain of Swarmwright, an autonomous multi-agent development workspace.

Your job: turn a user's goal into one structured execution plan for an agent swarm.

RULES (strict):
1. Reply with EXACTLY ONE JSON object matching the schema below. No markdown fences, no commentary, no explanation before or after.
2. NEVER reveal chain-of-thought. The "summary" and descriptions are concise, user-safe statements of intent only.
3. Break the goal into 6–10 concrete tasks covering (as relevant) design, frontend, backend, database, tests, review, and documentation. Use dependsOn to express real prerequisites (e.g. tests depend on code, docs depend on implementation). Tasks whose dependsOn are disjoint must be parallelizable.
4. Task ids must be short, unique and stable ("t1", "t2", ...). dependsOn may only reference ids defined in the same plan and must not form cycles.
5. Every task gets a specific dynamic role name (e.g. "Database engineer") and the most fitting taskType from the enum.
6. Keep strings under ~400 characters each.

SCHEMA (JSON object, all top-level keys required; arrays may be empty except "tasks"):
${PLAN_SCHEMA_SHAPE}

Reply now with the single JSON plan object and nothing else.`;
}

export interface AgentTaskBrief {
  title: string;
  description?: string;
  role?: string;
}

/**
 * Agent system prompt. MUST start with the exact token `AGENT <role>` —
 * providers (including the deterministic mock) key off this prefix.
 */
export function agentSystemPrompt(role: string, task: AgentTaskBrief, context: string): string {
  return `AGENT ${role} — you are a specialist agent inside a Swarmwright autonomous run.

YOUR TASK: ${task.title}
${task.description ? `TASK DETAILS: ${task.description}\n` : ""}
PROTOCOL (strict):
1. Reply with EXACTLY ONE JSON action object per response. No prose, no markdown fences, no multiple actions.
2. NEVER reveal chain-of-thought. "bubble" and "summary" fields are short, user-safe activity descriptions (what you are doing, never how you reason), bubble ≤ 120 characters.
3. Make progress every step: write real file content with file_write (relative project paths, no "..", no absolute paths), coordinate via message, and finish with task_complete as soon as the task's definition of done is met. Use task_failed only when truly blocked.
4. Only propose or call tools when they are genuinely needed; keep tool source code small and self-contained.
5. If another agent's message in the context asks you something, answer with a message action addressed back to them.

ACTION SCHEMA:
${ACTION_SCHEMA_SHAPE}

Examples of valid replies:
{"type":"status","bubble":"Drafting the schema for the data model"}
{"type":"file_write","path":"src/schema.ts","content":"export const version = 1;\\n","summary":"Initial schema module"}
{"type":"message","to":"coordinator","summary":"Schema ready for review","payload":{"path":"src/schema.ts"},"confidence":0.9,"requestedAction":"review"}
{"type":"task_complete","result":"Created src/schema.ts with the initial data model","confidence":0.85}

CONTEXT (memory and inbox excerpts relevant to your task):
${context.trim() || "(no prior context)"}

Reply now with exactly one JSON action object and nothing else.`;
}
