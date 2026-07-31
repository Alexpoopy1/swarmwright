import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { toJson } from "@/server/json";
import {
  errorResponse,
  genomeDto,
  json,
  parseBody,
  workspaceIdOf,
} from "@/app/api/_utils";

export const runtime = "nodejs";

const genomePayloadSchema = z.object({
  name: z.string().min(1, "Genome name is required").max(120),
  roleDescription: z.string().max(2000).default(""),
  provider: z.string().min(1, "provider is required"),
  model: z.string().min(1, "model is required"),
  systemPrompt: z.string().max(20000).default(""),
  temperature: z.number().min(0).max(2).default(0.3),
  planningDepth: z.number().int().min(0).max(10).default(2),
  toolProfile: z.array(z.unknown()).default([]),
  verificationStrategy: z.string().max(120).default("self_review"),
  collaborationStyle: z.string().max(120).default("structured"),
  successRate: z.number().min(0).max(1).default(0.5),
  avgLatencyMs: z.number().min(0).default(0),
  avgCostUsd: z.number().min(0).default(0),
  runs: z.number().int().min(0).default(0),
  failurePatterns: z.array(z.string()).default([]),
  bestCategories: z.array(z.string()).default([]),
  locked: z.boolean().default(false),
  learningEnabled: z.boolean().default(true),
});

/** Accepts both the `{format, genome}` export wrapper and a bare genome. */
const importSchema = z.object({
  format: z.string().optional(),
  genome: genomePayloadSchema.optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const wrapper = await parseBody(req, importSchema.passthrough());
    const payload = wrapper.genome ?? genomePayloadSchema.parse(wrapper);

    const created = await db.agentGenome.create({
      data: {
        workspaceId,
        name: payload.name,
        roleDescription: payload.roleDescription,
        provider: payload.provider,
        model: payload.model,
        systemPrompt: payload.systemPrompt,
        temperature: payload.temperature,
        planningDepth: payload.planningDepth,
        toolProfileJson: toJson(payload.toolProfile),
        verificationStrategy: payload.verificationStrategy,
        collaborationStyle: payload.collaborationStyle,
        successRate: payload.successRate,
        avgLatencyMs: payload.avgLatencyMs,
        avgCostUsd: payload.avgCostUsd,
        runs: payload.runs,
        failurePatternsJson: toJson(payload.failurePatterns),
        bestCategoriesJson: toJson(payload.bestCategories),
        locked: payload.locked,
        learningEnabled: payload.learningEnabled,
      },
    });
    return json(genomeDto(created), 201);
  } catch (err) {
    return errorResponse(err);
  }
}
