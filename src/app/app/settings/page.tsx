"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Trash2 } from "lucide-react";
import { get } from "@/lib/api";
import { usd } from "@/lib/format";
import { Badge, Button, Dialog, SegmentedControl, Skeleton, Slider, Toggle, toast } from "@/components/ui";

const AUTONOMY_OPTIONS = [
  { value: "observe", label: "Observe", hint: "Approve every step" },
  { value: "ask_all", label: "Ask all", hint: "Approve consequential actions" },
  { value: "ask_risky", label: "Ask risky", hint: "Ask only before risky actions" },
  { value: "auto", label: "Auto", hint: "Full autonomy within limits" },
];

interface Defaults {
  autonomy: string;
  budgetUsd: number;
  tokenLimit: number;
  timeLimitSec: number;
  maxAgents: number;
}

const DEFAULTS: Defaults = {
  autonomy: "ask_risky",
  budgetUsd: 10,
  tokenLimit: 200_000,
  timeLimitSec: 1800,
  maxAgents: 6,
};

function loadDefaults(): Defaults {
  try {
    const raw = window.localStorage.getItem("sw.defaults");
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Defaults>) };
  } catch {
    // ignore
  }
  return DEFAULTS;
}

interface Me {
  name: string;
  email: string;
  workspaceName?: string;
  workspace?: { name?: string };
}

export default function SettingsPage() {
  const [me, setMe] = React.useState<Me | null>(null);
  const [defaults, setDefaults] = React.useState<Defaults>(DEFAULTS);
  const [effects, setEffects] = React.useState(true);
  const [clearConfirm, setClearConfirm] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    setDefaults(loadDefaults());
    try {
      setEffects(window.localStorage.getItem("sw.effects") !== "off");
    } catch {
      // ignore
    }
    setHydrated(true);
    get<Me & { user?: Me }>("/api/me")
      .then((res) => {
        const u = res.user ?? res;
        setMe({ ...u, workspaceName: res.workspace?.name ?? u.workspaceName });
      })
      .catch(() => toast("Could not load profile", "error"));
  }, []);

  function update<K extends keyof Defaults>(key: K, value: Defaults[K]) {
    setDefaults((prev) => {
      const next = { ...prev, [key]: value };
      try {
        window.localStorage.setItem("sw.defaults", JSON.stringify(next));
        if (key === "budgetUsd") window.localStorage.setItem("sw.defaultBudget", String(value));
      } catch {
        // ignore
      }
      return next;
    });
  }

  function toggleEffects(v: boolean) {
    setEffects(v);
    try {
      window.localStorage.setItem("sw.effects", v ? "on" : "off");
    } catch {
      // ignore
    }
  }

  function clearUiState() {
    try {
      window.localStorage.clear();
      toast("Cached UI state cleared", "success");
    } catch {
      toast("Could not clear local storage", "error");
    }
    setClearConfirm(false);
    setDefaults(DEFAULTS);
    setEffects(true);
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-lg font-semibold text-stone-100">Settings</h1>

      {/* Profile */}
      <section className="mt-5 rounded-md border border-ink-700 bg-ink-900 p-4">
        <h2 className="text-sm font-semibold text-stone-200">Profile</h2>
        {me === null ? (
          <Skeleton className="mt-3 h-12" />
        ) : (
          <div className="mt-3 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md border border-copper-700 bg-copper-600/20 font-mono text-sm font-semibold uppercase text-copper-300">
              {me.name.slice(0, 1)}
            </span>
            <div>
              <p className="text-sm font-medium text-stone-100">{me.name}</p>
              <p className="text-xs text-stone-500">{me.email}</p>
            </div>
            <span className="ml-auto text-xs text-stone-500">
              Workspace: <span className="text-stone-300">{me.workspaceName ?? "Personal"}</span>
            </span>
          </div>
        )}
      </section>

      {/* Defaults */}
      <section className="mt-4 rounded-md border border-ink-700 bg-ink-900 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-stone-200">Run defaults</h2>
          <Badge tone="stone">applied to new runs</Badge>
        </div>
        <div className="mt-4 flex flex-col gap-5">
          <div>
            <p className="mb-2 text-sm text-stone-300">Autonomy</p>
            {hydrated && (
              <SegmentedControl
                options={AUTONOMY_OPTIONS}
                value={defaults.autonomy}
                onChange={(v) => update("autonomy", v)}
              />
            )}
          </div>
          <Slider
            label="Default budget per run"
            value={defaults.budgetUsd}
            min={1}
            max={100}
            step={1}
            onChange={(v) => update("budgetUsd", v)}
            formatValue={(v) => usd(v)}
          />
          <Slider
            label="Token limit"
            value={defaults.tokenLimit}
            min={10_000}
            max={1_000_000}
            step={10_000}
            onChange={(v) => update("tokenLimit", v)}
            formatValue={(v) => `${(v / 1000).toFixed(0)}k`}
          />
          <Slider
            label="Time limit"
            value={defaults.timeLimitSec}
            min={300}
            max={7200}
            step={300}
            onChange={(v) => update("timeLimitSec", v)}
            formatValue={(v) => `${Math.round(v / 60)} min`}
          />
          <Slider
            label="Max agents"
            value={defaults.maxAgents}
            min={1}
            max={16}
            step={1}
            onChange={(v) => update("maxAgents", v)}
          />
        </div>
      </section>

      {/* Appearance */}
      <section className="mt-4 rounded-md border border-ink-700 bg-ink-900 p-4">
        <h2 className="text-sm font-semibold text-stone-200">Appearance</h2>
        <div className="mt-3 flex items-center gap-3">
          {hydrated && (
            <Toggle checked={effects} onChange={toggleEffects} label="Particle effects" />
          )}
          <div>
            <p className="text-sm text-stone-300">Particle effects</p>
            <p className="text-xs text-stone-500">
              Particle effects are decorative state indicators — the app is fully usable without them.
            </p>
          </div>
        </div>
        <p className="mt-3 border-t border-ink-800 pt-3 text-xs leading-5 text-stone-500">
          Reduced motion: Swarmwright respects your operating system’s
          “prefers-reduced-motion” setting and disables non-essential animation automatically.
        </p>
      </section>

      {/* Danger zone */}
      <section className="mt-4 rounded-md border border-ember-500/40 bg-ember-500/5 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ember-400">
          <AlertTriangle size={14} /> Danger zone
        </h2>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-stone-300">Clear cached UI state</p>
            <p className="text-xs text-stone-500">
              Clears local preferences, panel layouts, and defaults stored in this browser.
            </p>
          </div>
          <Button size="sm" variant="danger" onClick={() => setClearConfirm(true)}>
            <Trash2 size={12} /> Clear
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-ember-500/20 pt-3">
          <div>
            <p className="text-sm text-stone-300">Reset genomes</p>
            <p className="text-xs text-stone-500">
              Reset learned genome data from the Genomes page.
            </p>
          </div>
          <Link href="/app/genomes">
            <Button size="sm" variant="ghost">Go to Genomes</Button>
          </Link>
        </div>
      </section>

      <Dialog open={clearConfirm} onClose={() => setClearConfirm(false)} title="Clear cached UI state">
        <p className="text-sm text-stone-300">
          This clears all Swarmwright preferences stored in this browser (panel layouts, defaults,
          effects toggle). Your workspace data on the server is not affected.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setClearConfirm(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" onClick={clearUiState}>
            Clear
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
