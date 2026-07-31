import { describe, expect, it, beforeEach } from "vitest";
import { testDb, resetDb, seedWorkspace } from "./helpers/db";
import { passesHardFilters, routeModel, scoreModel } from "@/server/router/modelRouter";
import { FALLBACK_MODELS } from "@/server/providers/pricing";
import type { ModelInfo, TaskProfile } from "@/types";

const gpt4o = FALLBACK_MODELS.find((m) => m.model === "gpt-4o")!;
const gpt4oMini = FALLBACK_MODELS.find((m) => m.model === "gpt-4o-mini")!;
const mockCoder = FALLBACK_MODELS.find((m) => m.model === "mock-coder-1")!;

function noToolModel(): ModelInfo {
  return { ...gpt4oMini, model: "no-tools-1", supportsTools: false, supportsVision: false };
}

describe("scoreModel (pure)", () => {
  const coding: TaskProfile = { taskType: "coding", qualityWeight: 1 };
  const cheap: TaskProfile = { taskType: "coding", qualityWeight: 0 };

  it("prefers quality when qualityWeight is 1", () => {
    expect(scoreModel(coding, gpt4o)).toBeGreaterThan(scoreModel(coding, gpt4oMini));
  });

  it("prefers cheap models when qualityWeight is 0", () => {
    expect(scoreModel(cheap, gpt4oMini)).toBeGreaterThan(scoreModel(cheap, gpt4o));
  });

  it("prefers fast models for documentation tasks", () => {
    const docs: TaskProfile = { taskType: "documentation", qualityWeight: 1 };
    expect(scoreModel(docs, gpt4oMini)).toBeGreaterThan(scoreModel(docs, gpt4o));
  });

  it("adds an availability bonus for healthy connections", () => {
    const degraded = scoreModel(coding, gpt4o, { connectionStatus: "failed" });
    const healthy = scoreModel(coding, gpt4o, { connectionStatus: "ok" });
    expect(healthy).toBeGreaterThan(degraded);
  });

  it("adds a genome bonus for proven configurations", () => {
    const plain = scoreModel(coding, gpt4o, {});
    const proven = scoreModel(coding, gpt4o, { genomeSuccessRate: 0.95 });
    const flaky = scoreModel(coding, gpt4o, { genomeSuccessRate: 0.1 });
    expect(proven).toBeGreaterThan(plain);
    expect(plain).toBeGreaterThan(flaky);
  });

  it("is deterministic", () => {
    expect(scoreModel(coding, gpt4o, { connectionStatus: "ok" })).toBe(
      scoreModel(coding, gpt4o, { connectionStatus: "ok" })
    );
  });
});

describe("passesHardFilters", () => {
  it("filters models without tool support", () => {
    expect(passesHardFilters({ taskType: "coding", needsTools: true }, noToolModel())).toBe(false);
    expect(passesHardFilters({ taskType: "coding", needsTools: true }, gpt4o)).toBe(true);
  });

  it("filters models without vision", () => {
    const groq = FALLBACK_MODELS.find((m) => m.provider === "groq")!;
    expect(passesHardFilters({ taskType: "general", needsVision: true }, groq)).toBe(false);
    expect(passesHardFilters({ taskType: "general", needsVision: true }, gpt4o)).toBe(true);
  });

  it("filters models under the context minimum", () => {
    expect(passesHardFilters({ taskType: "general", minContext: 64000 }, mockCoder)).toBe(false);
    expect(passesHardFilters({ taskType: "general", minContext: 64000 }, gpt4o)).toBe(true);
  });

  it("honors forceProvider and forceModel", () => {
    expect(passesHardFilters({ taskType: "general", forceProvider: "mock" }, gpt4o)).toBe(false);
    expect(passesHardFilters({ taskType: "general", forceProvider: "mock" }, mockCoder)).toBe(true);
    expect(passesHardFilters({ taskType: "general", forceModel: "gpt-4o-mini" }, gpt4o)).toBe(false);
    expect(passesHardFilters({ taskType: "general", forceModel: "gpt-4o-mini" }, gpt4oMini)).toBe(true);
  });
});

describe("routeModel (with DB)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns null when no providers are connected", async () => {
    const { workspace } = await seedWorkspace();
    const decision = await routeModel(workspace.id, { taskType: "coding" });
    expect(decision).toBeNull();
  });

  it("routes to a mock connection's model", async () => {
    const db = await testDb();
    const { workspace } = await seedWorkspace();
    const conn = await db.providerConnection.create({
      data: {
        workspaceId: workspace.id,
        provider: "mock",
        label: "Mock",
        authType: "none",
        status: "ok",
      },
    });
    const decision = await routeModel(workspace.id, { taskType: "planning", qualityWeight: 1 });
    expect(decision).not.toBeNull();
    expect(decision!.provider).toBe("mock");
    expect(decision!.connectionId).toBe(conn.id);
    expect(decision!.model).toMatch(/^mock-/);
    expect(decision!.reason).toContain("mock");
  });

  it("honors forceModel override", async () => {
    const db = await testDb();
    const { workspace } = await seedWorkspace();
    await db.providerConnection.create({
      data: {
        workspaceId: workspace.id,
        provider: "mock",
        label: "Mock",
        authType: "none",
        status: "ok",
      },
    });
    const decision = await routeModel(workspace.id, {
      taskType: "coding",
      forceModel: "mock-fast-1",
    });
    expect(decision).not.toBeNull();
    expect(decision!.model).toBe("mock-fast-1");
  });

  it("returns null when filters eliminate every connected model", async () => {
    const db = await testDb();
    const { workspace } = await seedWorkspace();
    await db.providerConnection.create({
      data: {
        workspaceId: workspace.id,
        provider: "mock",
        label: "Mock",
        authType: "none",
        status: "ok",
      },
    });
    // Mock models have no vision support and only 32k context.
    expect(await routeModel(workspace.id, { taskType: "general", needsVision: true })).toBeNull();
    expect(await routeModel(workspace.id, { taskType: "general", minContext: 64000 })).toBeNull();
  });
});
