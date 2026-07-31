import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb, seedWorkspace } from "./helpers/db";
import {
  matchGenome,
  seedDefaultGenomes,
  recordRunOutcome,
} from "@/server/orchestrator/genome";
import { fromJson } from "@/server/json";

async function seedAgentWithGenome(
  workspaceId: string,
  genomeData: Record<string, unknown> = {},
) {
  const db = await testDb();
  const project = await db.project.create({
    data: { workspaceId, name: "proj" },
  });
  const run = await db.agentRun.create({
    data: { projectId: project.id, goal: "test goal", status: "running" },
  });
  const genome = await db.agentGenome.create({
    data: {
      workspaceId,
      name: "coder",
      roleDescription: "Writes code",
      provider: "mock",
      model: "mock-coder-1",
      successRate: 0.5,
      avgLatencyMs: 0,
      avgCostUsd: 0,
      runs: 3,
      ...genomeData,
    },
  });
  const agent = await db.agent.create({
    data: {
      runId: run.id,
      name: "Atlas · coder",
      role: "coder",
      provider: "mock",
      model: "mock-coder-1",
      genomeId: genome.id,
    },
  });
  return { db, project, run, genome, agent };
}

describe("seedDefaultGenomes", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("seeds the six default genomes with mock models", async () => {
    const db = await testDb();
    const { workspace } = await seedWorkspace();
    await seedDefaultGenomes(workspace.id);
    const genomes = await db.agentGenome.findMany({ where: { workspaceId: workspace.id } });
    expect(genomes).toHaveLength(6);
    const names = genomes.map((g) => g.name).sort();
    expect(names).toEqual(["architect", "coder", "documentation", "planner", "reviewer", "tester"]);
    for (const g of genomes) {
      expect(g.provider).toBe("mock");
      expect(g.model).toMatch(/^mock-/);
    }
  });

  it("is idempotent — a second seeding is a no-op", async () => {
    const db = await testDb();
    const { workspace } = await seedWorkspace();
    await seedDefaultGenomes(workspace.id);
    const first = await db.agentGenome.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { id: "asc" },
    });
    await seedDefaultGenomes(workspace.id);
    const second = await db.agentGenome.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { id: "asc" },
    });
    expect(second.map((g) => g.id)).toEqual(first.map((g) => g.id));
    expect(second).toHaveLength(6);
  });
});

describe("recordRunOutcome EMA (α = 0.3)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("applies EMA to successRate / avgLatencyMs / avgCostUsd and bumps runs", async () => {
    const db = await testDb();
    const { workspace } = await seedWorkspace();
    const { genome, agent } = await seedAgentWithGenome(workspace.id);
    await recordRunOutcome(agent.id, {
      success: true,
      latencyMs: 100,
      costUsd: 0.01,
      taskCategory: "coding",
    });
    const g = await db.agentGenome.findUnique({ where: { id: genome.id } });
    expect(g!.successRate).toBeCloseTo(0.3 * 1 + 0.7 * 0.5, 10); // 0.65
    expect(g!.avgLatencyMs).toBeCloseTo(0.3 * 100 + 0.7 * 0, 10); // 30
    expect(g!.avgCostUsd).toBeCloseTo(0.3 * 0.01 + 0.7 * 0, 10); // 0.003
    expect(g!.runs).toBe(4);
    expect(fromJson<string[]>(g!.bestCategoriesJson, [])).toContain("coding");
  });

  it("drags successRate down on failure and records the failure pattern", async () => {
    const db = await testDb();
    const { workspace } = await seedWorkspace();
    const { genome, agent } = await seedAgentWithGenome(workspace.id);
    await recordRunOutcome(agent.id, {
      success: false,
      latencyMs: 50,
      costUsd: 0,
      failurePattern: "invalid JSON action",
      taskCategory: "coding",
    });
    const g = await db.agentGenome.findUnique({ where: { id: genome.id } });
    expect(g!.successRate).toBeCloseTo(0.3 * 0 + 0.7 * 0.5, 10); // 0.35
    expect(fromJson<string[]>(g!.failurePatternsJson, [])).toEqual(["invalid JSON action"]);
    expect(fromJson<string[]>(g!.bestCategoriesJson, [])).toEqual([]);
  });

  it("emits GENOME_UPDATED", async () => {
    const db = await testDb();
    const { workspace } = await seedWorkspace();
    const { run, agent } = await seedAgentWithGenome(workspace.id);
    await recordRunOutcome(agent.id, {
      success: true,
      latencyMs: 10,
      costUsd: 0,
      taskCategory: "coding",
    });
    const events = await db.event.findMany({ where: { runId: run.id, type: "GENOME_UPDATED" } });
    expect(events).toHaveLength(1);
  });

  it("skips learning when the genome is locked", async () => {
    const db = await testDb();
    const { workspace } = await seedWorkspace();
    const { genome, agent } = await seedAgentWithGenome(workspace.id, { locked: true });
    await recordRunOutcome(agent.id, {
      success: true,
      latencyMs: 999,
      costUsd: 5,
      taskCategory: "coding",
    });
    const g = await db.agentGenome.findUnique({ where: { id: genome.id } });
    expect(g!.successRate).toBe(0.5);
    expect(g!.avgLatencyMs).toBe(0);
    expect(g!.avgCostUsd).toBe(0);
    expect(g!.runs).toBe(3);
  });

  it("skips learning when learningEnabled is false", async () => {
    const db = await testDb();
    const { workspace } = await seedWorkspace();
    const { genome, agent } = await seedAgentWithGenome(workspace.id, { learningEnabled: false });
    await recordRunOutcome(agent.id, {
      success: false,
      latencyMs: 999,
      costUsd: 5,
      failurePattern: "boom",
      taskCategory: "coding",
    });
    const g = await db.agentGenome.findUnique({ where: { id: genome.id } });
    expect(g!.successRate).toBe(0.5);
    expect(g!.runs).toBe(3);
    expect(fromJson<string[]>(g!.failurePatternsJson, [])).toEqual([]);
  });

  it("caps failurePatterns at 10 and bestCategories at 8", async () => {
    const db = await testDb();
    const { workspace } = await seedWorkspace();
    const { genome, agent } = await seedAgentWithGenome(workspace.id);
    for (let i = 0; i < 12; i++) {
      await recordRunOutcome(agent.id, {
        success: false,
        latencyMs: 1,
        costUsd: 0,
        failurePattern: `pattern-${i}`,
        taskCategory: "coding",
      });
    }
    for (let i = 0; i < 10; i++) {
      await recordRunOutcome(agent.id, {
        success: true,
        latencyMs: 1,
        costUsd: 0,
        taskCategory: `cat-${i}`,
      });
    }
    const g = await db.agentGenome.findUnique({ where: { id: genome.id } });
    const failures = fromJson<string[]>(g!.failurePatternsJson, []);
    const categories = fromJson<string[]>(g!.bestCategoriesJson, []);
    expect(failures).toHaveLength(10);
    expect(failures[0]).toBe("pattern-2"); // oldest dropped
    expect(failures[9]).toBe("pattern-11");
    expect(categories).toHaveLength(8);
    expect(categories).toEqual(["cat-2", "cat-3", "cat-4", "cat-5", "cat-6", "cat-7", "cat-8", "cat-9"]);
  });
});

describe("matchGenome", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns null when no genome has >= 3 runs", async () => {
    const { workspace } = await seedWorkspace();
    await seedDefaultGenomes(workspace.id); // runs = 0
    expect(await matchGenome(workspace.id, "coder", "coding")).toBeNull();
  });

  it("returns the best-successRate genome matching the role", async () => {
    const db = await testDb();
    const { workspace } = await seedWorkspace();
    await db.agentGenome.create({
      data: {
        workspaceId: workspace.id,
        name: "coder",
        roleDescription: "writes code",
        provider: "mock",
        model: "mock-coder-1",
        successRate: 0.6,
        runs: 5,
      },
    });
    const better = await db.agentGenome.create({
      data: {
        workspaceId: workspace.id,
        name: "senior coder",
        roleDescription: "writes better code",
        provider: "mock",
        model: "mock-coder-1",
        successRate: 0.9,
        runs: 4,
        bestCategoriesJson: '["coding"]',
      },
    });
    const match = await matchGenome(workspace.id, "coder", "coding");
    expect(match?.id).toBe(better.id);
  });
});
