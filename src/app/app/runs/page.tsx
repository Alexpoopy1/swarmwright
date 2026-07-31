/**
 * /app/runs — run list + "New run" dialog (SPEC §6.2). Cards show goal,
 * status (color + icon), cost, agent/task counts, branch chip, age. The
 * dialog also opens via ?new=1 (command palette action).
 */
"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GitBranch, Play, Plus } from "lucide-react";
import { Badge, Button, EmptyState, Skeleton, toast } from "@/components/ui";
import { get, post, ApiError } from "@/lib/api";
import { timeAgo, usd } from "@/lib/format";
import { RUN_STATUS_META, type RunListItemDto } from "@/components/swarm/shared";
import { NewRunDialog } from "./new-run-dialog";

function RunList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [runs, setRuns] = useState<RunListItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(searchParams.get("new") === "1");
  const [demoBusy, setDemoBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await get<RunListItemDto[] | { runs: RunListItemDto[] }>("/api/runs");
      const list = Array.isArray(data) ? data : data.runs ?? [];
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setRuns(list);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load runs");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startDemo = async () => {
    setDemoBusy(true);
    try {
      const res = await post<{ runId: string }>("/api/demo", {});
      toast("Demo started", "success");
      router.push(`/app/runs/${res.runId}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Demo failed to start", "error");
    } finally {
      setDemoBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-stone-100">Agent runs</h1>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => void startDemo()} loading={demoBusy}>
            <Play className="mr-1.5 h-4 w-4" aria-hidden />
            Guided demo
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            New run
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-ember-500/40 bg-ink-900 p-4" role="alert">
          <p className="text-sm text-ember-400">{error}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : runs === null ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : runs.length === 0 ? (
        <EmptyState
          title="No runs yet"
          hint="Give the swarm a goal — it plans, recruits agents, and builds."
          action={
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              New run
            </Button>
          }
        />
      ) : (
        <ul className="grid min-h-0 flex-1 grid-cols-1 content-start gap-3 overflow-y-auto md:grid-cols-2 xl:grid-cols-3">
          {runs.map((r) => {
            const meta = RUN_STATUS_META[r.status] ?? RUN_STATUS_META.queued;
            const agents = r._count?.agents ?? r.agents?.length;
            const tasks = r._count?.tasks ?? r.tasks?.length;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/app/runs/${r.id}`)}
                  className="block w-full rounded-md border border-ink-700 bg-ink-900 p-3 text-left transition-colors duration-150 hover:border-ink-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 min-w-0 flex-1 text-sm text-stone-200">{r.goal}</p>
                    <Badge tone={meta.tone} className="shrink-0">
                      <meta.icon className="mr-1 h-3 w-3" aria-hidden />
                      {meta.label}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
                    <span className="font-mono text-copper-400">{usd(r.costUsd)}</span>
                    {agents !== undefined && <span>{agents} agents</span>}
                    {tasks !== undefined && <span>{tasks} tasks</span>}
                    {r.branchOfId && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-1.5 py-0.5 text-[10px] text-stone-400">
                        <GitBranch className="h-3 w-3" aria-hidden />
                        branch
                      </span>
                    )}
                    <span className="ml-auto">{timeAgo(r.createdAt)}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <NewRunDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}

export default function RunsPage() {
  return (
    <Suspense>
      <RunList />
    </Suspense>
  );
}
