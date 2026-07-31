import type { PlanTask } from "@/types";

/**
 * TaskGraph — pure dependency-graph logic over a plan's tasks.
 * No I/O, no imports from server modules: trivially unit-testable (SPEC §4.6).
 *
 * Conventions:
 * - Task ids come from the plan (PlanTask.id), not DB row ids.
 * - A dependency on an unknown id is treated as unsatisfiable (the task can
 *   never become ready) — safe default: never execute work whose stated
 *   prerequisites cannot be verified.
 */
export class TaskGraph {
  private readonly tasks: PlanTask[];
  private readonly byId = new Map<string, PlanTask>();

  constructor(tasks: PlanTask[]) {
    // First occurrence wins on duplicate ids; later duplicates are ignored so
    // readyTasks never returns the same logical task twice.
    this.tasks = [];
    for (const t of tasks) {
      if (this.byId.has(t.id)) continue;
      this.byId.set(t.id, t);
      this.tasks.push(t);
    }
  }

  /** All task ids in the graph (deduplicated, plan order). */
  get ids(): string[] {
    return this.tasks.map((t) => t.id);
  }

  get size(): number {
    return this.tasks.length;
  }

  get(id: string): PlanTask | undefined {
    return this.byId.get(id);
  }

  /**
   * Tasks whose dependencies are all completed and that are not themselves
   * completed, active, or failed. Returned in stable plan order so the engine
   * starts work deterministically.
   */
  readyTasks(completed: Set<string>, active: Set<string>, failed: Set<string>): PlanTask[] {
    return this.tasks.filter((t) => {
      if (completed.has(t.id) || active.has(t.id) || failed.has(t.id)) return false;
      return t.dependsOn.every((dep) => completed.has(dep));
    });
  }

  /**
   * Cycle detection via iterative DFS with a color map (white/gray/black).
   * Self-loops count as cycles. Dependencies on unknown ids are ignored here
   * (they cannot form a cycle; they are handled as unsatisfiable in readyTasks).
   */
  hasCycle(): boolean {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<string, number>(this.tasks.map((t) => [t.id, WHITE]));

    for (const start of this.tasks) {
      if (color.get(start.id) !== WHITE) continue;
      const stack: Array<{ id: string; depIndex: number }> = [{ id: start.id, depIndex: 0 }];
      color.set(start.id, GRAY);
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        const task = this.byId.get(frame.id)!;
        if (frame.depIndex >= task.dependsOn.length) {
          color.set(frame.id, BLACK);
          stack.pop();
          continue;
        }
        const dep = task.dependsOn[frame.depIndex++];
        if (!this.byId.has(dep)) continue; // unknown dep: not part of the graph
        const c = color.get(dep);
        if (c === GRAY) return true; // back edge → cycle
        if (c === WHITE) {
          color.set(dep, GRAY);
          stack.push({ id: dep, depIndex: 0 });
        }
      }
    }
    return false;
  }

  /**
   * Transitive dependents of `id` (every task directly or indirectly blocked
   * by it), in plan order, deduplicated, excluding `id` itself. Used when a
   * task fails permanently and the engine must know what else is doomed.
   */
  dependentsOf(id: string): string[] {
    // Build reverse adjacency: dep → tasks that depend on it.
    const reverse = new Map<string, string[]>();
    for (const t of this.tasks) {
      for (const dep of t.dependsOn) {
        if (!reverse.has(dep)) reverse.set(dep, []);
        reverse.get(dep)!.push(t.id);
      }
    }
    const seen = new Set<string>();
    const queue = [...(reverse.get(id) ?? [])];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const next of reverse.get(cur) ?? []) queue.push(next);
    }
    seen.delete(id);
    return this.tasks.filter((t) => seen.has(t.id)).map((t) => t.id);
  }

  /** True when every task in the graph is in `completed`. */
  isComplete(completed: Set<string>): boolean {
    return this.tasks.every((t) => completed.has(t.id));
  }
}
