/**
 * /app/runs/[id]/timemachine — full-screen Swarm Time Machine (SPEC §6.2).
 */
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { TimeMachine } from "@/components/swarm/TimeMachine";

export default function TimeMachinePage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <Link
          href={`/app/runs/${runId}`}
          className="inline-flex items-center gap-1 text-sm text-stone-400 hover:text-stone-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to run
        </Link>
        <h1 className="text-lg font-semibold text-stone-100">Time Machine</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <TimeMachine runId={runId} />
      </div>
    </div>
  );
}
