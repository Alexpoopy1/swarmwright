import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb, seedWorkspace } from "./helpers/db";
import {
  startRun,
  pauseRun,
  resumeRun,
  stopRun,
  forkRun,
} from "@/server/orchestrator/engine";
import { latestCheckpoint } from "@/server/orchestrator/checkpoints";

/**
 * Full-lifecycle orchestrator suite — driven end-to-end by the deterministic
 * mock provider (SPEC §4.3): the planner mock emits a 6–10 task plan; agent
 * mocks rotate status → file_write(s) → optional tool_propose → message →
 * task_complete, so an unattended run reaches RUN_COMPLETED.
 *
 * NOTE: requires the providers/router/usage/tools/projects modules
 * (server-data agent); run post-merge.
 */

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms: ${label}${lastError ? ` (last error: ${lastError})` : ""}`);
}

async function seed() {
  const db = await testDb();
  const { workspace } = await seedWorkspace();
  await db.providerConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: "mock",
      label: "Mock (offline)",
      authType: "none",
      status: "ok",
    },
  });
  const project = await db.project.create({
    data: { workspaceId: workspace.id, name: "Demo project" },
  });
  return { db, workspace, project };
}

describe("orchestrator engine (mock provider, mode auto / autonomy auto)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("runs the full lifecycle: plan → agents → files → RUN_COMPLETED", async () => {
    const { db, workspace, project } = await seed();
    const { runId } = await startRun({
      workspaceId: workspace.id,
      projectId: project.id,
      goal: "Build a tiny task manager (API + UI + tests + docs)",
      mode: "auto",
      autonomy: "auto",
    });

    await waitFor(
      async () => (await db.agentRun.findUnique({ where: { id: runId } }))?.status === "completed",
      60_000,
      "run completed",
    );

    const events = await db.event.findMany({ where: { runId } });
    const types = events.map((e) => e.type);
    expect(types).toContain("RUN_CREATED");
    expect(types).toContain("PLAN_CREATED");
    expect(types).toContain("TASK_CREATED");
    expect(types).toContain("RUN_COMPLETED");

    const fileEvents = events.filter((e) => e.type === "FILE_CREATED");
    expect(fileEvents.length).toBeGreaterThanOrEqual(1);

    const agentEvents = events.filter((e) => e.type === "AGENT_CREATED" || e.type === "AGENT_RECRUITED");
    expect(agentEvents.length).toBeGreaterThanOrEqual(2);

    const checkpoint = await latestCheckpoint(runId);
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.eventSeq).toBeGreaterThan(0);

    // Files actually landed in the project via the file service.
    const files = await db.fileEntry.findMany({ where: { projectId: project.id } });
    expect(files.length).toBeGreaterThanOrEqual(1);

    // Final summary artifact + memory.
    const artifact = await db.artifact.findFirst({ where: { runId, kind: "report" } });
    expect(artifact?.name).toBe("Run summary");
  }, 90_000);

  it("pause halts progress and resume finishes the run", async () => {
    const { db, workspace, project } = await seed();
    const { runId } = await startRun({
      workspaceId: workspace.id,
      projectId: project.id,
      goal: "Build a notes app with markdown support",
      mode: "auto",
      autonomy: "auto",
    });

    // Wait until the run is actively executing, then pause.
    await waitFor(
      async () => (await db.agentRun.findUnique({ where: { id: runId } }))?.status === "running",
      30_000,
      "run running",
    );
    await pauseRun(runId);
    await waitFor(
      async () => (await db.agentRun.findUnique({ where: { id: runId } }))?.status === "paused",
      10_000,
      "run paused",
    );
    // In-flight agent steps may legitimately emit a few events right after
    // the pause lands; quiescence is what proves the pause works. Wait for
    // the settle, then assert the log stops growing.
    await new Promise((r) => setTimeout(r, 2500));
    const settledEvents = await db.event.count({ where: { runId } });
    await new Promise((r) => setTimeout(r, 2000));
    const afterQuietWindow = await db.event.count({ where: { runId } });
    expect(afterQuietWindow).toBe(settledEvents);

    await resumeRun(runId);
    await waitFor(
      async () => (await db.agentRun.findUnique({ where: { id: runId } }))?.status === "completed",
      60_000,
      "run completed after resume",
    );
    const resumed = await db.event.findFirst({ where: { runId, type: "RUN_RESUMED" } });
    expect(resumed).not.toBeNull();
  }, 90_000);

  it("stop terminates the run and its agents", async () => {
    const { db, workspace, project } = await seed();
    const { runId } = await startRun({
      workspaceId: workspace.id,
      projectId: project.id,
      goal: "Build a URL shortener",
      mode: "auto",
      autonomy: "auto",
    });
    await waitFor(
      async () => {
        const s = (await db.agentRun.findUnique({ where: { id: runId } }))?.status;
        return s === "running" || s === "planning";
      },
      30_000,
      "run started",
    );
    await stopRun(runId);
    await waitFor(
      async () => (await db.agentRun.findUnique({ where: { id: runId } }))?.status === "stopped",
      10_000,
      "run stopped",
    );
    const stopped = await db.event.findFirst({ where: { runId, type: "RUN_STOPPED" } });
    expect(stopped).not.toBeNull();
    const activeAgents = await db.agent.count({ where: { runId, status: { in: ["active", "idle", "waiting"] } } });
    expect(activeAgents).toBe(0);
  }, 60_000);

  it("fork creates a branch run that completes independently", async () => {
    const { db, workspace, project } = await seed();
    const { runId } = await startRun({
      workspaceId: workspace.id,
      projectId: project.id,
      goal: "Build a markdown blog engine",
      mode: "auto",
      autonomy: "auto",
    });
    await waitFor(
      async () => (await db.agentRun.findUnique({ where: { id: runId } }))?.status === "completed",
      60_000,
      "source run completed",
    );

    const { runId: forkId } = await forkRun(runId, {});
    const fork = await db.agentRun.findUnique({ where: { id: forkId } });
    expect(fork?.branchOfId).toBe(runId);

    const forkedEvent = await db.event.findFirst({ where: { runId: forkId, type: "RUN_FORKED" } });
    expect(forkedEvent).not.toBeNull();

    await waitFor(
      async () => {
        const s = (await db.agentRun.findUnique({ where: { id: forkId } }))?.status;
        return s === "completed" || s === "failed";
      },
      60_000,
      "fork finished",
    );
    expect((await db.agentRun.findUnique({ where: { id: forkId } }))?.status).toBe("completed");
  }, 120_000);

  it("exceeding the budget pauses the run with BUDGET_EXCEEDED", async () => {
    const { db, workspace, project } = await seed();
    const { runId } = await startRun({
      workspaceId: workspace.id,
      projectId: project.id,
      goal: "Build a chat prototype",
      mode: "auto",
      autonomy: "auto",
      // Mock tokens are estimated ceil(chars/4), so the planning call alone
      // blows a 50-token limit; budgetUsd is tiny too so cost-based checks
      // trigger the moment any cost accrues.
      limits: { budgetUsd: 0.000001, tokenLimit: 50 },
    });
    await waitFor(
      async () => {
        const exceeded = await db.event.findFirst({ where: { runId, type: "BUDGET_EXCEEDED" } });
        return exceeded !== null;
      },
      60_000,
      "BUDGET_EXCEEDED emitted",
    );
    await waitFor(
      async () => (await db.agentRun.findUnique({ where: { id: runId } }))?.status === "paused",
      10_000,
      "run paused after budget exceeded",
    );
    await stopRun(runId); // cleanup: do not leak the paused loop into other tests
  }, 90_000);
});
