/**
 * Shared DTO types + status/event metadata for the agentic workspace
 * (src/components/swarm + src/app/app/runs + src/app/app/chat).
 *
 * DTOs mirror the API surface of SPEC §5. JSON-string columns from Prisma
 * (contentJson, dependsJson, detailJson, metadataJson) may arrive either
 * parsed or serialized depending on the route — use `parseJsonField` to
 * normalize defensively.
 */
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock,
  Loader2,
  OctagonX,
  PauseCircle,
  PlayCircle,
  XCircle,
} from "lucide-react";
import type {
  AgentStatus,
  EventType,
  PlanContent,
  RunStatus,
  TaskStatus,
} from "@/types";

// ─────────────────────────────────────────────────────────────
// JSON field normalization
// ─────────────────────────────────────────────────────────────

export function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

// ─────────────────────────────────────────────────────────────
// API DTOs (SPEC §5 route responses)
// ─────────────────────────────────────────────────────────────

export interface ProjectDto {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface RunListItemDto {
  id: string;
  projectId: string;
  goal: string;
  status: RunStatus;
  autonomy: string;
  branchOfId: string | null;
  budgetUsd: number;
  tokenLimit: number;
  costUsd: number;
  tokensUsed: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  _count?: { agents?: number; tasks?: number };
  agents?: unknown[];
  tasks?: unknown[];
  project?: { name: string } | null;
}

export interface AgentDto {
  id: string;
  runId: string;
  name: string;
  role: string;
  provider: string;
  model: string;
  status: AgentStatus;
  genomeId: string | null;
  summary: string;
  confidence: number;
  recruited: boolean;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  createdAt: string;
  endedAt: string | null;
}

export interface TaskDto {
  id: string;
  runId: string;
  title: string;
  description: string;
  status: TaskStatus;
  dependsJson: unknown; // string | string[]
  agentId: string | null;
  priority: number;
  attempts: number;
  maxAttempts: number;
  result: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ApprovalDto {
  id: string;
  runId: string;
  agentId: string | null;
  kind: string;
  title: string;
  detailJson: unknown; // string | object
  riskLevel: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
}

export interface PlanDto {
  id: string;
  runId: string | null;
  goal: string;
  summary: string;
  contentJson: unknown; // string | PlanContent
  status: "draft" | "awaiting_approval" | "approved" | "rejected" | "executing" | "completed";
  mode: "plan_only" | "plan_approve" | "auto";
  createdAt: string;
}

export interface CheckpointDto {
  id: string;
  runId: string;
  label: string;
  eventSeq: number;
  createdAt: string;
}

export interface RunDetailDto {
  run: RunListItemDto & { maxAgents: number; timeLimitSec: number };
  plan: PlanDto | null;
  agents: AgentDto[];
  tasks: TaskDto[];
  approvals: ApprovalDto[];
  latestCheckpoint: CheckpointDto | null;
  checkpoints?: CheckpointDto[];
  cost?: number;
  forks?: Array<{ id: string; status: RunStatus; goal: string; createdAt: string }>;
}

export interface ConversationDto {
  id: string;
  title: string;
  mode: "chat" | "council";
  archived: boolean;
  projectId: string | null;
  createdAt: string;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  provider: string | null;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  parentId: string | null;
  metadataJson: unknown;
  createdAt: string;
}

export interface ConversationDetailDto extends ConversationDto {
  messages: MessageDto[];
}

export interface ProviderConnectionDto {
  id: string;
  provider: string;
  label: string;
  baseUrl: string | null;
  status: "untested" | "ok" | "failed";
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────
// Status metadata (color + icon — never color alone, SPEC §6.1)
// ─────────────────────────────────────────────────────────────

export type Tone = "copper" | "sage" | "ember" | "stone" | "amber";

export interface StatusMeta {
  tone: Tone;
  label: string;
  icon: LucideIcon;
  /** hex for canvas/SVG fills (Tailwind palette values) */
  hex: string;
}

export const HEX = {
  copper: "#c97c43",
  copperLight: "#dd9660",
  sage: "#6f9470",
  ember: "#c9573f",
  stone: "#a8a29e",
  stoneDim: "#78716c",
  amber: "#d19a4a",
  ink: "#2a2820",
} as const;

export const RUN_STATUS_META: Record<RunStatus, StatusMeta> = {
  queued: { tone: "stone", label: "Queued", icon: Clock, hex: HEX.stone },
  planning: { tone: "copper", label: "Planning", icon: Loader2, hex: HEX.copper },
  running: { tone: "copper", label: "Running", icon: PlayCircle, hex: HEX.copper },
  paused: { tone: "stone", label: "Paused", icon: PauseCircle, hex: HEX.stone },
  awaiting_approval: { tone: "amber", label: "Awaiting approval", icon: AlertTriangle, hex: HEX.amber },
  completed: { tone: "sage", label: "Completed", icon: CheckCircle2, hex: HEX.sage },
  failed: { tone: "ember", label: "Failed", icon: XCircle, hex: HEX.ember },
  stopped: { tone: "stone", label: "Stopped", icon: OctagonX, hex: HEX.stoneDim },
};

export const AGENT_STATUS_META: Record<AgentStatus, StatusMeta> = {
  idle: { tone: "stone", label: "Idle", icon: Circle, hex: HEX.stoneDim },
  active: { tone: "copper", label: "Active", icon: CircleDot, hex: HEX.copper },
  waiting: { tone: "stone", label: "Waiting", icon: Clock, hex: HEX.stone },
  paused: { tone: "stone", label: "Paused", icon: PauseCircle, hex: HEX.stone },
  failed: { tone: "ember", label: "Failed", icon: XCircle, hex: HEX.ember },
  completed: { tone: "sage", label: "Completed", icon: CheckCircle2, hex: HEX.sage },
  removed: { tone: "stone", label: "Removed", icon: OctagonX, hex: HEX.stoneDim },
};

export const TASK_STATUS_META: Record<TaskStatus, StatusMeta> = {
  pending: { tone: "stone", label: "Pending", icon: Circle, hex: HEX.stoneDim },
  blocked: { tone: "amber", label: "Blocked", icon: AlertTriangle, hex: HEX.amber },
  active: { tone: "copper", label: "Active", icon: CircleDot, hex: HEX.copper },
  completed: { tone: "sage", label: "Completed", icon: CheckCircle2, hex: HEX.sage },
  failed: { tone: "ember", label: "Failed", icon: XCircle, hex: HEX.ember },
  cancelled: { tone: "stone", label: "Cancelled", icon: OctagonX, hex: HEX.stoneDim },
};

export const RISK_TONE: Record<string, Tone> = {
  low: "sage",
  medium: "amber",
  high: "ember",
};

// ─────────────────────────────────────────────────────────────
// Event categorization (EventStream filters + badge tones)
// ─────────────────────────────────────────────────────────────

export type EventCategory =
  | "RUN"
  | "PLAN"
  | "AGENT"
  | "TASK"
  | "TOOL"
  | "FILE"
  | "APPROVAL"
  | "BUDGET"
  | "OTHER";

export function eventCategory(type: EventType): EventCategory {
  if (type.startsWith("RUN_")) return "RUN";
  if (type.startsWith("PLAN_")) return "PLAN";
  if (type.startsWith("AGENT_")) return "AGENT";
  if (type.startsWith("TASK_")) return "TASK";
  if (type.startsWith("TOOL_") || type.startsWith("TEST_")) return "TOOL";
  if (type.startsWith("FILE_")) return "FILE";
  if (type.startsWith("APPROVAL_")) return "APPROVAL";
  if (type.startsWith("BUDGET_")) return "BUDGET";
  return "OTHER";
}

export const CATEGORY_TONE: Record<EventCategory, Tone> = {
  RUN: "copper",
  PLAN: "copper",
  AGENT: "sage",
  TASK: "stone",
  TOOL: "amber",
  FILE: "stone",
  APPROVAL: "ember",
  BUDGET: "ember",
  OTHER: "stone",
};

export const EVENT_CATEGORIES: EventCategory[] = [
  "RUN",
  "PLAN",
  "AGENT",
  "TASK",
  "TOOL",
  "FILE",
  "APPROVAL",
  "BUDGET",
  "OTHER",
];
