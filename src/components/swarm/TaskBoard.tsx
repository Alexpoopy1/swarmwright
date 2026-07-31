/**
 * TaskBoard — kanban over the run's live task fold (SPEC §6.2 main tab).
 * Columns by task status; cards show role chip, assigned agent, attempts,
 * dependency count; detail dialog with Retry → POST /api/runs/[id]/control
 * {action:"retry", taskId}.
 */
"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Dialog, EmptyState, toast } from "@/components/ui";
import { post, ApiError } from "@/lib/api";
import { clsx } from "@/lib/format";
import type { TaskStatus } from "@/types";
import { TASK_STATUS_META } from "@/components/swarm/shared";
import { useRunStore, type FoldedTask } from "@/lib/stores";

const COLUMNS: TaskStatus[] = ["pending", "blocked", "active", "completed", "failed"];

export interface TaskBoardProps {
  runId: string;
  className?: string;
}

export function TaskBoard({ runId, className }: TaskBoardProps) {
  const tasks = useRunStore((s) => s.tasks);
  const agents = useRunStore((s) => s.agents);
  const plan = useRunStore((s) => s.plan);
  const [selected, setSelected] = useState<FoldedTask | null>(null);
  const [retrying, setRetrying] = useState(false);

  const roleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of plan?.tasks ?? []) map.set(t.id, t.role);
    return map;
  }, [plan]);

  const byColumn = useMemo(() => {
    const map = new Map<TaskStatus, FoldedTask[]>(COLUMNS.map((c) => [c, []]));
    for (const t of tasks.values()) {
      const col = t.status === "cancelled" ? "failed" : t.status;
      map.get(col)?.push(t);
    }
    return map;
  }, [tasks]);

  const retry = async (taskId: string) => {
    setRetrying(true);
    try {
      await post(`/api/runs/${encodeURIComponent(runId)}/control`, { action: "retry", taskId });
      toast("Task queued for retry", "success");
      setSelected(null);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Retry failed", "error");
    } finally {
      setRetrying(false);
    }
  };

  if (tasks.size === 0) {
    return (
      <EmptyState
        title="No tasks yet"
        hint="Tasks appear once the planner has produced a plan for this run."
      />
    );
  }

  return (
    <div className={clsx("flex min-h-0 gap-3 overflow-x-auto", className)}>
      {COLUMNS.map((col) => {
        const meta = TASK_STATUS_META[col];
        const list = byColumn.get(col) ?? [];
        return (
          <section
            key={col}
            aria-label={`${meta.label} tasks`}
            className="flex w-56 shrink-0 flex-col rounded-md border border-ink-700 bg-ink-900"
          >
            <header className="flex items-center gap-2 border-b border-ink-700 px-3 py-2">
              <span className="h-2 w-2 rounded-full" style={{ background: meta.hex }} aria-hidden />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-300">
                {meta.label}
              </h3>
              <span className="ml-auto text-xs text-stone-500">{list.length}</span>
            </header>
            <div className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto p-2">
              {list.length === 0 && (
                <p className="px-1 py-2 text-xs text-stone-600">No tasks</p>
              )}
              {list.map((t) => {
                const agent = t.agentId ? agents.get(t.agentId) : undefined;
                const role = roleById.get(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelected(t)}
                    className="rounded-md border border-ink-700 bg-ink-850 p-2 text-left transition-colors duration-150 hover:border-ink-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
                  >
                    <p className="text-sm text-stone-200">{t.title}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {role && <Badge tone="copper">{role}</Badge>}
                      {t.status === "cancelled" && <Badge tone="stone">cancelled</Badge>}
                    </div>
                    <p className="mt-1.5 flex items-center justify-between text-xs text-stone-500">
                      <span className="truncate">{agent ? agent.name : "unassigned"}</span>
                      <span className="shrink-0 font-mono">
                        {t.attempts > 0 && `×${t.attempts} `}
                        {t.dependsOn.length > 0 && `⛓ ${t.dependsOn.length}`}
                      </span>
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      <Dialog
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.title ?? "Task"}
      >
        {selected && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge tone={TASK_STATUS_META[selected.status].tone}>
                {TASK_STATUS_META[selected.status].label}
              </Badge>
              {roleById.get(selected.id) && (
                <Badge tone="copper">{roleById.get(selected.id)}</Badge>
              )}
              <span className="text-xs text-stone-500">
                attempts: {selected.attempts}
              </span>
            </div>
            {selected.description && (
              <section>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-400">
                  Description
                </h4>
                <p className="whitespace-pre-wrap text-sm text-stone-300">{selected.description}</p>
              </section>
            )}
            {selected.dependsOn.length > 0 && (
              <section>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-400">
                  Depends on
                </h4>
                <ul className="space-y-0.5 text-sm text-stone-400">
                  {selected.dependsOn.map((d) => (
                    <li key={d} className="font-mono text-xs">
                      {tasks.get(d)?.title ?? d}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {selected.result && (
              <section>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-400">
                  Result
                </h4>
                <p className="whitespace-pre-wrap text-sm text-stone-300">{selected.result}</p>
              </section>
            )}
            {selected.error && (
              <section>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ember-400">
                  Error
                </h4>
                <p className="whitespace-pre-wrap text-sm text-ember-400">{selected.error}</p>
              </section>
            )}
            {(selected.status === "failed" || selected.status === "cancelled") && (
              <Button onClick={() => void retry(selected.id)} loading={retrying}>
                Retry task
              </Button>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
