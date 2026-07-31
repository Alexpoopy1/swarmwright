import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { createProject } from "@/server/projects";
import { startRun } from "@/server/orchestrator/engine";
import { seedDefaultGenomes } from "@/server/orchestrator/genome";
import { errorResponse, json, workspaceIdOf } from "@/app/api/_utils";

export const runtime = "nodejs";

const DEMO_PROJECT_NAME = "Demo Task Manager";
const DEMO_GOAL =
  "Build a small full-stack task manager with authentication, tests, documentation, and Docker support.";

/**
 * One-click guided demo (SPEC §5): fully offline on the mock provider —
 * ensure a mock connection, seed default genomes, create/reuse the demo
 * project, and start a run with tight limits.
 */
export async function POST() {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);

    const connection = await db.providerConnection.findFirst({
      where: { workspaceId, provider: "mock" },
    });
    if (!connection) {
      await db.providerConnection.create({
        data: {
          workspaceId,
          provider: "mock",
          label: "Mock (offline)",
          authType: "none",
          status: "ok",
        },
      });
    }

    await seedDefaultGenomes(workspaceId);

    let project = await db.project.findFirst({
      where: { workspaceId, name: DEMO_PROJECT_NAME },
    });
    if (!project) {
      project = await createProject(workspaceId, {
        name: DEMO_PROJECT_NAME,
        description: "Guided demo project — a swarm builds a small task manager here.",
      });
    }

    const { runId } = await startRun({
      workspaceId,
      projectId: project.id,
      goal: DEMO_GOAL,
      mode: "auto",
      autonomy: "ask_risky",
      limits: { budgetUsd: 1, tokenLimit: 200_000, timeLimitSec: 900, maxAgents: 6 },
    });

    return json({ runId, projectId: project.id }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
