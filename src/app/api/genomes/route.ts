import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import {
  HttpError,
  errorResponse,
  genomeDto,
  json,
  parseBody,
  workspaceIdOf,
} from "@/app/api/_utils";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const rows = await db.agentGenome.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
    });
    return json({ genomes: rows.map(genomeDto) });
  } catch (err) {
    return errorResponse(err);
  }
}

const cloneSchema = z.object({
  fromId: z.string().min(1, "fromId is required"),
  name: z.string().min(1).max(120).optional(),
});

/** POST {fromId} — clone an existing genome (SPEC §5). */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const body = await parseBody(req, cloneSchema);
    const source = await db.agentGenome.findUnique({ where: { id: body.fromId } });
    if (!source || source.workspaceId !== workspaceId) {
      throw new HttpError(404, "Source genome not found");
    }
    const clone = await db.agentGenome.create({
      data: {
        workspaceId,
        name: body.name ?? `${source.name} (copy)`,
        roleDescription: source.roleDescription,
        provider: source.provider,
        model: source.model,
        systemPrompt: source.systemPrompt,
        temperature: source.temperature,
        planningDepth: source.planningDepth,
        toolProfileJson: source.toolProfileJson,
        verificationStrategy: source.verificationStrategy,
        collaborationStyle: source.collaborationStyle,
        // Fresh clones start with neutral learning stats.
        successRate: 0.5,
        avgLatencyMs: 0,
        avgCostUsd: 0,
        runs: 0,
        failurePatternsJson: "[]",
        bestCategoriesJson: source.bestCategoriesJson,
        locked: false,
        learningEnabled: source.learningEnabled,
      },
    });
    return json(genomeDto(clone), 201);
  } catch (err) {
    return errorResponse(err);
  }
}
