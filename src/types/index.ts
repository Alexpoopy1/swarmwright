/**
 * Swarmwright shared contracts.
 *
 * This file is the single source of truth for cross-module interfaces.
 * DO NOT change exported signatures without updating SPEC.md.
 */
import { z } from "zod";

// ─────────────────────────────────────────────────────────────
// Enums / string unions
// ─────────────────────────────────────────────────────────────

export type RunStatus =
  | "queued"
  | "planning"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "stopped";

export type AutonomyMode = "observe" | "ask_all" | "ask_risky" | "auto";

export type AgentStatus =
  | "idle"
  | "active"
  | "waiting"
  | "paused"
  | "failed"
  | "completed"
  | "removed";

export type TaskStatus =
  | "pending"
  | "blocked"
  | "active"
  | "completed"
  | "failed"
  | "cancelled";

export type RiskLevel = "low" | "medium" | "high";

export type ToolType =
  | "js_function"
  | "http"
  | "shell"
  | "file_transform"
  | "search"
  | "code_analysis"
  | "automation";

export type ToolPermission =
  | "network"
  | "secrets"
  | "package_install"
  | "db_write"
  | "file_delete"
  | "shell"
  | "deploy"
  | "git_push"
  | "filesystem";

export const HIGH_RISK_PERMISSIONS: ToolPermission[] = [
  "network",
  "secrets",
  "package_install",
  "db_write",
  "file_delete",
  "shell",
  "deploy",
  "git_push",
];

export type MemoryScope =
  | "conversation"
  | "agent"
  | "run"
  | "project"
  | "longterm"
  | "tool_perf";

export type PlanMode = "plan_only" | "plan_approve" | "auto";

export type EventActorType = "system" | "agent" | "user" | "coordinator";

// ─────────────────────────────────────────────────────────────
// Event model (event sourcing — powers the Swarm Time Machine)
// ─────────────────────────────────────────────────────────────

export const EVENT_TYPES = [
  "RUN_CREATED",
  "RUN_PAUSED",
  "RUN_RESUMED",
  "RUN_COMPLETED",
  "RUN_FAILED",
  "RUN_STOPPED",
  "RUN_FORKED",
  "PLAN_CREATED",
  "PLAN_EDITED",
  "PLAN_APPROVED",
  "PLAN_REJECTED",
  "AGENT_CREATED",
  "AGENT_STARTED",
  "AGENT_PAUSED",
  "AGENT_RESUMED",
  "AGENT_COMPLETED",
  "AGENT_FAILED",
  "AGENT_RECRUITED",
  "AGENT_REMOVED",
  "AGENT_MESSAGE",
  "TASK_CREATED",
  "TASK_STARTED",
  "TASK_BLOCKED",
  "TASK_COMPLETED",
  "TASK_FAILED",
  "TASK_RETRIED",
  "TOOL_PROPOSED",
  "TOOL_APPROVAL_REQUIRED",
  "TOOL_APPROVED",
  "TOOL_REJECTED",
  "TOOL_STARTED",
  "TOOL_COMPLETED",
  "TOOL_FAILED",
  "TOOL_REGISTERED",
  "FILE_CREATED",
  "FILE_UPDATED",
  "TEST_STARTED",
  "TEST_COMPLETED",
  "CHECKPOINT_CREATED",
  "APPROVAL_REQUESTED",
  "APPROVAL_RESOLVED",
  "BUDGET_WARNING",
  "BUDGET_EXCEEDED",
  "GENOME_UPDATED",
  "MEMORY_SAVED",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface SwarmEvent<T = unknown> {
  /** Monotonic sequence (DB autoincrement id). */
  seq: number;
  runId: string | null;
  projectId: string | null;
  type: EventType;
  actorType: EventActorType;
  actorId: string | null;
  /** One-line, user-safe activity summary. Never chain-of-thought. */
  summary: string;
  payload: T;
  createdAt: string; // ISO
}

// ─────────────────────────────────────────────────────────────
// Provider layer
// ─────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
}

export interface ChatChunk {
  /** Incremental text delta. */
  delta: string;
  done: boolean;
  /** Present on the final chunk when known. */
  usage?: { tokensIn: number; tokensOut: number };
}

export interface ModelInfo {
  provider: string;
  model: string;
  label: string;
  contextLimit: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  inputPer1k: number;
  outputPer1k: number;
}

export interface ChatParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider to emit strict JSON. */
  jsonMode?: boolean;
  signal?: AbortSignal;
}

export interface ProviderConnectionConfig {
  id: string;
  provider: string;
  label: string;
  baseUrl?: string | null;
  /** Decrypted secret — server-side only, never serialized to the client. */
  apiKey?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Normalized adapter interface implemented by every provider.
 */
export interface ProviderAdapter {
  readonly provider: string;
  listModels(config: ProviderConnectionConfig): Promise<ModelInfo[]>;
  testConnection(config: ProviderConnectionConfig): Promise<{ ok: boolean; error?: string }>;
  complete(config: ProviderConnectionConfig, params: ChatParams): Promise<{
    content: string;
    tokensIn: number;
    tokensOut: number;
  }>;
  stream(
    config: ProviderConnectionConfig,
    params: ChatParams
  ): AsyncGenerator<ChatChunk, void, unknown>;
}

// ─────────────────────────────────────────────────────────────
// Model routing
// ─────────────────────────────────────────────────────────────

export interface TaskProfile {
  taskType:
    | "planning"
    | "coding"
    | "review"
    | "documentation"
    | "design"
    | "testing"
    | "research"
    | "general";
  needsTools?: boolean;
  needsVision?: boolean;
  minContext?: number;
  /** 0 = cheapest, 1 = best quality */
  qualityWeight?: number;
  /** Optional hard override. */
  forceProvider?: string;
  forceModel?: string;
}

export interface RouteDecision {
  provider: string;
  model: string;
  connectionId: string;
  reason: string;
  score: number;
}

// ─────────────────────────────────────────────────────────────
// Planner output (validated with zod — never trust raw model JSON)
// ─────────────────────────────────────────────────────────────

export const planTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().default(""),
  /** ids of tasks that must complete first */
  dependsOn: z.array(z.string()).default([]),
  /** dynamic role name, e.g. "Frontend engineer" */
  role: z.string(),
  skills: z.array(z.string()).default([]),
  parallelizable: z.boolean().default(true),
  taskType: z
    .enum(["planning", "coding", "review", "documentation", "design", "testing", "research", "general"])
    .default("general"),
});

export const planContentSchema = z.object({
  summary: z.string(),
  userGoals: z.array(z.string()).default([]),
  functionalRequirements: z.array(z.string()).default([]),
  nonFunctionalRequirements: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  proposedArchitecture: z.string().default(""),
  techChoices: z.array(z.object({ name: z.string(), reason: z.string() })).default([]),
  workstreams: z.array(z.string()).default([]),
  tasks: z.array(planTaskSchema).min(1),
  risks: z.array(z.object({ risk: z.string(), mitigation: z.string() })).default([]),
  testingStrategy: z.string().default(""),
  securityConsiderations: z.array(z.string()).default([]),
  deploymentStrategy: z.string().default(""),
  definitionOfDone: z.array(z.string()).default([]),
});

export type PlanTask = z.infer<typeof planTaskSchema>;
export type PlanContent = z.infer<typeof planContentSchema>;

// ─────────────────────────────────────────────────────────────
// Agent loop protocol — the model must answer with ONE action
// ─────────────────────────────────────────────────────────────

export const agentActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status"),
    /** user-safe activity bubble text, e.g. "Reviewing schema" */
    bubble: z.string().max(120),
  }),
  z.object({
    type: z.literal("message"),
    to: z.string(), // agent id, role name, or "coordinator"
    summary: z.string(),
    payload: z.record(z.unknown()).default({}),
    confidence: z.number().min(0).max(1).default(0.5),
    requestedAction: z.string().default(""),
  }),
  z.object({
    type: z.literal("file_write"),
    path: z.string(),
    content: z.string(),
    summary: z.string().default(""),
  }),
  z.object({
    type: z.literal("tool_call"),
    toolName: z.string(),
    input: z.record(z.unknown()).default({}),
    reason: z.string().default(""),
  }),
  z.object({
    type: z.literal("tool_propose"),
    name: z.string(),
    description: z.string(),
    toolType: z.enum([
      "js_function",
      "http",
      "shell",
      "file_transform",
      "search",
      "code_analysis",
      "automation",
    ]),
    inputSchema: z.record(z.unknown()).default({}),
    permissions: z.array(z.string()).default([]),
    sourceCode: z.string(),
    testCode: z.string().default(""),
    reason: z.string().default(""),
  }),
  z.object({
    type: z.literal("recruit_request"),
    role: z.string(),
    reason: z.string(),
    taskType: z
      .enum(["planning", "coding", "review", "documentation", "design", "testing", "research", "general"])
      .default("general"),
  }),
  z.object({
    type: z.literal("task_complete"),
    result: z.string(),
    confidence: z.number().min(0).max(1).default(0.8),
  }),
  z.object({
    type: z.literal("task_failed"),
    error: z.string(),
    retryable: z.boolean().default(true),
  }),
]);

export type AgentAction = z.infer<typeof agentActionSchema>;

export interface AgentStepResult {
  action: AgentAction;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

// ─────────────────────────────────────────────────────────────
// Orchestrator state (checkpoint snapshots)
// ─────────────────────────────────────────────────────────────

export interface RunSnapshot {
  runId: string;
  status: RunStatus;
  goal: string;
  plan: PlanContent | null;
  taskStates: Array<{
    id: string;
    title: string;
    status: TaskStatus;
    agentId: string | null;
    attempts: number;
    result?: string | null;
  }>;
  agentStates: Array<{
    id: string;
    name: string;
    role: string;
    status: AgentStatus;
    provider: string;
    model: string;
    genomeId: string | null;
  }>;
  costUsd: number;
  tokensUsed: number;
  eventSeq: number;
  instructionOverride?: string;
  createdAt: string;
}

export interface RunLimits {
  budgetUsd: number;
  tokenLimit: number;
  timeLimitSec: number;
  maxAgents: number;
  maxConcurrentAgents?: number;
  maxRetries?: number;
}

export interface StartRunInput {
  projectId: string;
  goal: string;
  mode: PlanMode;
  autonomy: AutonomyMode;
  limits?: Partial<RunLimits>;
  planOverride?: PlanContent;
  instructionOverride?: string;
}

// ─────────────────────────────────────────────────────────────
// Tool SDK
// ─────────────────────────────────────────────────────────────

export interface ToolSpec {
  name: string;
  description: string;
  version: number;
  type: ToolType;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  permissions: ToolPermission[];
  sourceCode: string;
  testCode: string;
  riskLevel: RiskLevel;
  timeoutMs: number;
}

export interface ToolRunResult {
  ok: boolean;
  output?: unknown;
  error?: string;
  logs: string[];
  durationMs: number;
}

export interface SandboxPolicy {
  timeoutMs: number;
  memoryMb: number;
  network: "allow" | "deny";
  allowedPaths: string[];
  deniedCommands: string[];
}

/** Adapter so stronger remote sandboxes can be plugged in later. */
export interface SandboxAdapter {
  readonly name: string;
  runJs(sourceCode: string, input: unknown, policy: SandboxPolicy): Promise<ToolRunResult>;
  runTests(sourceCode: string, testCode: string, policy: SandboxPolicy): Promise<ToolRunResult>;
}

// ─────────────────────────────────────────────────────────────
// API DTOs (client ↔ server)
// ─────────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  code?: string;
}

export interface UsageSummary {
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  byProvider: Array<{ provider: string; costUsd: number; tokens: number }>;
  byModel: Array<{ provider: string; model: string; costUsd: number; tokens: number }>;
  byRun: Array<{ runId: string; goal: string; costUsd: number; tokens: number }>;
  toolExecutions: number;
  retries: number;
}
