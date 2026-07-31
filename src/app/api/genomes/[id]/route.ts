import { z } from "zod";
import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { fromJson } from "@/server/json";
import {
  HttpError,
  errorResponse,
  genomeDto,
  json,
  parseBody,
  workspaceIdOf,
} from "@/app/api/_utils";

export const runtime = "nodejs";

async function ownedGenome(id: string, workspaceId: string) {
  const row = await db.agentGenome.findUnique({ where: { id } });
  if (!row || row.workspaceId !== workspaceId) throw new HttpError(404, "Genome not found");
  return row;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    const genome = await ownedGenome(id, workspaceId);

    if (new URL(req.url).searchParams.get("format") === "export") {
      // Portable export: no ids, no workspace references.
      const payload = {
        format: "swarmwright-genome@1",
        genome: {
          name: genome.name,
          roleDescription: genome.roleDescription,
          provider: genome.provider,
          model: genome.model,
          systemPrompt: genome.systemPrompt,
          temperature: genome.temperature,
          planningDepth: genome.planningDepth,
          toolProfile: fromJson<unknown[]>(genome.toolProfileJson, []),
          verificationStrategy: genome.verificationStrategy,
          collaborationStyle: genome.collaborationStyle,
          successRate: genome.successRate,
          avgLatencyMs: genome.avgLatencyMs,
          avgCostUsd: genome.avgCostUsd,
          runs: genome.runs,
          failurePatterns: fromJson<string[]>(genome.failurePatternsJson, []),
          bestCategories: fromJson<string[]>(genome.bestCategoriesJson, []),
          locked: genome.locked,
          learningEnabled: genome.learningEnabled,
        },
      };
      const filename = `genome-${genome.name.replace(/[^a-z0-9-_]+/gi, "_") || "export"}.json`;
      return new NextResponse(JSON.stringify(payload, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    return json(genomeDto(genome));
  } catch (err) {
    return errorResponse(err);
  }
}

const patchSchema = z.object({
  locked: z.boolean().optional(),
  learningEnabled: z.boolean().optional(),
  /** Zero all learned stats back to neutral. */
  resetLearning: z.boolean().optional(),
  name: z.string().min(1).max(120).optional(),
  systemPrompt: z.string().max(20000).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    await ownedGenome(id, workspaceId);
    const body = await parseBody(req, patchSchema);

    const data: Record<string, unknown> = {};
    if (body.locked !== undefined) data.locked = body.locked;
    if (body.learningEnabled !== undefined) data.learningEnabled = body.learningEnabled;
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.systemPrompt !== undefined) data.systemPrompt = body.systemPrompt;
    if (body.temperature !== undefined) data.temperature = body.temperature;
    if (body.resetLearning) {
      data.successRate = 0.5;
      data.avgLatencyMs = 0;
      data.avgCostUsd = 0;
      data.runs = 0;
      data.failurePatternsJson = "[]";
      data.bestCategoriesJson = "[]";
    }

    const updated = await db.agentGenome.update({ where: { id }, data });
    return json(genomeDto(updated));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    await ownedGenome(id, workspaceId);
    await db.agentGenome.delete({ where: { id } });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
