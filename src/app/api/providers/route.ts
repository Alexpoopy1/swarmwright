import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { encryptSecret, maskSecret } from "@/server/crypto/secrets";
import { toJson } from "@/server/json";
import { connectionDto, errorResponse, json, parseBody, workspaceIdOf } from "@/app/api/_utils";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const rows = await db.providerConnection.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
    });
    const connections = rows.map(connectionDto);
    return json({ connections });
  } catch (err) {
    return errorResponse(err);
  }
}

const createSchema = z.object({
  provider: z.string().min(1, "Provider is required"),
  label: z.string().min(1, "Label is required").max(120),
  apiKey: z.string().max(500).optional(),
  baseUrl: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const body = await parseBody(req, createSchema);
    const apiKey = body.apiKey?.trim() || null;
    const row = await db.providerConnection.create({
      data: {
        workspaceId,
        provider: body.provider,
        label: body.label.trim(),
        authType: apiKey ? "api_key" : "none",
        // Mask BEFORE encrypting; only the hint is stored alongside the row.
        metadataJson: toJson(apiKey ? { maskedHint: maskSecret(apiKey) } : {}),
        encryptedSecret: apiKey ? encryptSecret(apiKey) : null,
        baseUrl: body.baseUrl?.trim() || null,
        status: "untested",
      },
    });
    return json(connectionDto(row), 201);
  } catch (err) {
    return errorResponse(err);
  }
}
