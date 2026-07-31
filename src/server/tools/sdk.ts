import { z } from "zod";
import type { AutonomyMode, RiskLevel, ToolPermission, ToolSpec } from "@/types";
import { HIGH_RISK_PERMISSIONS } from "@/types";

/**
 * Tool SDK (SPEC §4.8) — validation, risk classification, approval policy
 * for agent-authored tools.
 */

const TOOL_TYPES = [
  "js_function",
  "http",
  "shell",
  "file_transform",
  "search",
  "code_analysis",
  "automation",
] as const;

const TOOL_PERMISSIONS = [
  "network",
  "secrets",
  "package_install",
  "db_write",
  "file_delete",
  "shell",
  "deploy",
  "git_push",
  "filesystem",
] as const;

const toolSpecSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z][a-z0-9_]{2,40}$/, "name must match /^[a-z][a-z0-9_]{2,40}$/"),
  description: z.string().default(""),
  version: z.number().int().positive().default(1),
  type: z.enum(TOOL_TYPES),
  inputSchema: z.record(z.unknown()).default({}),
  outputSchema: z.record(z.unknown()).default({}),
  permissions: z.array(z.enum(TOOL_PERMISSIONS)).default([]),
  sourceCode: z.string().min(1, "sourceCode is required"),
  testCode: z.string().default(""),
  riskLevel: z.enum(["low", "medium", "high"]).default("low"),
  timeoutMs: z.number().int().positive().max(120000).default(10000),
});

/** Validate unknown input into a ToolSpec; throws ZodError on failure. */
export function validateToolSpec(input: unknown): ToolSpec {
  return toolSpecSchema.parse(input) as ToolSpec;
}

const HIGH_RISK_SOURCE = /(child_process|fs\.rm|rm -rf|fetch\(|http)/;
const MEDIUM_RISK_SOURCE = /(process\.env|eval\(|new Function|fs\.(write|append|unlink|rename))/;

/**
 * Risk classification:
 * - high: any HIGH_RISK_PERMISSION, or source matching dangerous patterns.
 * - medium: any (non-high) permission declared, or moderately sensitive source.
 * - low: everything else.
 */
export function classifyRisk(spec: {
  permissions: ToolPermission[];
  sourceCode: string;
}): RiskLevel {
  if (spec.permissions.some((p) => HIGH_RISK_PERMISSIONS.includes(p))) return "high";
  if (HIGH_RISK_SOURCE.test(spec.sourceCode)) return "high";
  if (spec.permissions.length > 0) return "medium";
  if (MEDIUM_RISK_SOURCE.test(spec.sourceCode)) return "medium";
  return "low";
}

/**
 * Approval policy by autonomy mode:
 * - high risk: always requires approval.
 * - medium: unless autonomy is "auto".
 * - low: only when autonomy is "ask_all".
 * ("observe" never auto-executes: everything requires approval.)
 */
export function requiresApproval(risk: RiskLevel, autonomy: AutonomyMode): boolean {
  if (risk === "high") return true;
  if (risk === "medium") return autonomy !== "auto";
  return autonomy === "ask_all" || autonomy === "observe";
}
