/**
 * ApprovalsPanel — pending approval queue (SPEC §6.2 inspector).
 * Risk badge, title, expandable detail JSON, Approve/Reject wired to
 * POST /api/approvals/[id]. Sources approvals from the run detail payload.
 */
"use client";

import { useState } from "react";
import { Badge, Button, EmptyState, toast } from "@/components/ui";
import { post, ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { ShieldCheck } from "lucide-react";
import { parseJsonField, RISK_TONE, type ApprovalDto } from "@/components/swarm/shared";

export interface ApprovalsPanelProps {
  runId: string;
  approvals: ApprovalDto[];
  /** Called after a decision succeeds so the parent can refetch run detail. */
  onResolved?: () => void;
  className?: string;
}

export function ApprovalsPanel({ runId, approvals, onResolved, className }: ApprovalsPanelProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const pending = approvals.filter((a) => a.status === "pending");

  const decide = async (approvalId: string, decision: "approve" | "reject") => {
    setBusyId(approvalId);
    try {
      await post(`/api/approvals/${encodeURIComponent(approvalId)}`, { decision });
      toast(`Approval ${decision}d`, decision === "approve" ? "success" : "info");
      onResolved?.();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : `Failed to ${decision}`, "error");
    } finally {
      setBusyId(null);
    }
  };

  if (pending.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck className="h-5 w-5" aria-hidden />}
        title="No approvals pending"
        hint="Actions that need your sign-off will appear here."
      />
    );
  }

  return (
    <ul className={className} aria-label="Pending approvals">
      {pending.map((a) => {
        const detail = parseJsonField<Record<string, unknown>>(a.detailJson, {});
        const busy = busyId === a.id;
        return (
          <li
            key={a.id}
            className="mb-2 rounded-md border border-ink-700 bg-ink-900 p-3 last:mb-0"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-stone-200">{a.title}</p>
                <p className="mt-0.5 text-xs text-stone-500">
                  {a.kind.replace(/_/g, " ")} · {timeAgo(a.createdAt)}
                </p>
              </div>
              <Badge tone={RISK_TONE[a.riskLevel] ?? "stone"}>{a.riskLevel} risk</Badge>
            </div>
            {Object.keys(detail).length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-stone-400 hover:text-stone-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500">
                  Details
                </summary>
                <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-ink-700 bg-ink-950 p-2 font-mono text-xs text-stone-400">
                  {JSON.stringify(detail, null, 2)}
                </pre>
              </details>
            )}
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={() => void decide(a.id, "approve")}
                loading={busy}
                aria-label={`Approve ${a.title}`}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => void decide(a.id, "reject")}
                disabled={busy}
                aria-label={`Reject ${a.title}`}
              >
                Reject
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
