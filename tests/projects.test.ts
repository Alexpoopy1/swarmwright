import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedWorkspace, testDb } from "./helpers/db";
import {
  assertSafePath,
  createProject,
  exportProjectBundle,
  getFile,
  listFileVersions,
  listFiles,
  listProjects,
  PathSafetyError,
  upsertFile,
} from "@/server/projects";

describe("projects", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates and lists projects per workspace", async () => {
    const { workspace } = await seedWorkspace();
    const p = await createProject(workspace.id, {
      name: "Task Manager",
      description: "demo",
    });
    expect(p.name).toBe("Task Manager");
    const list = await listProjects(workspace.id);
    expect(list.map((x) => x.id)).toContain(p.id);
  });

  it("upserts files and bumps versions with FileVersion snapshots", async () => {
    const db = await testDb();
    const { workspace } = await seedWorkspace();
    const project = await createProject(workspace.id, { name: "P" });

    const v1 = await upsertFile(project.id, "src/index.ts", "export const x = 1;");
    expect(v1.version).toBe(1);
    expect(v1.language).toBe("typescript");

    const v2 = await upsertFile(project.id, "src/index.ts", "export const x = 2;");
    expect(v2.version).toBe(2);

    const versions = await db.fileVersion.findMany({
      where: { fileId: v1.id },
      orderBy: { version: "asc" },
    });
    expect(versions).toHaveLength(2);
    expect(versions[0].content).toContain("x = 1");
    expect(versions[1].content).toContain("x = 2");

    const history = await listFileVersions(project.id, "src/index.ts");
    expect(history[0].version).toBe(2);

    const fetched = await getFile(project.id, "src/index.ts");
    expect(fetched!.content).toBe("export const x = 2;");

    await upsertFile(project.id, "README.md", "# hello");
    const files = await listFiles(project.id);
    expect(files.map((f) => f.path).sort()).toEqual(["README.md", "src/index.ts"]);
  });

  it("rejects path traversal, absolute paths, null bytes and over-long paths", () => {
    expect(() => assertSafePath("../secret.txt")).toThrow(PathSafetyError);
    expect(() => assertSafePath("src/../../etc/passwd")).toThrow(PathSafetyError);
    expect(() => assertSafePath("/etc/passwd")).toThrow(PathSafetyError);
    expect(() => assertSafePath("C:\\windows\\system32")).toThrow(PathSafetyError);
    expect(() => assertSafePath("a/b\0c")).toThrow(PathSafetyError);
    expect(() => assertSafePath(`${"x".repeat(241)}.ts`)).toThrow(PathSafetyError);
    expect(assertSafePath("src/deep/file.ts")).toBe("src/deep/file.ts");
  });

  it("rejects traversal in upsertFile too", async () => {
    const { workspace } = await seedWorkspace();
    const project = await createProject(workspace.id, { name: "P" });
    await expect(upsertFile(project.id, "../evil.ts", "x")).rejects.toBeInstanceOf(PathSafetyError);
  });

  it("exports a JSON bundle of the whole project", async () => {
    const { workspace } = await seedWorkspace();
    const project = await createProject(workspace.id, { name: "BundleMe" });
    await upsertFile(project.id, "src/a.ts", "const a = 1;");
    await upsertFile(project.id, "docs/notes.md", "notes");

    const bundle = await exportProjectBundle(project.id);
    expect(bundle.name).toBe("BundleMe");
    expect(bundle.files).toHaveLength(2);
    const a = bundle.files.find((f) => f.path === "src/a.ts");
    expect(a!.content).toBe("const a = 1;");
  });
});
