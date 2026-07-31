"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  FolderKanban,
  MessageSquare,
  PlayCircle,
  Rocket,
  Sparkles,
} from "lucide-react";
import { get, post } from "@/lib/api";
import { timeAgo, tokens, usd } from "@/lib/format";
import type { RunStatus, UsageSummary } from "@/types";
import { Badge, Button, EmptyState, Skeleton, toast } from "@/components/ui";

interface RunLite {
  id: string;
  goal: string;
  status: RunStatus;
  costUsd?: number;
  createdAt?: string;
  startedAt?: string;
  taskCount?: number;
  completedTasks?: number;
}

interface ConversationLite {
  id: string;
  title: string;
  updatedAt?: string;
  createdAt?: string;
  archived?: boolean;
}

const STATUS_TONE: Record<string, "sage" | "ember" | "copper" | "stone" | "amber"> = {
  running: "copper",
  planning: "copper",
  queued: "stone",
  paused: "amber",
  awaiting_approval: "amber",
  completed: "sage",
  failed: "ember",
  stopped: "stone",
};

const ACTIVE_STATUSES = new Set(["queued", "planning", "running", "paused", "awaiting_approval"]);

export default function DashboardPage() {
  const router = useRouter();
  const [runs, setRuns] = React.useState<RunLite[] | null>(null);
  const [convs, setConvs] = React.useState<ConversationLite[] | null>(null);
  const [usage, setUsage] = React.useState<UsageSummary | null>(null);
  const [error, setError] = React.useState(false);
  const [demoBusy, setDemoBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const [r, c, u] = await Promise.allSettled([
        get<{ runs?: RunLite[] } | RunLite[]>("/api/runs"),
        get<{ conversations?: ConversationLite[] } | ConversationLite[]>("/api/chat/conversations"),
        get<UsageSummary>("/api/usage/summary"),
      ]);
      if (r.status === "fulfilled") {
        const v = r.value;
        setRuns(Array.isArray(v) ? v : v.runs ?? []);
      }
      if (c.status === "fulfilled") {
        const v = c.value;
        setConvs(Array.isArray(v) ? v : v.conversations ?? []);
      }
      if (u.status === "fulfilled") setUsage(u.value);
      if (r.status === "rejected" && c.status === "rejected") setError(true);
      else setError(false);
    } catch {
      setError(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(t);
  }, [load]);

  async function startDemo() {
    setDemoBusy(true);
    try {
      const res = await post<{ runId: string }>("/api/demo");
      toast("Demo run started", "success");
      router.push(`/app/runs/${res.runId}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not start demo", "error");
      setDemoBusy(false);
    }
  }

  async function newChat() {
    try {
      const c = await post<{ id: string }>("/api/chat/conversations", { title: "New conversation" });
      router.push(`/app/chat/${c.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not create chat", "error");
    }
  }

  const loading = runs === null && convs === null && usage === null && !error;
  const nothingYet =
    !loading && (runs?.length ?? 0) === 0 && (convs?.length ?? 0) === 0;

  const activeRuns = (runs ?? []).filter((r) => ACTIVE_STATUSES.has(r.status));
  const recentConvs = (convs ?? []).slice(0, 6);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="text-lg font-semibold text-stone-100">Dashboard</h1>

      {loading && (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      )}

      {error && (
        <div className="mt-6">
          <EmptyState
            title="Could not load dashboard"
            hint="The server may still be starting up."
            action={
              <Button size="sm" onClick={() => void load()}>
                Retry
              </Button>
            }
          />
        </div>
      )}

      {!loading && !error && nothingYet && (
        <div className="mt-6">
          <EmptyState
            icon={<Rocket size={28} />}
            title="Welcome to Swarmwright"
            hint="No runs or conversations yet. Take the quick onboarding to connect a provider and create your first project — or start a guided demo."
            action={
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => router.push("/onboarding")}>
                  Start onboarding
                </Button>
                <Button onClick={() => void startDemo()} loading={demoBusy}>
                  <Sparkles size={14} /> Guided demo
                </Button>
              </div>
            }
          />
        </div>
      )}

      {!loading && !error && !nothingYet && (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {/* Active runs */}
          <section className="rounded-md border border-ink-700 bg-ink-900 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-200">
                <PlayCircle size={15} className="text-copper-400" /> Active runs
              </h2>
              <Link href="/app/runs" className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-300">
                All runs <ArrowRight size={11} />
              </Link>
            </div>
            {activeRuns.length === 0 ? (
              <p className="py-6 text-center text-sm text-stone-500">No active runs right now.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {activeRuns.slice(0, 5).map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/app/runs/${r.id}`}
                      className="flex items-center gap-3 rounded-md border border-ink-700 bg-ink-850 px-3 py-2 transition-colors hover:border-ink-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
                    >
                      <Badge tone={STATUS_TONE[r.status] ?? "stone"}>{r.status.replace("_", " ")}</Badge>
                      <span className="min-w-0 flex-1 truncate text-sm text-stone-200">{r.goal}</span>
                      {typeof r.completedTasks === "number" && typeof r.taskCount === "number" && (
                        <span className="font-mono text-xs text-stone-500">
                          {r.completedTasks}/{r.taskCount}
                        </span>
                      )}
                      {typeof r.costUsd === "number" && (
                        <span className="font-mono text-xs text-stone-400">{usd(r.costUsd)}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Recent conversations */}
          <section className="rounded-md border border-ink-700 bg-ink-900 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-200">
                <MessageSquare size={15} className="text-copper-400" /> Recent conversations
              </h2>
              <Link href="/app/chat" className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-300">
                All chats <ArrowRight size={11} />
              </Link>
            </div>
            {recentConvs.length === 0 ? (
              <p className="py-6 text-center text-sm text-stone-500">No conversations yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {recentConvs.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/app/chat/${c.id}`}
                      className="flex items-center gap-3 rounded-md border border-ink-700 bg-ink-850 px-3 py-2 transition-colors hover:border-ink-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-stone-200">{c.title || "Untitled"}</span>
                      <span className="text-xs text-stone-500">{timeAgo(c.updatedAt ?? c.createdAt ?? "")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Usage this week */}
          <section className="rounded-md border border-ink-700 bg-ink-900 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-200">
                <FolderKanban size={15} className="text-copper-400" /> Usage
              </h2>
              <Link href="/app/usage" className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-300">
                Details <ArrowRight size={11} />
              </Link>
            </div>
            {usage ? (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border border-ink-700 bg-ink-850 p-3">
                  <p className="text-xs text-stone-500">Total cost</p>
                  <p className="mt-1 font-mono text-lg text-copper-300">{usd(usage.totalCostUsd)}</p>
                </div>
                <div className="rounded-md border border-ink-700 bg-ink-850 p-3">
                  <p className="text-xs text-stone-500">Tokens in</p>
                  <p className="mt-1 font-mono text-lg text-stone-200">{tokens(usage.totalTokensIn)}</p>
                </div>
                <div className="rounded-md border border-ink-700 bg-ink-850 p-3">
                  <p className="text-xs text-stone-500">Tokens out</p>
                  <p className="mt-1 font-mono text-lg text-stone-200">{tokens(usage.totalTokensOut)}</p>
                </div>
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-stone-500">Usage data unavailable.</p>
            )}
          </section>

          {/* Quick actions */}
          <section className="rounded-md border border-ink-700 bg-ink-900 p-4">
            <h2 className="mb-3 text-sm font-semibold text-stone-200">Quick actions</h2>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => void newChat()}>
                <MessageSquare size={13} /> New chat
              </Button>
              <Button size="sm" onClick={() => router.push("/app/runs?new=1")}>
                <PlayCircle size={13} /> New run
              </Button>
              <Button size="sm" onClick={() => void startDemo()} loading={demoBusy}>
                <Sparkles size={13} /> Guided demo
              </Button>
              <Button size="sm" variant="ghost" onClick={() => router.push("/app/projects/new")}>
                <FolderKanban size={13} /> New project
              </Button>
            </div>
            <p className="mt-3 text-xs leading-5 text-stone-500">
              Tip: press <kbd className="rounded border border-ink-600 bg-ink-800 px-1 font-mono text-[10px]">⌘K</kbd> anywhere
              to open the command palette.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
