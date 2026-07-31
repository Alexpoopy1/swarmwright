/**
 * NewRunDialog — start an agentic run (SPEC §6.2 /app/runs).
 * Project picker, goal, plan mode, autonomy (with descriptions), budget /
 * token / time / agent-count sliders. Defaults persist to localStorage
 * `sw.defaults`. POST /api/runs → navigate to the new run workspace.
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, SegmentedControl, Select, Slider, toast } from "@/components/ui";
import { get, post, ApiError } from "@/lib/api";
import { tokens as fmtTokens, usd } from "@/lib/format";
import type { AutonomyMode, PlanMode } from "@/types";
import type { ProjectDto } from "@/components/swarm/shared";

const DEFAULTS_KEY = "sw.defaults";

const GOAL_PLACEHOLDER =
  "Build a complete analytics dashboard with authentication, billing, tests, documentation, and deployment configuration.";

const MODE_OPTIONS = [
  { value: "plan_only", label: "Plan only", hint: "Stop after the plan — no execution" },
  { value: "plan_approve", label: "Plan & approve", hint: "Plan, then wait for your approval" },
  { value: "auto", label: "Plan & execute", hint: "Plan and execute immediately" },
];

const AUTONOMY_OPTIONS: Array<{ value: AutonomyMode; label: string; hint: string }> = [
  { value: "observe", label: "Observe", hint: "Never acts on approvals — you do everything" },
  { value: "ask_all", label: "Ask all", hint: "Approval required for every tool action" },
  { value: "ask_risky", label: "Ask risky", hint: "Approval only for medium/high-risk actions" },
  { value: "auto", label: "Auto", hint: "Full autonomy within budget limits" },
];

interface RunDefaults {
  mode: PlanMode;
  autonomy: AutonomyMode;
  budgetUsd: number;
  tokenLimit: number;
  timeLimitMin: number;
  maxAgents: number;
}

function readDefaults(): RunDefaults {
  const fallback: RunDefaults = {
    mode: "plan_approve",
    autonomy: "ask_risky",
    budgetUsd: 5,
    tokenLimit: 500_000,
    timeLimitMin: 30,
    maxAgents: 8,
  };
  try {
    const raw = window.localStorage.getItem(DEFAULTS_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<RunDefaults>) };
  } catch {
    return fallback;
  }
}

export function NewRunDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectId, setProjectId] = useState("");
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState<PlanMode>("plan_approve");
  const [autonomy, setAutonomy] = useState<AutonomyMode>("ask_risky");
  const [budgetUsd, setBudgetUsd] = useState(5);
  const [tokenLimit, setTokenLimit] = useState(500_000);
  const [timeLimitMin, setTimeLimitMin] = useState(30);
  const [maxAgents, setMaxAgents] = useState(8);
  const [busy, setBusy] = useState(false);

  // Load defaults + projects when opened.
  useEffect(() => {
    if (!open) return;
    const d = readDefaults();
    setMode(d.mode);
    setAutonomy(d.autonomy);
    setBudgetUsd(d.budgetUsd);
    setTokenLimit(d.tokenLimit);
    setTimeLimitMin(d.timeLimitMin);
    setMaxAgents(d.maxAgents);
    get<ProjectDto[] | { projects: ProjectDto[] }>("/api/projects")
      .then((data) => {
        const list = Array.isArray(data) ? data : data.projects ?? [];
        setProjects(list);
        setProjectId((cur) => cur || list[0]?.id || "");
      })
      .catch(() => setProjects([]));
  }, [open]);

  const autonomyHint = AUTONOMY_OPTIONS.find((o) => o.value === autonomy)?.hint;
  const modeHint = MODE_OPTIONS.find((o) => o.value === mode)?.hint;
  const valid = projectId !== "" && goal.trim().length >= 10;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const res = await post<{ runId: string } | { id: string }>("/api/runs", {
        projectId,
        goal: goal.trim(),
        mode,
        autonomy,
        limits: {
          budgetUsd,
          tokenLimit,
          timeLimitSec: timeLimitMin * 60,
          maxAgents,
        },
      });
      try {
        window.localStorage.setItem(
          DEFAULTS_KEY,
          JSON.stringify({ mode, autonomy, budgetUsd, tokenLimit, timeLimitMin, maxAgents })
        );
      } catch {
        /* private mode */
      }
      const runId = "runId" in res ? res.runId : res.id;
      toast("Run started", "success");
      onClose();
      router.push(`/app/runs/${runId}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Failed to start run", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="New agent run" wide>
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-stone-300">Project</span>
          <Select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            aria-label="Project"
          >
            {projects.length === 0 && <option value="">No projects — create one first</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-stone-300">Goal</span>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={4}
            placeholder={GOAL_PLACEHOLDER}
            aria-label="Run goal"
            className="w-full resize-y rounded-md border border-ink-700 bg-ink-950 p-2 text-sm text-stone-200 placeholder:text-stone-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
          />
          {goal.trim().length > 0 && goal.trim().length < 10 && (
            <span className="mt-1 block text-xs text-ember-400">
              Describe the goal in at least 10 characters.
            </span>
          )}
        </label>

        <div>
          <span className="mb-1 block text-xs font-medium text-stone-300">Mode</span>
          <SegmentedControl
            options={MODE_OPTIONS}
            value={mode}
            onChange={(v) => setMode(v as PlanMode)}
          />
          {modeHint && <p className="mt-1 text-xs text-stone-500">{modeHint}</p>}
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-stone-300">Autonomy</span>
          <SegmentedControl
            options={AUTONOMY_OPTIONS}
            value={autonomy}
            onChange={(v) => setAutonomy(v as AutonomyMode)}
          />
          {autonomyHint && <p className="mt-1 text-xs text-stone-500">{autonomyHint}</p>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Slider
            label="Budget"
            min={0.5}
            max={50}
            step={0.5}
            value={budgetUsd}
            onChange={setBudgetUsd}
            formatValue={(v) => usd(v)}
          />
          <Slider
            label="Token limit"
            min={50_000}
            max={2_000_000}
            step={50_000}
            value={tokenLimit}
            onChange={setTokenLimit}
            formatValue={(v) => fmtTokens(v)}
          />
          <Slider
            label="Time limit"
            min={5}
            max={120}
            step={5}
            value={timeLimitMin}
            onChange={setTimeLimitMin}
            formatValue={(v) => `${v} min`}
          />
          <Slider
            label="Max agents"
            min={2}
            max={16}
            step={1}
            value={maxAgents}
            onChange={setMaxAgents}
            formatValue={(v) => `${v}`}
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-700 pt-3">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!valid}>
            Start run
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
