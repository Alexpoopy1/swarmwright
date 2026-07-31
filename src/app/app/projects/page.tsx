"use client";

import * as React from "react";
import Link from "next/link";
import { FolderKanban, Plus } from "lucide-react";
import { get } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { Button, EmptyState, Skeleton } from "@/components/ui";

interface Project {
  id: string;
  name: string;
  description?: string | null;
  createdAt?: string;
  fileCount?: number;
  runCount?: number;
  _count?: { files?: number; runs?: number };
}

export default function ProjectsPage() {
  const [projects, setProjects] = React.useState<Project[] | null>(null);
  const [error, setError] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await get<{ projects?: Project[] } | Project[]>("/api/projects");
      setProjects(Array.isArray(res) ? res : res.projects ?? []);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-stone-100">Projects</h1>
        <Link href="/app/projects/new">
          <Button size="sm" variant="primary">
            <Plus size={13} /> New project
          </Button>
        </Link>
      </div>

      <div className="mt-5">
        {projects === null && !error && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        )}
        {error && (
          <EmptyState
            title="Could not load projects"
            action={
              <Button size="sm" onClick={() => void load()}>
                Retry
              </Button>
            }
          />
        )}
        {projects !== null && projects.length === 0 && !error && (
          <EmptyState
            icon={<FolderKanban size={26} />}
            title="No projects yet"
            hint="Projects hold the files your agent swarms create."
            action={
              <Link href="/app/projects/new">
                <Button size="sm" variant="primary">
                  <Plus size={13} /> Create a project
                </Button>
              </Link>
            }
          />
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(projects ?? []).map((p) => {
            const files = p.fileCount ?? p._count?.files;
            const runs = p.runCount ?? p._count?.runs;
            return (
              <Link
                key={p.id}
                href={`/app/projects/${p.id}`}
                className="rounded-md border border-ink-700 bg-ink-900 p-4 transition-colors duration-150 hover:border-ink-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
              >
                <p className="truncate text-sm font-medium text-stone-100">{p.name}</p>
                {p.description && (
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500">{p.description}</p>
                )}
                <div className="mt-3 flex items-center gap-3 text-xs text-stone-500">
                  {typeof files === "number" && <span>{files} files</span>}
                  {typeof runs === "number" && <span>{runs} runs</span>}
                  {p.createdAt && <span className="ml-auto">{timeAgo(p.createdAt)}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
