/**
 * Next.js instrumentation hook — runs once per server process.
 * Re-kicks durable orchestrator loops for runs a previous process left in
 * running/planning/paused. Best effort: recovery must never block boot.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { resumeInterruptedRuns } = await import("./server/orchestrator/engine");
    // Fire-and-forget: loops resume from durable DB state / latest checkpoint.
    void resumeInterruptedRuns().catch((err) => {
      console.error("[instrumentation] resumeInterruptedRuns failed:", err);
    });
  } catch (err) {
    console.error("[instrumentation] orchestrator recovery unavailable:", err);
  }
}
