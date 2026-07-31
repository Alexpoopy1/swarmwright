import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

/**
 * Shared test database helper (orchestrator + server-data suites).
 *
 * - DATABASE_URL is set BEFORE `@/server/db` is ever imported (Prisma reads
 *   it lazily, but we keep the ordering guarantee explicit).
 * - The schema is pushed exactly once per process via `prisma db push
 *   --skip-generate` (generation is covered by npm's postinstall).
 * - `resetDb()` wipes every table between tests.
 */

const DB_FILE = "/tmp/swtest-orchestrator.db";
process.env.DATABASE_URL = `file:${DB_FILE}`;
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

let pushed = false;

export async function testDb() {
  if (!pushed) {
    // Retry: another vitest worker may be pushing the same sqlite file.
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        execSync("npx prisma db push --skip-generate", {
          cwd: PROJECT_ROOT,
          env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
          stdio: "pipe",
          timeout: 120_000,
        });
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (lastError) throw lastError;
    pushed = true;
  }
  const { db } = await import("@/server/db");
  return db;
}

/** Delete every row in FK-safe order. */
export async function resetDb() {
  const db = await testDb();
  await db.toolExecution.deleteMany();
  await db.auditLog.deleteMany();
  await db.fileVersion.deleteMany();
  await db.user.deleteMany(); // cascades workspaces → projects/runs/…
  await db.modelCost.deleteMany();
}

/** Create a bare workspace (with owner user) for tests. */
export async function seedWorkspace(name = "Test workspace") {
  const db = await testDb();
  const user = await db.user.create({
    data: {
      email: `test-${Math.random().toString(36).slice(2, 10)}@example.com`,
      name: "Test User",
      passwordHash: "x",
    },
  });
  const workspace = await db.workspace.create({
    data: { name, ownerId: user.id },
  });
  return { user, workspace };
}

/** True when the sqlite file exists (debugging helper). */
export function testDbFileExists(): boolean {
  return fs.existsSync(DB_FILE);
}
