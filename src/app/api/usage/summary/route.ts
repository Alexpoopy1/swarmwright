import { requireUser } from "@/server/auth";
import { usageSummary } from "@/server/usage/meter";
import { errorResponse, json, workspaceIdOf } from "@/app/api/_utils";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const summary = await usageSummary(workspaceId);
    return json(summary);
  } catch (err) {
    return errorResponse(err);
  }
}
