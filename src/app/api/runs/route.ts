import { z } from "zod";
import { planContentSchema } from "@/types";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { startRun } from "@/server/orchestrator/engine";
import {
  errorResponse,
  json,
  parseBody,
  queryInt,
  workspaceIdOf,
} from "@/app/api/_utils";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId") ?? undefined;
    const limit = queryInt(url, "limit") ?? 50;
    const runs = await db.agentRun.findMany({
      where: { projectId, project: { workspaceId } },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
      include: {
        _count: { select: { agents: true, tasks: true } },
        project: { select: { name: true } },
      },
    });
    return json({ runs });
  } catch (err) {
    return errorResponse(err);
  }
}

const limitsSchema = z
  .object({
    budgetUsd: z.number().positive(),
    tokenLimit: z.number().int().positive(),
    timeLimitSec: z.number().int().positive(),
    maxAgents: z.number().int().positive(),
    maxConcurrentAgents: z.number().int().positive(),
    maxRetries: z.number().int().nonnegative(),
  })
  .partial();

const createSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  goal: z.string().min(1, "A run needs a goal"),
  mode: z.enum(["plan_only", "plan_approve", "auto"]).default("auto"),
  autonomy: z.enum(["observe", "ask_all", "ask_risky", "auto"]).default("ask_risky"),
  limits: limitsSchema.optional(),
  planOverride: planContentSchema.optional(),
  instructionOverride: z.string().max(4000).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const body = await parseBody(req, createSchema);
    const { runId } = await startRun({ ...body, workspaceId });
    return json({ runId }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
