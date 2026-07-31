import path from "path";
import type { FileEntry, Project } from "@prisma/client";
import { db } from "@/server/db";

/**
 * Project + file service (SPEC §4.9) — durable file storage with per-save
 * FileVersion snapshots and strict path safety.
 */

export class PathSafetyError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "PathSafetyError";
  }
}

const MAX_PATH_LEN = 240;

/**
 * Path safety (SPEC §4.9): reject `..`, absolute paths (POSIX + Windows),
 * null bytes and paths over 240 chars. Returns the normalized POSIX path.
 */
export function assertSafePath(rawPath: string): string {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    throw new PathSafetyError("path must be a non-empty string");
  }
  if (rawPath.includes("\u0000")) throw new PathSafetyError("path contains null bytes");
  if (rawPath.length > MAX_PATH_LEN) {
    throw new PathSafetyError(`path too long (max ${MAX_PATH_LEN} chars)`);
  }
  const normalized = rawPath.replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.startsWith("~")
  ) {
    throw new PathSafetyError("absolute paths are not allowed");
  }
  const segments = normalized.split("/");
  if (segments.some((s) => s === "..")) {
    throw new PathSafetyError("path traversal ('..') is not allowed");
  }
  const clean = path.posix.normalize(normalized);
  if (clean.startsWith("../") || clean === ".." || path.posix.isAbsolute(clean)) {
    throw new PathSafetyError("path escapes the project root");
  }
  return clean;
}

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  json: "json", md: "markdown", css: "css", html: "html", py: "python",
  sql: "sql", yml: "yaml", yaml: "yaml", sh: "shell", rs: "rust", go: "go",
};

function guessLanguage(p: string): string {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return LANG_BY_EXT[ext] ?? "text";
}

export async function createProject(
  workspaceId: string,
  input: { name: string; description?: string }
): Promise<Project> {
  return db.project.create({
    data: {
      workspaceId,
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
    },
  });
}

export async function listProjects(workspaceId: string): Promise<Project[]> {
  return db.project.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Create or update a file. Every save bumps `version` and writes a
 * FileVersion snapshot so history/diffs survive overwrites.
 */
export async function upsertFile(
  projectId: string,
  filePath: string,
  content: string,
  opts?: { language?: string }
): Promise<FileEntry> {
  const safePath = assertSafePath(filePath);
  const language = opts?.language ?? guessLanguage(safePath);

  const existing = await db.fileEntry.findUnique({
    where: { projectId_path: { projectId, path: safePath } },
  });

  if (!existing) {
    const created = await db.fileEntry.create({
      data: { projectId, path: safePath, content, language, version: 1 },
    });
    await db.fileVersion.create({
      data: { fileId: created.id, version: 1, content },
    });
    return created;
  }

  const nextVersion = existing.version + 1;
  const updated = await db.fileEntry.update({
    where: { id: existing.id },
    data: { content, language, version: nextVersion },
  });
  await db.fileVersion.create({
    data: { fileId: existing.id, version: nextVersion, content },
  });
  return updated;
}

export async function getFile(projectId: string, filePath: string): Promise<FileEntry | null> {
  const safePath = assertSafePath(filePath);
  return db.fileEntry.findUnique({
    where: { projectId_path: { projectId, path: safePath } },
  });
}

export async function listFiles(
  projectId: string
): Promise<Array<{ path: string; version: number; updatedAt: Date }>> {
  const files = await db.fileEntry.findMany({
    where: { projectId },
    select: { path: true, version: true, updatedAt: true },
    orderBy: { path: "asc" },
  });
  return files;
}

/** Version history for a file (newest first). */
export async function listFileVersions(
  projectId: string,
  filePath: string
): Promise<Array<{ version: number; content: string; createdAt: Date }>> {
  const file = await getFile(projectId, filePath);
  if (!file) return [];
  return db.fileVersion.findMany({
    where: { fileId: file.id },
    select: { version: true, content: true, createdAt: true },
    orderBy: { version: "desc" },
  });
}

/** JSON export bundle (zip export documented as roadmap). */
export async function exportProjectBundle(
  projectId: string
): Promise<{ name: string; files: Array<{ path: string; content: string }> }> {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error(`project not found: ${projectId}`);
  const files = await db.fileEntry.findMany({
    where: { projectId },
    select: { path: true, content: true },
    orderBy: { path: "asc" },
  });
  return { name: project.name, files };
}
