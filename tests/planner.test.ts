import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb, seedWorkspace } from "./helpers/db";
import { generatePlan, extractJson } from "@/server/orchestrator/planner";
import { planContentSchema } from "@/types";
import { TaskGraph } from "@/server/orchestrator/taskGraph";

/**
 * Planner suite — driven by the deterministic mock provider (SPEC §4.3):
 * when jsonMode is on and the system prompt contains "PLANNER", the mock
 * returns a valid PlanContent built from the goal.
 *
 * NOTE: requires the providers/router/usage modules (server-data agent);
 * run post-merge.
 */

async function seedWorkspaceWithMockProvider() {
  const db = await testDb();
  const { workspace } = await seedWorkspace();
  // routeModel reads ProviderConnection rows for the workspace; the mock
  // provider needs no key.
  await db.providerConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: "mock",
      label: "Mock (offline)",
      authType: "none",
      status: "ok",
    },
  });
  return { workspace };
}

describe("extractJson", () => {
  it("parses a bare JSON object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("tolerates ```json fences and surrounding prose", () => {
    const raw = 'Here is the plan:\n```json\n{"a": 1, "b": {"c": "x{y}"}}\n```\nThanks!';
    expect(extractJson(raw)).toEqual({ a: 1, b: { c: "x{y}" } });
  });

  it("tolerates braces inside strings", () => {
    expect(extractJson('{"s": "}{", "n": 2}')).toEqual({ s: "}{", n: 2 });
  });

  it("returns null for non-JSON output", () => {
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson("{unclosed")).toBeNull();
  });
});

describe("generatePlan (mock provider)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns schema-valid PlanContent for a goal", async () => {
    const { workspace } = await seedWorkspaceWithMockProvider();
    const plan = await generatePlan(workspace.id, "Build a task manager with a REST API and a small web UI");
    // Schema validity is the contract — parse must not throw.
    const parsed = planContentSchema.parse(plan);
    expect(parsed.tasks.length).toBeGreaterThanOrEqual(1);
    expect(parsed.summary.length).toBeGreaterThan(0);
    // Task ids unique, dependsOn resolvable, no cycles.
    const ids = new Set(parsed.tasks.map((t) => t.id));
    expect(ids.size).toBe(parsed.tasks.length);
    for (const t of parsed.tasks) {
      for (const dep of t.dependsOn) expect(ids.has(dep)).toBe(true);
    }
    expect(new TaskGraph(parsed.tasks).hasCycle()).toBe(false);
  });

  it("records planning usage", async () => {
    const db = await testDb();
    const { workspace } = await seedWorkspaceWithMockProvider();
    await generatePlan(workspace.id, "Build a notes app");
    const usage = await db.usageRecord.findMany({
      where: { workspaceId: workspace.id, kind: "planning" },
    });
    expect(usage.length).toBeGreaterThanOrEqual(1);
    expect(usage[0].provider).toBe("mock");
  });

  it("throws OrchestratorError('no_provider') without any connection", async () => {
    const { workspace } = await seedWorkspace();
    await expect(generatePlan(workspace.id, "anything")).rejects.toMatchObject({
      name: "OrchestratorError",
      code: "no_provider",
    });
  });
});
