import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { exportProjectBundle } from "@/server/projects";
import { HttpError, errorResponse, workspaceIdOf } from "@/app/api/_utils";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project || project.workspaceId !== workspaceId) {
      throw new HttpError(404, "Project not found");
    }
    const bundle = await exportProjectBundle(id);
    const filename = `${bundle.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "project"}-export.json`;
    return new NextResponse(JSON.stringify(bundle, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
