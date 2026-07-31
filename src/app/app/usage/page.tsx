"use client";

import * as React from "react";
import Link from "next/link";
import { BarChart3, RotateCcw, Wrench } from "lucide-react";
import { get } from "@/lib/api";
import { tokens, usd } from "@/lib/format";
import type { UsageSummary } from "@/types";
import { Button, EmptyState, Skeleton } from "@/components/ui";

export default function UsagePage() {
  const [summary, setSummary] = React.useState<UsageSummary | null>(null);
  const [error, setError] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setSummary(await get<UsageSummary>("/api/usage/summary"));
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const maxProviderCost = Math.max(0, ...(summary?.byProvider ?? []).map((p) => p.costUsd));

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="text-lg font-semibold text-stone-100">Usage</h1>

      {summary === null && !error && (
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      )}
      {error && (
        <div className="mt-5">
          <EmptyState
            title="Could not load usage"
            action={
              <Button size="sm" onClick={() => void load()}>
                Retry
              </Button>
            }
          />
        </div>
      )}

      {summary && (
        <div className="mt-5 flex flex-col gap-6">
          {/* Totals */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-ink-700 bg-ink-900 p-4">
              <p className="text-xs text-stone-500">Total cost</p>
              <p className="mt-1 font-mono text-2xl text-copper-300">{usd(summary.totalCostUsd)}</p>
            </div>
            <div className="rounded-md border border-ink-700 bg-ink-900 p-4">
              <p className="text-xs text-stone-500">Tokens in</p>
              <p className="mt-1 font-mono text-2xl text-stone-100">{tokens(summary.totalTokensIn)}</p>
            </div>
            <div className="rounded-md border border-ink-700 bg-ink-900 p-4">
              <p className="text-xs text-stone-500">Tokens out</p>
              <p className="mt-1 font-mono text-2xl text-stone-100">{tokens(summary.totalTokensOut)}</p>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Per provider */}
            <section className="rounded-md border border-ink-700 bg-ink-900 p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-stone-200">
                <BarChart3 size={15} className="text-copper-400" /> Cost by provider
              </h2>
              {summary.byProvider.length === 0 ? (
                <p className="py-4 text-center text-sm text-stone-500">No usage recorded yet.</p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {summary.byProvider.map((p) => {
                    const pct = maxProviderCost > 0 ? Math.round((p.costUsd / maxProviderCost) * 100) : 0;
                    return (
                      <li key={p.provider}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono text-stone-300">{p.provider}</span>
                          <span className="font-mono text-stone-400">
                            {usd(p.costUsd)} · {tokens(p.tokens)} tok
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-ink-700">
                          <div className="h-full rounded-full bg-copper-600 transition-all duration-200" style={{ width: `${Math.max(pct, 2)}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Per model */}
            <section className="rounded-md border border-ink-700 bg-ink-900 p-4">
              <h2 className="mb-3 text-sm font-semibold text-stone-200">By model</h2>
              {summary.byModel.length === 0 ? (
                <p className="py-4 text-center text-sm text-stone-500">No usage recorded yet.</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-ink-700 text-xs text-stone-500">
                      <th className="py-1.5 pr-3 font-medium">Model</th>
                      <th className="py-1.5 pr-3 font-medium">Cost</th>
                      <th className="py-1.5 font-medium">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byModel.map((m) => (
                      <tr key={`${m.provider}/${m.model}`} className="border-b border-ink-800">
                        <td className="py-1.5 pr-3 font-mono text-xs text-stone-300">
                          {m.provider}/{m.model}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-xs text-stone-300">{usd(m.costUsd)}</td>
                        <td className="py-1.5 font-mono text-xs text-stone-400">{tokens(m.tokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          {/* Per run */}
          <section className="rounded-md border border-ink-700 bg-ink-900 p-4">
            <h2 className="mb-3 text-sm font-semibold text-stone-200">By run</h2>
            {summary.byRun.length === 0 ? (
              <p className="py-4 text-center text-sm text-stone-500">No runs recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-ink-700 text-xs text-stone-500">
                      <th className="py-1.5 pr-3 font-medium">Run</th>
                      <th className="py-1.5 pr-3 font-medium">Goal</th>
                      <th className="py-1.5 pr-3 font-medium">Cost</th>
                      <th className="py-1.5 font-medium">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byRun.map((r) => (
                      <tr key={r.runId} className="border-b border-ink-800">
                        <td className="py-1.5 pr-3">
                          <Link
                            href={`/app/runs/${r.runId}`}
                            className="font-mono text-xs text-copper-300 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
                          >
                            {r.runId.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="max-w-xs truncate py-1.5 pr-3 text-xs text-stone-300" title={r.goal}>
                          {r.goal}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-xs text-stone-300">{usd(r.costUsd)}</td>
                        <td className="py-1.5 font-mono text-xs text-stone-400">{tokens(r.tokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Tool stats + budget note */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-ink-700 bg-ink-900 p-4">
              <p className="flex items-center gap-1.5 text-xs text-stone-500">
                <Wrench size={12} /> Tool executions
              </p>
              <p className="mt-1 font-mono text-xl text-stone-100">{summary.toolExecutions}</p>
            </div>
            <div className="rounded-md border border-ink-700 bg-ink-900 p-4">
              <p className="flex items-center gap-1.5 text-xs text-stone-500">
                <RotateCcw size={12} /> Retries
              </p>
              <p className="mt-1 font-mono text-xl text-stone-100">{summary.retries}</p>
            </div>
            <div className="rounded-md border border-copper-700/50 bg-copper-600/5 p-4">
              <p className="text-xs text-stone-400">Budgets</p>
              <p className="mt-1 text-xs leading-5 text-stone-500">
                Per-run budgets pause runs before overspend.
              </p>
              <Link
                href="/app/settings"
                className="mt-1 inline-block text-xs text-copper-400 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
              >
                Set defaults in Settings →
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
