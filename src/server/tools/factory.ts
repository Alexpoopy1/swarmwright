import type { AgentAction, AutonomyMode, ToolRunResult, ToolType } from "@/types";
import { db } from "@/server/db";
import { fromJson, toJson } from "@/server/json";
import { emitEvent } from "@/server/events/store";
import { classifyRisk, requiresApproval, validateToolSpec } from "@/server/tools/sdk";
import { defaultPolicy, getSandbox } from "@/server/tools/sandbox";

/**
 * Tool factory (SPEC §4.8) — the pipeline that turns an agent's tool_propose
 * action into a validated, sandbox-tested, approval-gated ToolDefinition,
 * and executes approved tools with full audit (ToolExecution rows + events).
 */

type ToolProposePayload = Extract<AgentAction, { type: "tool_propose" }>;

/** Naive deterministic repair: ensure the CommonJS export convention. */
function repairSource(sourceCode: string, name: string): string {
  if (/module\.exports\s*=|exports\.default\s*=/.test(sourceCode)) return sourceCode;
  // Common agent mistake: declared a function but never exported it.
  const fnMatch = sourceCode.match(/function\s+([a-zA-Z_$][\w$]*)\s*\(/);
  const exportName = fnMatch?.[1] ?? name;
  return `${sourceCode}\nmodule.exports = ${exportName};\n`;
}

export async function proposeTool(args: {
  projectId: string;
  runId?: string;
  agentId?: string;
  proposal: ToolProposePayload;
  autonomy: AutonomyMode;
}): Promise<{ toolId: string; status: string }> {
  const { proposal } = args;
  const spec = validateToolSpec({
    name: proposal.name,
    description: proposal.description,
    version: 1,
    type: proposal.toolType as ToolType,
    inputSchema: proposal.inputSchema,
    outputSchema: {},
    permissions: proposal.permissions,
    sourceCode: proposal.sourceCode,
    testCode: proposal.testCode,
    timeoutMs: 10000,
  });
  const riskLevel = classifyRisk(spec);

  const tool = await db.toolDefinition.create({
    data: {
      projectId: args.projectId,
      name: spec.name,
      description: spec.description,
      version: spec.version,
      type: spec.type,
      inputSchemaJson: toJson(spec.inputSchema),
      outputSchemaJson: toJson(spec.outputSchema),
      permissionsJson: toJson(spec.permissions),
      sourceCode: spec.sourceCode,
      testCode: spec.testCode,
      riskLevel,
      timeoutMs: spec.timeoutMs,
      authorAgentId: args.agentId ?? null,
      status: "draft",
      auditJson: toJson([{ at: new Date().toISOString(), action: "proposed", reason: proposal.reason }]),
    },
  });

  await emitEvent({
    runId: args.runId ?? null,
    projectId: args.projectId,
    type: "TOOL_PROPOSED",
    actorType: args.agentId ? "agent" : "system",
    actorId: args.agentId ?? null,
    summary: `Tool "${spec.name}" proposed (${riskLevel} risk)`,
    payload: { toolId: tool.id, name: spec.name, riskLevel, reason: proposal.reason },
  });

  // ── Sandbox test phase ──────────────────────────────────────────────
  let testsPassed = true;
  let finalSource = spec.sourceCode;
  if (spec.testCode.trim().length > 0) {
    await emitEvent({
      runId: args.runId ?? null,
      projectId: args.projectId,
      type: "TEST_STARTED",
      summary: `Testing tool "${spec.name}" in sandbox`,
      payload: { toolId: tool.id },
    });
    const policy = defaultPolicy({ timeoutMs: spec.timeoutMs });
    let result = await getSandbox().runTests(spec.sourceCode, spec.testCode, policy);

    if (!result.ok) {
      // One repair attempt: fix the export convention and re-run.
      const repaired = repairSource(spec.sourceCode, spec.name);
      if (repaired !== spec.sourceCode) {
        result = await getSandbox().runTests(repaired, spec.testCode, policy);
        if (result.ok) finalSource = repaired;
      } else {
        // Same source failed — retry once to rule out flaky sandbox startup.
        result = await getSandbox().runTests(spec.sourceCode, spec.testCode, policy);
      }
    }
    testsPassed = result.ok;

    await emitEvent({
      runId: args.runId ?? null,
      projectId: args.projectId,
      type: "TEST_COMPLETED",
      summary: testsPassed
        ? `Tool "${spec.name}" passed its tests`
        : `Tool "${spec.name}" failed its tests: ${(result.error ?? "").slice(0, 120)}`,
      payload: {
        toolId: tool.id,
        ok: testsPassed,
        error: result.error ?? null,
        durationMs: result.durationMs,
      },
    });
  }

  // ── Status decision ─────────────────────────────────────────────────
  let status: string;
  if (!testsPassed) {
    status = "rejected";
  } else if (requiresApproval(riskLevel, args.autonomy)) {
    status = "pending_approval";
  } else {
    status = "approved";
  }

  await db.toolDefinition.update({
    where: { id: tool.id },
    data: { status, sourceCode: finalSource },
  });

  if (status === "pending_approval") {
    // Approval rows are run-scoped (schema requires runId); manual proposals
    // without a run stay pending_approval and are decided via approveTool.
    if (args.runId) {
      await db.approval.create({
        data: {
          runId: args.runId,
          agentId: args.agentId ?? null,
          kind: "tool_register",
          title: `Register tool "${spec.name}"`,
          detailJson: toJson({
            toolId: tool.id,
            name: spec.name,
            description: spec.description,
            permissions: spec.permissions,
            sourceCode: finalSource,
          }),
          riskLevel,
        },
      });
    }
    await emitEvent({
      runId: args.runId ?? null,
      projectId: args.projectId,
      type: "TOOL_APPROVAL_REQUIRED",
      actorType: "system",
      summary: `Tool "${spec.name}" needs approval (${riskLevel} risk)`,
      payload: { toolId: tool.id, riskLevel },
    });
  } else if (status === "approved") {
    await emitEvent({
      runId: args.runId ?? null,
      projectId: args.projectId,
      type: "TOOL_REGISTERED",
      actorType: "system",
      summary: `Tool "${spec.name}" registered and ready`,
      payload: { toolId: tool.id, name: spec.name, riskLevel },
    });
  } else {
    await emitEvent({
      runId: args.runId ?? null,
      projectId: args.projectId,
      type: "TOOL_REJECTED",
      actorType: "system",
      summary: `Tool "${spec.name}" rejected (tests failed)`,
      payload: { toolId: tool.id },
    });
  }

  return { toolId: tool.id, status };
}

export async function executeTool(args: {
  toolId: string;
  input: Record<string, unknown>;
  runId?: string;
  agentId?: string;
  taskId?: string;
  autonomy: AutonomyMode;
}): Promise<ToolRunResult> {
  const tool = await db.toolDefinition.findUnique({ where: { id: args.toolId } });
  if (!tool) {
    return { ok: false, error: `tool not found: ${args.toolId}`, logs: [], durationMs: 0 };
  }

  const recordExecution = async (status: string, result: ToolRunResult) => {
    await db.toolExecution
      .create({
        data: {
          toolId: tool.id,
          runId: args.runId ?? null,
          agentId: args.agentId ?? null,
          taskId: args.taskId ?? null,
          inputJson: toJson(args.input),
          outputJson: toJson(result.ok ? result.output ?? null : { error: result.error ?? null }),
          status,
          durationMs: result.durationMs,
        },
      })
      .catch(() => {});
  };

  // ── Permission gate ─────────────────────────────────────────────────
  const riskLevel = (tool.riskLevel === "high" || tool.riskLevel === "medium"
    ? tool.riskLevel
    : "low") as "low" | "medium" | "high";
  const gated =
    tool.status !== "approved" || requiresApproval(riskLevel, args.autonomy);

  if (gated) {
    if (args.runId) {
      const existing = await db.approval.findFirst({
        where: { runId: args.runId, kind: "tool_execute", status: "pending", detailJson: { contains: tool.id } },
      });
      if (!existing) {
        await db.approval.create({
          data: {
            runId: args.runId,
            agentId: args.agentId ?? null,
            kind: "tool_execute",
            title: `Execute tool "${tool.name}"`,
            detailJson: toJson({ toolId: tool.id, input: args.input }),
            riskLevel,
          },
        });
      }
    }
    await emitEvent({
      runId: args.runId ?? null,
      projectId: tool.projectId,
      type: "TOOL_APPROVAL_REQUIRED",
      actorType: "system",
      summary: `Execution of "${tool.name}" requires approval`,
      payload: { toolId: tool.id, riskLevel, toolStatus: tool.status },
    });
    const denied: ToolRunResult = {
      ok: false,
      error: "approval_required",
      logs: [],
      durationMs: 0,
    };
    await recordExecution("denied", denied);
    return denied;
  }

  // ── Execute in the sandbox ──────────────────────────────────────────
  await emitEvent({
    runId: args.runId ?? null,
    projectId: tool.projectId,
    type: "TOOL_STARTED",
    actorType: args.agentId ? "agent" : "system",
    actorId: args.agentId ?? null,
    summary: `Running tool "${tool.name}"`,
    payload: { toolId: tool.id, input: args.input },
  });

  const policy = defaultPolicy({ timeoutMs: tool.timeoutMs });
  const result = await getSandbox().runJs(tool.sourceCode, args.input, policy);
  await recordExecution(result.ok ? "completed" : "failed", result);

  await emitEvent({
    runId: args.runId ?? null,
    projectId: tool.projectId,
    type: result.ok ? "TOOL_COMPLETED" : "TOOL_FAILED",
    actorType: args.agentId ? "agent" : "system",
    actorId: args.agentId ?? null,
    summary: result.ok
      ? `Tool "${tool.name}" completed in ${result.durationMs}ms`
      : `Tool "${tool.name}" failed: ${(result.error ?? "").slice(0, 120)}`,
    payload: {
      toolId: tool.id,
      ok: result.ok,
      error: result.error ?? null,
      durationMs: result.durationMs,
    },
  });

  return result;
}

export async function approveTool(toolId: string, approve: boolean): Promise<void> {
  const tool = await db.toolDefinition.findUnique({ where: { id: toolId } });
  if (!tool) throw new Error(`tool not found: ${toolId}`);
  const status = approve ? "approved" : "rejected";
  await db.toolDefinition.update({ where: { id: toolId }, data: { status } });

  // Resolve any pending registration approvals for this tool.
  const pending = await db.approval.findMany({
    where: { status: "pending", kind: { in: ["tool_register", "tool_execute"] } },
  });
  for (const approval of pending) {
    const detail = fromJson<{ toolId?: string }>(approval.detailJson, {});
    if (detail.toolId === toolId) {
      await db.approval.update({
        where: { id: approval.id },
        data: { status: approve ? "approved" : "rejected", decidedAt: new Date() },
      });
    }
  }

  await emitEvent({
    projectId: tool.projectId,
    type: approve ? "TOOL_APPROVED" : "TOOL_REJECTED",
    actorType: "user",
    summary: approve ? `Tool "${tool.name}" approved` : `Tool "${tool.name}" rejected`,
    payload: { toolId, decision: approve ? "approve" : "reject" },
  });
}

/** Registry read helpers used by API routes. */
export async function listTools(projectId?: string) {
  const tools = await db.toolDefinition.findMany({
    where: projectId ? { projectId } : undefined,
    orderBy: { createdAt: "desc" },
  });
  return tools.map((t) => ({
    ...t,
    permissions: fromJson<string[]>(t.permissionsJson, []),
    inputSchema: fromJson<Record<string, unknown>>(t.inputSchemaJson, {}),
  }));
}
