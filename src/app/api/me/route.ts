import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { isDefaultEncryptionKey } from "@/server/env";
import { errorResponse, json, workspaceIdOf } from "@/app/api/_utils";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true },
    });
    const defaultEncryptionKey = isDefaultEncryptionKey();
    return json({
      id: user.id,
      email: user.email,
      name: user.name,
      user,
      workspaceId,
      workspace,
      // All three aliases so any UI consumer can warn about the dev key.
      defaultEncryptionKey,
      usingDefaultEncryptionKey: defaultEncryptionKey,
      encryptionKeyIsDefault: defaultEncryptionKey,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
