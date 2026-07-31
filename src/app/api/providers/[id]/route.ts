import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { encryptSecret, maskSecret } from "@/server/crypto/secrets";
import { fromJson, toJson } from "@/server/json";
import {
  HttpError,
  connectionDto,
  errorResponse,
  json,
  parseBody,
  workspaceIdOf,
} from "@/app/api/_utils";

export const runtime = "nodejs";

async function ownedConnection(id: string, workspaceId: string) {
  const row = await db.providerConnection.findUnique({ where: { id } });
  if (!row || row.workspaceId !== workspaceId) throw new HttpError(404, "Connection not found");
  return row;
}

const patchSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  baseUrl: z.string().max(500).nullable().optional(),
  /** Replace (or clear with "") the stored secret. */
  apiKey: z.string().max(500).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    const existing = await ownedConnection(id, workspaceId);
    const body = await parseBody(req, patchSchema);

    const data: Record<string, unknown> = {};
    if (body.label !== undefined) data.label = body.label.trim();
    if (body.baseUrl !== undefined) data.baseUrl = body.baseUrl?.trim() || null;
    if (body.apiKey !== undefined) {
      const apiKey = body.apiKey.trim() || null;
      data.encryptedSecret = apiKey ? encryptSecret(apiKey) : null;
      data.authType = apiKey ? "api_key" : "none";
      const meta = fromJson<Record<string, unknown>>(existing.metadataJson, {});
      if (apiKey) meta.maskedHint = maskSecret(apiKey);
      else delete meta.maskedHint;
      data.metadataJson = toJson(meta);
      data.status = "untested";
    }

    const row = await db.providerConnection.update({ where: { id }, data });
    return json(connectionDto(row));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    await ownedConnection(id, workspaceId);
    await db.providerConnection.delete({ where: { id } });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
