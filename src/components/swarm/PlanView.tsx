/**
 * PlanView — structured plan document (SPEC §6.2 main tab).
 * Document sections as readable cards, tasks table with roles + deps,
 * approve/reject bar while the plan awaits a decision (POST
 * /api/plans/[id]/decision), and pre-execution edit mode (PATCH
 * /api/plans/[id] → PLAN_EDITED). Tabs: Document | Board hint | JSON.
 */
"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Tabs, toast } from "@/components/ui";
import { patch, post, ApiError } from "@/lib/api";
import { clsx } from "@/lib/format";
import type { PlanContent, RunStatus } from "@/types";
import { parseJsonField, type PlanDto } from "@/components/swarm/shared";

export interface PlanViewProps {
  plan: PlanDto | null;
  runStatus?: RunStatus;
  /** Called after approve/reject/edit so the parent can refetch run detail. */
  onChanged?: () => void;
  className?: string;
}

// ── Helpers ──────────────────────────────────────────────────

const ARRAY_SECTIONS: Array<{ key: keyof PlanContent; label: string }> = [
  { key: "userGoals", label: "Goals" },
  { key: "functionalRequirements", label: "Functional requirements" },
  { key: "nonFunctionalRequirements", label: "Non-functional requirements" },
  { key: "assumptions", label: "Assumptions" },
  { key: "constraints", label: "Constraints" },
  { key: "workstreams", label: "Workstreams" },
  { key: "securityConsiderations", label: "Security" },
  { key: "definitionOfDone", label: "Definition of done" },
];

const TEXT_SECTIONS: Array<{ key: keyof PlanContent; label: string }> = [
  { key: "proposedArchitecture", label: "Architecture" },
  { key: "testingStrategy", label: "Testing strategy" },
  { key: "deploymentStrategy", label: "Deployment" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-ink-700 bg-ink-900 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

function StringList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-sm text-stone-600">—</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-stone-300">
      {items.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  );
}

// ── Component ────────────────────────────────────────────────

export function PlanView({ plan, runStatus, onChanged, className }: PlanViewProps) {
  const [tab, setTab] = useState("document");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<PlanContent | null>(null);

  const content = useMemo(
    () =>
      plan
        ? parseJsonField<PlanContent | null>(plan.contentJson, null)
        : null,
    [plan]
  );

  if (!plan || !content) {
    return (
      <div className="rounded-md border border-ink-700 bg-ink-900 p-6 text-center">
        <p className="text-sm text-stone-400">No plan yet.</p>
        <p className="mt-1 text-xs text-stone-500">
          The planner writes the plan document here before the swarm starts.
        </p>
      </div>
    );
  }

  const awaitingDecision =
    plan.status === "awaiting_approval" ||
    (runStatus === "awaiting_approval" && plan.status === "draft");
  const editable =
    plan.status === "draft" || plan.status === "awaiting_approval";

  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    try {
      await post(`/api/plans/${encodeURIComponent(plan.id)}/decision`, { decision });
      toast(decision === "approve" ? "Plan approved" : "Plan rejected", "success");
      onChanged?.();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : `Failed to ${decision} plan`, "error");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = () => {
    setDraft(JSON.parse(JSON.stringify(content)) as PlanContent);
    setEditing(true);
    setTab("document");
  };

  const saveEdit = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      // Route schemas accept the edited plan as `contentJson` (row column)
      // or `content`; send both — non-strict validators strip the extra key.
      await patch(`/api/plans/${encodeURIComponent(plan.id)}`, {
        contentJson: draft,
        content: draft,
      });
      toast("Plan updated", "success");
      setEditing(false);
      setDraft(null);
      onChanged?.();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Failed to save plan", "error");
    } finally {
      setBusy(false);
    }
  };

  const view = editing && draft ? draft : content;

  const setDraftArray = (key: keyof PlanContent, lines: string) => {
    setDraft((d) =>
      d ? { ...d, [key]: lines.split("\n").map((l) => l.trim()).filter(Boolean) } : d
    );
  };
  const setDraftText = (key: keyof PlanContent, text: string) => {
    setDraft((d) => (d ? { ...d, [key]: text } : d));
  };

  return (
    <div className={clsx("flex min-h-0 flex-col gap-3", className)}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={awaitingDecision ? "amber" : plan.status === "approved" || plan.status === "executing" || plan.status === "completed" ? "sage" : "stone"}>
          {plan.status.replace(/_/g, " ")}
        </Badge>
        <span className="text-xs text-stone-500">mode: {plan.mode.replace(/_/g, " ")}</span>
        <div className="ml-auto flex items-center gap-2">
          {editable && !editing && (
            <Button size="sm" variant="secondary" onClick={startEdit}>
              Edit plan
            </Button>
          )}
          {editing && (
            <>
              <Button size="sm" onClick={() => void saveEdit()} loading={busy}>
                Save changes
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setDraft(null);
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Approve / reject bar */}
      {awaitingDecision && !editing && (
        <div
          role="region"
          aria-label="Plan decision"
          className="flex flex-wrap items-center gap-3 rounded-md border border-copper-700 bg-ink-850 p-3"
        >
          <p className="text-sm text-stone-200">
            This plan is waiting for your decision before execution.
          </p>
          <div className="ml-auto flex gap-2">
            <Button size="sm" onClick={() => void decide("approve")} loading={busy}>
              Approve plan
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => void decide("reject")}
              disabled={busy}
            >
              Reject
            </Button>
          </div>
        </div>
      )}

      <Tabs
        tabs={[
          { id: "document", label: "Document" },
          { id: "board", label: "Board hint" },
          { id: "json", label: "JSON" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "json" ? (
        <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-ink-700 bg-ink-950 p-3 font-mono text-xs text-stone-400">
          {JSON.stringify(view, null, 2)}
        </pre>
      ) : tab === "board" ? (
        <div className="rounded-md border border-ink-700 bg-ink-900 p-6 text-center">
          <p className="text-sm text-stone-300">
            The <span className="font-medium text-copper-400">Board</span> tab tracks
            these {view.tasks.length} tasks live as the swarm executes them.
          </p>
          <p className="mt-1 text-xs text-stone-500">
            Tasks move pending → active → completed as agents pick them up.
          </p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto lg:grid-cols-2">
          {/* Summary */}
          <Section title="Summary">
            {editing ? (
              <textarea
                value={draft?.summary ?? ""}
                onChange={(e) => setDraftText("summary", e.target.value)}
                rows={3}
                aria-label="Edit summary"
                className="w-full rounded-md border border-ink-700 bg-ink-950 p-2 text-sm text-stone-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm text-stone-300">{view.summary}</p>
            )}
          </Section>

          {/* Array sections */}
          {ARRAY_SECTIONS.map(({ key, label }) => (
            <Section key={key} title={label}>
              {editing ? (
                <textarea
                  value={((draft?.[key] as string[]) ?? []).join("\n")}
                  onChange={(e) => setDraftArray(key, e.target.value)}
                  rows={4}
                  aria-label={`Edit ${label} (one per line)`}
                  className="w-full rounded-md border border-ink-700 bg-ink-950 p-2 font-mono text-xs text-stone-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
                />
              ) : (
                <StringList items={(view[key] as string[]) ?? []} />
              )}
            </Section>
          ))}

          {/* Text sections */}
          {TEXT_SECTIONS.map(({ key, label }) => (
            <Section key={key} title={label}>
              {editing ? (
                <textarea
                  value={(draft?.[key] as string) ?? ""}
                  onChange={(e) => setDraftText(key, e.target.value)}
                  rows={4}
                  aria-label={`Edit ${label}`}
                  className="w-full rounded-md border border-ink-700 bg-ink-950 p-2 text-sm text-stone-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm text-stone-300">
                  {(view[key] as string) || "—"}
                </p>
              )}
            </Section>
          ))}

          {/* Tech choices */}
          <Section title="Tech choices">
            {view.techChoices.length === 0 ? (
              <p className="text-sm text-stone-600">—</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {view.techChoices.map((t, i) => (
                  <li key={i}>
                    <span className="font-medium text-copper-400">{t.name}</span>
                    <span className="text-stone-400"> — {t.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Risks */}
          <Section title="Risks">
            {view.risks.length === 0 ? (
              <p className="text-sm text-stone-600">—</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {view.risks.map((r, i) => (
                  <li key={i}>
                    <p className="text-ember-400">{r.risk}</p>
                    <p className="text-stone-400">mitigation: {r.mitigation}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Tasks */}
          <div className="lg:col-span-2">
            <Section title={`Tasks (${view.tasks.length})`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink-700 text-left text-xs uppercase tracking-wide text-stone-500">
                      <th className="py-1.5 pr-3 font-medium">Title</th>
                      <th className="py-1.5 pr-3 font-medium">Role</th>
                      <th className="py-1.5 pr-3 font-medium">Type</th>
                      <th className="py-1.5 font-medium">Depends on</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.tasks.map((t, i) => (
                      <tr key={t.id} className="border-b border-ink-700/50 last:border-b-0">
                        <td className="py-1.5 pr-3 text-stone-200">
                          {editing ? (
                            <input
                              value={draft?.tasks[i]?.title ?? ""}
                              onChange={(e) =>
                                setDraft((d) => {
                                  if (!d) return d;
                                  const tasks = [...d.tasks];
                                  tasks[i] = { ...tasks[i], title: e.target.value };
                                  return { ...d, tasks };
                                })
                              }
                              aria-label={`Edit title of task ${t.id}`}
                              className="w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-sm text-stone-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
                            />
                          ) : (
                            t.title
                          )}
                        </td>
                        <td className="py-1.5 pr-3">
                          <Badge tone="copper">{t.role}</Badge>
                        </td>
                        <td className="py-1.5 pr-3 text-stone-400">{t.taskType}</td>
                        <td className="py-1.5 text-stone-400">
                          {editing ? (
                            <input
                              value={(draft?.tasks[i]?.dependsOn ?? []).join(", ")}
                              onChange={(e) =>
                                setDraft((d) => {
                                  if (!d) return d;
                                  const tasks = [...d.tasks];
                                  tasks[i] = {
                                    ...tasks[i],
                                    dependsOn: e.target.value
                                      .split(",")
                                      .map((s) => s.trim())
                                      .filter(Boolean),
                                  };
                                  return { ...d, tasks };
                                })
                              }
                              aria-label={`Edit dependencies of task ${t.id} (comma separated)`}
                              className="w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1 font-mono text-xs text-stone-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
                            />
                          ) : t.dependsOn.length > 0 ? (
                            <span className="font-mono text-xs">{t.dependsOn.join(", ")}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}
