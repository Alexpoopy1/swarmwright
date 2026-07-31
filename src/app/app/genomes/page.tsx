"use client";

import * as React from "react";
import { Bot, Copy, Download, MoreHorizontal, RotateCcw, Trash2, Upload } from "lucide-react";
import { del, get, patch, post } from "@/lib/api";
import { durationMs, usd } from "@/lib/format";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Skeleton,
  Toggle,
  toast,
} from "@/components/ui";

interface Genome {
  id: string;
  name: string;
  role: string;
  provider: string;
  model: string;
  successRate: number;
  avgCostUsd?: number;
  avgLatencyMs?: number;
  runsCount?: number;
  runCount?: number;
  bestCategories?: string[] | string;
  locked?: boolean;
  learningEnabled?: boolean;
  systemPrompt?: string;
  notes?: string;
  configJson?: string | Record<string, unknown>;
  createdAt?: string;
}

function categoriesOf(g: Genome): string[] {
  if (Array.isArray(g.bestCategories)) return g.bestCategories;
  if (typeof g.bestCategories === "string") {
    try {
      const parsed = JSON.parse(g.bestCategories) as unknown;
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function runsOf(g: Genome): number {
  return g.runsCount ?? g.runCount ?? 0;
}

export default function GenomesPage() {
  const [genomes, setGenomes] = React.useState<Genome[] | null>(null);
  const [error, setError] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [compareOpen, setCompareOpen] = React.useState(false);
  const [menuFor, setMenuFor] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<{ kind: "reset" | "delete"; genome: Genome } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await get<{ genomes?: Genome[] } | Genome[]>("/api/genomes");
      setGenomes(Array.isArray(res) ? res : res.genomes ?? []);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function updateGenome(id: string, body: Record<string, unknown>, revert: () => void) {
    try {
      await patch(`/api/genomes/${id}`, body);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Update failed", "error");
      revert();
    }
  }

  function toggleField(id: string, field: "locked" | "learningEnabled", value: boolean) {
    setGenomes((prev) => prev?.map((g) => (g.id === id ? { ...g, [field]: value } : g)) ?? null);
    void updateGenome(id, { [field]: value }, () => void load());
  }

  async function cloneGenome(g: Genome) {
    try {
      await post("/api/genomes", { fromId: g.id });
      toast(`Cloned “${g.name}”`, "success");
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Clone failed", "error");
    }
  }

  async function exportGenome(g: Genome) {
    try {
      const data = await get(`/api/genomes/${g.id}?format=export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `genome-${g.name.replace(/[^a-z0-9-_]+/gi, "_")}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Export failed", "error");
    }
  }

  async function importGenome(file: File) {
    try {
      const text = await file.text();
      const json = JSON.parse(text) as unknown;
      await post("/api/genomes/import", json);
      toast("Genome imported", "success");
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Import failed — invalid genome JSON?", "error");
    }
  }

  async function doConfirm() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === "delete") {
        await del(`/api/genomes/${confirm.genome.id}`);
        toast("Genome deleted", "success");
      } else {
        await patch(`/api/genomes/${confirm.genome.id}`, { resetLearning: true });
        toast("Learned data reset", "success");
      }
      setConfirm(null);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Action failed", "error");
    } finally {
      setBusy(false);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 2) next.add(id);
      else {
        // Replace the oldest selection.
        const first = next.values().next().value;
        if (first) next.delete(first);
        next.add(id);
      }
      return next;
    });
  }

  const comparePair = (genomes ?? []).filter((g) => selected.has(g.id));

  const COMPARE_ROWS: Array<{ label: string; value: (g: Genome) => string }> = [
    { label: "Name", value: (g) => g.name },
    { label: "Role", value: (g) => g.role },
    { label: "Provider / model", value: (g) => `${g.provider} / ${g.model}` },
    { label: "Success rate", value: (g) => `${Math.round(g.successRate * 100)}%` },
    { label: "Avg cost", value: (g) => (g.avgCostUsd !== undefined ? usd(g.avgCostUsd) : "—") },
    { label: "Avg latency", value: (g) => (g.avgLatencyMs !== undefined ? durationMs(g.avgLatencyMs) : "—") },
    { label: "Runs", value: (g) => String(runsOf(g)) },
    { label: "Best categories", value: (g) => categoriesOf(g).join(", ") || "—" },
    { label: "Locked", value: (g) => (g.locked ? "yes" : "no") },
    { label: "Learning", value: (g) => (g.learningEnabled === false ? "off" : "on") },
  ];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-stone-100">Agent Genomes</h1>
          <p className="mt-0.5 text-sm text-stone-500">
            Transparent performance learning over agent configurations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            aria-label="Import genome JSON"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importGenome(f);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()}>
            <Upload size={13} /> Import
          </Button>
          <Button size="sm" disabled={comparePair.length !== 2} onClick={() => setCompareOpen(true)}>
            Compare ({comparePair.length}/2)
          </Button>
        </div>
      </div>

      <div className="mt-5">
        {genomes === null && !error && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        )}
        {error && (
          <EmptyState
            title="Could not load genomes"
            action={
              <Button size="sm" onClick={() => void load()}>
                Retry
              </Button>
            }
          />
        )}
        {genomes !== null && genomes.length === 0 && !error && (
          <EmptyState
            icon={<Bot size={26} />}
            title="No genomes yet"
            hint="Default genomes are seeded when your first run starts. They learn from run outcomes over time."
          />
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(genomes ?? []).map((g) => {
            const pct = Math.round((g.successRate ?? 0) * 100);
            const cats = categoriesOf(g);
            return (
              <div
                key={g.id}
                className={`rounded-md border bg-ink-900 p-4 transition-colors ${
                  selected.has(g.id) ? "border-copper-600" : "border-ink-700"
                }`}
              >
                <div className="flex items-start justify-between">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(g.id)}
                      onChange={() => toggleSelect(g.id)}
                      aria-label={`Select ${g.name} for comparison`}
                      className="h-3.5 w-3.5 accent-copper-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
                    />
                    <span className="text-sm font-medium text-stone-100">{g.name}</span>
                  </label>
                  <div className="relative" ref={menuFor === g.id ? menuRef : undefined}>
                    <button
                      type="button"
                      aria-label={`Actions for ${g.name}`}
                      aria-haspopup="menu"
                      aria-expanded={menuFor === g.id}
                      onClick={() => setMenuFor(menuFor === g.id ? null : g.id)}
                      className="rounded-md p-1 text-stone-500 transition-colors hover:bg-ink-800 hover:text-stone-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
                    >
                      <MoreHorizontal size={15} />
                    </button>
                    {menuFor === g.id && (
                      <div
                        role="menu"
                        className="absolute right-0 top-7 z-30 w-44 overflow-hidden rounded-md border border-ink-600 bg-ink-800 shadow-xl"
                      >
                        <button role="menuitem" onClick={() => { setMenuFor(null); void cloneGenome(g); }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-stone-200 hover:bg-ink-700 focus-visible:outline-none">
                          <Copy size={13} className="text-stone-500" /> Clone
                        </button>
                        <button role="menuitem" onClick={() => { setMenuFor(null); void exportGenome(g); }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-stone-200 hover:bg-ink-700 focus-visible:outline-none">
                          <Download size={13} className="text-stone-500" /> Export
                        </button>
                        <button role="menuitem" onClick={() => { setMenuFor(null); setConfirm({ kind: "reset", genome: g }); }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-stone-200 hover:bg-ink-700 focus-visible:outline-none">
                          <RotateCcw size={13} className="text-stone-500" /> Reset learned data
                        </button>
                        <button role="menuitem" onClick={() => { setMenuFor(null); setConfirm({ kind: "delete", genome: g }); }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ember-400 hover:bg-ink-700 focus-visible:outline-none">
                          <Trash2 size={13} /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge tone="copper">{g.role}</Badge>
                  <span className="font-mono text-xs text-stone-500">
                    {g.provider}/{g.model}
                  </span>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-stone-500">Success rate</span>
                    <span className="font-mono text-sage-400">{pct}%</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Success rate ${pct}%`}
                    className="mt-1 h-1.5 rounded-full bg-ink-700"
                  >
                    <div className="h-full rounded-full bg-sage-500 transition-all duration-200" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md border border-ink-800 bg-ink-850 py-1.5">
                    <p className="font-mono text-xs text-stone-200">{g.avgCostUsd !== undefined ? usd(g.avgCostUsd) : "—"}</p>
                    <p className="text-[10px] text-stone-500">avg cost</p>
                  </div>
                  <div className="rounded-md border border-ink-800 bg-ink-850 py-1.5">
                    <p className="font-mono text-xs text-stone-200">{g.avgLatencyMs !== undefined ? durationMs(g.avgLatencyMs) : "—"}</p>
                    <p className="text-[10px] text-stone-500">avg latency</p>
                  </div>
                  <div className="rounded-md border border-ink-800 bg-ink-850 py-1.5">
                    <p className="font-mono text-xs text-stone-200">{runsOf(g)}</p>
                    <p className="text-[10px] text-stone-500">runs</p>
                  </div>
                </div>

                {cats.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {cats.slice(0, 4).map((c) => (
                      <Badge key={c} tone="stone">{c}</Badge>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex items-center gap-4 border-t border-ink-800 pt-3">
                  <span className="flex items-center gap-1.5 text-xs text-stone-400">
                    <Toggle
                      checked={!!g.locked}
                      onChange={(v) => toggleField(g.id, "locked", v)}
                      label={`Lock ${g.name}`}
                    />
                    locked
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-stone-400">
                    <Toggle
                      checked={g.learningEnabled !== false}
                      onChange={(v) => toggleField(g.id, "learningEnabled", v)}
                      label={`Learning for ${g.name}`}
                    />
                    learning
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Compare dialog */}
      <Dialog open={compareOpen} onClose={() => setCompareOpen(false)} title="Compare genomes" wide>
        {comparePair.length === 2 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-xs text-stone-500">
                  <th className="py-2 pr-4 font-medium">Field</th>
                  <th className="py-2 pr-4 font-medium">{comparePair[0].name}</th>
                  <th className="py-2 font-medium">{comparePair[1].name}</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((row) => (
                  <tr key={row.label} className="border-b border-ink-800">
                    <td className="py-2 pr-4 text-xs text-stone-500">{row.label}</td>
                    <td className="py-2 pr-4 text-sm text-stone-200">{row.value(comparePair[0])}</td>
                    <td className="py-2 text-sm text-stone-200">{row.value(comparePair[1])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-stone-500">Select exactly two genomes to compare.</p>
        )}
      </Dialog>

      {/* Confirm dialog */}
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "delete" ? "Delete genome" : "Reset learned data"}
      >
        <p className="text-sm text-stone-300">
          {confirm?.kind === "delete"
            ? `Delete “${confirm.genome.name}” permanently? This cannot be undone.`
            : `Reset the learned success rate, costs, and category stats for “${confirm?.genome.name}”? The configuration is kept.`}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" onClick={() => void doConfirm()} loading={busy}>
            {confirm?.kind === "delete" ? "Delete" : "Reset"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
