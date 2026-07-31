import { describe, it, expect } from "vitest";
import { TaskGraph } from "@/server/orchestrator/taskGraph";
import type { PlanTask } from "@/types";

function task(id: string, dependsOn: string[] = [], extra: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: `Task ${id}`,
    description: "",
    dependsOn,
    role: "coder",
    skills: [],
    parallelizable: true,
    taskType: "coding",
    ...extra,
  };
}

describe("TaskGraph.readyTasks", () => {
  it("returns roots when nothing is completed, in plan order", () => {
    const g = new TaskGraph([task("t3", ["t1"]), task("t1"), task("t2"), task("t4", ["t2", "t3"])]);
    const ready = g.readyTasks(new Set(), new Set(), new Set());
    expect(ready.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("unblocks dependents only when ALL deps are completed", () => {
    const g = new TaskGraph([task("a"), task("b"), task("c", ["a", "b"]), task("d", ["c"])]);
    expect(g.readyTasks(new Set(["a"]), new Set(), new Set()).map((t) => t.id)).toEqual(["b"]);
    expect(g.readyTasks(new Set(["a", "b"]), new Set(), new Set()).map((t) => t.id)).toEqual(["c"]);
    expect(g.readyTasks(new Set(["a", "b", "c"]), new Set(), new Set()).map((t) => t.id)).toEqual(["d"]);
  });

  it("excludes completed, active and failed tasks from the ready set", () => {
    const g = new TaskGraph([task("a"), task("b"), task("c")]);
    const ready = g.readyTasks(new Set(["a"]), new Set(["b"]), new Set(["c"]));
    expect(ready).toEqual([]);
  });

  it("treats a dependency on an unknown id as unsatisfiable", () => {
    const g = new TaskGraph([task("a", ["ghost"])]);
    expect(g.readyTasks(new Set(), new Set(), new Set())).toEqual([]);
    expect(g.hasCycle()).toBe(false);
  });

  it("deduplicates repeated task ids (first occurrence wins)", () => {
    const g = new TaskGraph([task("a"), task("a", ["b"])]);
    expect(g.size).toBe(1);
    expect(g.readyTasks(new Set(), new Set(), new Set()).map((t) => t.id)).toEqual(["a"]);
  });
});

describe("TaskGraph.hasCycle", () => {
  it("detects a direct cycle", () => {
    const g = new TaskGraph([task("a", ["b"]), task("b", ["a"])]);
    expect(g.hasCycle()).toBe(true);
  });

  it("detects an indirect cycle", () => {
    const g = new TaskGraph([task("a", ["c"]), task("b", ["a"]), task("c", ["b"]), task("d")]);
    expect(g.hasCycle()).toBe(true);
  });

  it("detects a self-loop", () => {
    const g = new TaskGraph([task("a", ["a"])]);
    expect(g.hasCycle()).toBe(true);
  });

  it("accepts a diamond DAG", () => {
    const g = new TaskGraph([
      task("a"),
      task("b", ["a"]),
      task("c", ["a"]),
      task("d", ["b", "c"]),
    ]);
    expect(g.hasCycle()).toBe(false);
  });

  it("accepts an empty graph and isolated nodes", () => {
    expect(new TaskGraph([]).hasCycle()).toBe(false);
    expect(new TaskGraph([task("a"), task("b")]).hasCycle()).toBe(false);
  });
});

describe("TaskGraph.dependentsOf", () => {
  it("returns direct and transitive dependents in plan order", () => {
    const g = new TaskGraph([
      task("a"),
      task("b", ["a"]),
      task("c", ["b"]),
      task("d", ["a"]),
      task("e"),
    ]);
    expect(g.dependentsOf("a")).toEqual(["b", "c", "d"]);
    expect(g.dependentsOf("b")).toEqual(["c"]);
    expect(g.dependentsOf("e")).toEqual([]);
  });

  it("excludes the task itself even in a cycle", () => {
    const g = new TaskGraph([task("a", ["b"]), task("b", ["a"])]);
    expect(g.dependentsOf("a")).toEqual(["b"]);
  });
});

describe("TaskGraph.isComplete", () => {
  it("is true only when every task is completed", () => {
    const g = new TaskGraph([task("a"), task("b", ["a"])]);
    expect(g.isComplete(new Set())).toBe(false);
    expect(g.isComplete(new Set(["a"]))).toBe(false);
    expect(g.isComplete(new Set(["a", "b"]))).toBe(true);
  });

  it("is true for an empty graph", () => {
    expect(new TaskGraph([]).isComplete(new Set())).toBe(true);
  });
});
