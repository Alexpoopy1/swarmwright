"use client";

import * as React from "react";
import { Check, FlaskConical, Play, Plus, Wrench, X } from "lucide-react";
import { get, post } from "@/lib/api";
import { durationMs, timeAgo } from "@/lib/format";
import type { RiskLevel, ToolPermission, ToolRunResult, ToolType } from "@/types";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Input,
  Select,
  Skeleton,
  toast,
} from "@/components/ui";

interface ToolRow {
  id: string;
  name: string;
  type: ToolType;
  version?: number;
  riskLevel?: RiskLevel;
  status?: string;
  authorAgentId?: string | null;
  author?: string | null;
  executionsCount?: number;
  createdAt?: string;
  projectId?: string | null;
}

interface ToolExecution {
  id: string;
  status?: string;
  ok?: boolean;
  durationMs?: number;
  createdAt?: string;
}

interface ToolDetail extends ToolRow {
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  sourceCode?: string;
  testCode?: string;
  permissions?: ToolPermission[];
  timeoutMs?: number;
  executions?: ToolExecution[];
}

interface ProjectLite {
  id: string;
  name: string;
}

const TOOL_TYPES: ToolType[] = [
  "js_function", "http", "shell", "file_transform", "search", "code_analysis", "automation",
];

const PERMISSIONS: ToolPermission[] = [
  "network", "secrets", "package_install", "db_write", "file_delete", "shell", "deploy", "git_push", "filesystem",
];

const RISK_TONE: Record<string, "sage" | "amber" | "ember"> = {
  low: "sage",
  medium: "amber",
  high: "ember",
};

const STATUS_TONE: Record<string, "sage" | "amber" | "ember" | "stone"> = {
  approved: "sage",
  active: "sage",
  pending_approval: "amber",
  rejected: "ember",
  archived: "stone",
};

const textareaCls =
  "w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 font-mono text-xs text-stone-200 placeholder:text-stone-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500";

export default function ToolsPage() {
  const [tools, setTools] = React.useState<ToolRow[] | null>(null);
  const [projects, setProjects] = React.useState<ProjectLite[]>([]);
  const [error, setError] = React.useState(false);
  const [projectFilter, setProjectFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");
  const [detail, setDetail] = React.useState<ToolDetail | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [builderOpen, setBuilderOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // Sandbox run state
  const [sandboxInput, setSandboxInput] = React.useState("{}");
  const [sandboxResult, setSandboxResult] = React.useState<ToolRunResult | null>(null);
  const [sandboxBusy, setSandboxBusy] = React.useState(false);

  // Builder form
  const [bName, setBName] = React.useState("");
  const [bType, setBType] = React.useState<ToolType>("js_function");
  const [bDesc, setBDesc] = React.useState("");
  const [bPerms, setBPerms] = React.useState<Set<ToolPermission>>(new Set());
  const [bSchema, setBSchema] = React.useState('{\n  "type": "object",\n  "properties": {}\n}');
  const [bSource, setBSource] = React.useState("// (input) => output\nreturn input;");
  const [bTest, setBTest] = React.useState("");
  const [bTimeout, setBTimeout] = React.useState(30000);

  const load = React.useCallback(async () => {
    try {
      const qs = projectFilter ? `?projectId=${encodeURIComponent(projectFilter)}` : "";
      const res = await get<{ tools?: ToolRow[] } | ToolRow[]>(`/api/tools${qs}`);
      setTools(Array.isArray(res) ? res : res.tools ?? []);
      setError(false);
    } catch {
      setError(true);
    }
  }, [projectFilter]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    get<{ projects?: ProjectLite[] } | ProjectLite[]>("/api/projects")
      .then((res) => setProjects(Array.isArray(res) ? res : res.projects ?? []))
      .catch(() => {});
  }, []);

  async function openDetail(t: ToolRow) {
    setDetailOpen(true);
    setDetail(null);
    setDetailLoading(true);
    setSandboxResult(null);
    setSandboxInput("{}");
    try {
      const d = await get<ToolDetail & { tool?: ToolDetail }>(`/api/tools/${t.id}`);
      setDetail(d.tool ?? d);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not load tool", "error");
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  async function approve(id: string, approve_: boolean) {
    try {
      await post(`/api/tools/${id}/approve`, { approve: approve_ });
      toast(approve_ ? "Tool approved" : "Tool rejected", "success");
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Action failed", "error");
    }
  }

  async function runSandbox() {
    if (!detail) return;
    let input: unknown;
    try {
      input = JSON.parse(sandboxInput);
    } catch {
      toast("Input is not valid JSON", "error");
      return;
    }
    setSandboxBusy(true);
    setSandboxResult(null);
    try {
      const res = await post<ToolRunResult & { result?: ToolRunResult }>(`/api/tools/${detail.id}/execute`, {
        input,
        autonomy: "auto",
      });
      setSandboxResult(res.result ?? res);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Execution failed", "error");
    } finally {
      setSandboxBusy(false);
    }
  }

  async function createTool(e: React.FormEvent) {
    e.preventDefault();
    let inputSchema: Record<string, unknown>;
    try {
      inputSchema = JSON.parse(bSchema) as Record<string, unknown>;
    } catch {
      toast("Input schema is not valid JSON", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await post<{ status?: string; error?: string; testResult?: ToolRunResult }>("/api/tools", {
        name: bName.trim(),
        type: bType,
        description: bDesc.trim(),
        inputSchema,
        sourceCode: bSource,
        testCode: bTest,
        permissions: [...bPerms],
        timeoutMs: bTimeout,
      });
      if (res.error) {
        toast(`Validation failed: ${res.error}`, "error");
      } else {
        const tested = res.testResult ? (res.testResult.ok ? "tests passed" : "tests failed") : null;
        toast(
          `Tool saved${res.status ? ` — status: ${res.status.replace("_", " ")}` : ""}${tested ? `, ${tested}` : ""}`,
          res.testResult && !res.testResult.ok ? "error" : "success"
        );
        setBuilderOpen(false);
        setBName("");
        setBDesc("");
        setBPerms(new Set());
        await load();
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not create tool", "error");
    } finally {
      setBusy(false);
    }
  }

  const filtered = (tools ?? []).filter(
    (t) =>
      (!statusFilter || (t.status ?? "approved") === statusFilter) &&
      (!projectFilter || t.projectId === projectFilter || t.projectId == null)
  );
  const pending = filtered.filter((t) => t.status === "pending_approval");

  const loading = tools === null && !error;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-stone-100">Tool Registry</h1>
          <p className="mt-0.5 text-sm text-stone-500">
            Tools your agents build, test, and run in the sandbox. High-risk permissions require
            approval before execution.
          </p>
        </div>
        <Button size="sm" variant="primary" onClick={() => setBuilderOpen(true)}>
          <Plus size={13} /> New tool
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Select
          aria-label="Filter by project"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="w-48"
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
        <Select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-44"
        >
          <option value="">All statuses</option>
          <option value="approved">approved</option>
          <option value="pending_approval">pending approval</option>
          <option value="rejected">rejected</option>
          <option value="archived">archived</option>
        </Select>
      </div>

      {pending.length > 0 && (
        <section className="mt-5 rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
          <h2 className="text-sm font-semibold text-amber-400">Pending approval ({pending.length})</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {pending.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-ink-700 bg-ink-900 px-3 py-2"
              >
                <Wrench size={14} className="text-stone-500" />
                <button
                  onClick={() => void openDetail(t)}
                  className="font-mono text-sm text-copper-300 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
                >
                  {t.name}
                </button>
                <Badge tone={RISK_TONE[t.riskLevel ?? "low"]}>{t.riskLevel ?? "low"} risk</Badge>
                <span className="ml-auto flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => void approve(t.id, true)}>
                    <Check size={12} /> Approve
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void approve(t.id, false)}>
                    <X size={12} /> Reject
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-5">
        {loading && <Skeleton className="h-64" />}
        {error && (
          <EmptyState
            title="Could not load tools"
            action={
              <Button size="sm" onClick={() => void load()}>
                Retry
              </Button>
            }
          />
        )}
        {!loading && !error && filtered.length === 0 && (
          <EmptyState
            icon={<Wrench size={26} />}
            title="No tools in the registry"
            hint="Tools appear here when agents propose them during runs — or build one manually."
            action={
              <Button size="sm" variant="primary" onClick={() => setBuilderOpen(true)}>
                <Plus size={13} /> New tool
              </Button>
            }
          />
        )}
        {!loading && !error && filtered.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-ink-700">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-700 bg-ink-900 text-xs text-stone-500">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Version</th>
                  <th className="px-3 py-2 font-medium">Risk</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Author</th>
                  <th className="px-3 py-2 font-medium">Executions</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => void openDetail(t)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void openDetail(t);
                    }}
                    tabIndex={0}
                    className="cursor-pointer border-b border-ink-800 bg-ink-950 transition-colors hover:bg-ink-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-copper-500"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-copper-300">{t.name}</td>
                    <td className="px-3 py-2"><Badge tone="stone">{t.type}</Badge></td>
                    <td className="px-3 py-2 font-mono text-xs text-stone-400">v{t.version ?? 1}</td>
                    <td className="px-3 py-2"><Badge tone={RISK_TONE[t.riskLevel ?? "low"]}>{t.riskLevel ?? "low"}</Badge></td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS_TONE[t.status ?? "approved"] ?? "stone"}>
                        {(t.status ?? "approved").replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-stone-400">{t.author ?? t.authorAgentId ?? "manual"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-stone-300">{t.executionsCount ?? 0}</td>
                    <td className="px-3 py-2 text-xs text-stone-500">{t.createdAt ? timeAgo(t.createdAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tool detail dialog */}
      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} title={detail?.name ?? "Tool"} wide>
        {detailLoading && <Skeleton className="h-64" />}
        {detail && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="stone">{detail.type}</Badge>
              <Badge tone={RISK_TONE[detail.riskLevel ?? "low"]}>{detail.riskLevel ?? "low"} risk</Badge>
              <Badge tone={STATUS_TONE[detail.status ?? "approved"] ?? "stone"}>
                {(detail.status ?? "approved").replace("_", " ")}
              </Badge>
              <span className="font-mono text-xs text-stone-500">v{detail.version ?? 1}</span>
              {(detail.permissions ?? []).map((p) => (
                <Badge key={p} tone="amber">{p}</Badge>
              ))}
            </div>
            {detail.description && <p className="text-sm leading-6 text-stone-300">{detail.description}</p>}

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-stone-500">Input schema</p>
                <pre className="max-h-40 overflow-auto rounded-md border border-ink-700 bg-ink-950 p-2 font-mono text-xs text-stone-300">
                  {JSON.stringify(detail.inputSchema ?? {}, null, 2)}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-stone-500">Output schema</p>
                <pre className="max-h-40 overflow-auto rounded-md border border-ink-700 bg-ink-950 p-2 font-mono text-xs text-stone-300">
                  {JSON.stringify(detail.outputSchema ?? {}, null, 2)}
                </pre>
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-stone-500">Source code</p>
              <pre className="max-h-56 overflow-auto rounded-md border border-ink-700 bg-ink-950 p-3 font-mono text-xs leading-5 text-stone-200">
                {detail.sourceCode ?? "// not available"}
              </pre>
            </div>
            {detail.testCode && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-stone-500">Test code</p>
                <pre className="max-h-40 overflow-auto rounded-md border border-ink-700 bg-ink-950 p-3 font-mono text-xs leading-5 text-stone-200">
                  {detail.testCode}
                </pre>
              </div>
            )}

            {detail.executions && detail.executions.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-stone-500">Execution history</p>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-ink-700 text-xs text-stone-500">
                      <th className="py-1.5 pr-3 font-medium">Status</th>
                      <th className="py-1.5 pr-3 font-medium">Duration</th>
                      <th className="py-1.5 font-medium">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.executions.slice(0, 10).map((ex) => {
                      const ok = ex.ok ?? (ex.status === "completed");
                      return (
                        <tr key={ex.id} className="border-b border-ink-800">
                          <td className="py-1.5 pr-3">
                            <Badge tone={ok ? "sage" : "ember"}>{ex.status ?? (ok ? "ok" : "failed")}</Badge>
                          </td>
                          <td className="py-1.5 pr-3 font-mono text-xs text-stone-300">
                            {ex.durationMs !== undefined ? durationMs(ex.durationMs) : "—"}
                          </td>
                          <td className="py-1.5 text-xs text-stone-500">{ex.createdAt ? timeAgo(ex.createdAt) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Run in sandbox */}
            <div className="rounded-md border border-ink-700 bg-ink-850 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-stone-200">
                <FlaskConical size={14} className="text-copper-400" /> Run in sandbox
              </p>
              <label htmlFor="sandbox-input" className="mb-1 mt-3 block text-xs text-stone-500">
                Input (JSON)
              </label>
              <textarea
                id="sandbox-input"
                value={sandboxInput}
                onChange={(e) => setSandboxInput(e.target.value)}
                rows={3}
                className={textareaCls}
                spellCheck={false}
              />
              <Button size="sm" className="mt-2" onClick={() => void runSandbox()} loading={sandboxBusy}>
                <Play size={12} /> Execute
              </Button>
              {sandboxResult && (
                <div className="mt-3 rounded-md border border-ink-700 bg-ink-950 p-3">
                  <div className="flex items-center gap-2">
                    <Badge tone={sandboxResult.ok ? "sage" : "ember"}>
                      {sandboxResult.ok ? "ok" : "failed"}
                    </Badge>
                    <span className="font-mono text-xs text-stone-500">
                      {durationMs(sandboxResult.durationMs)}
                    </span>
                  </div>
                  {sandboxResult.error && (
                    <p className="mt-2 text-sm text-ember-400">{sandboxResult.error}</p>
                  )}
                  {sandboxResult.output !== undefined && (
                    <pre className="mt-2 max-h-40 overflow-auto font-mono text-xs text-stone-300">
                      {JSON.stringify(sandboxResult.output, null, 2)}
                    </pre>
                  )}
                  {sandboxResult.logs.length > 0 && (
                    <pre className="mt-2 max-h-32 overflow-auto border-t border-ink-800 pt-2 font-mono text-xs text-stone-500">
                      {sandboxResult.logs.join("\n")}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </Dialog>

      {/* Builder dialog */}
      <Dialog open={builderOpen} onClose={() => setBuilderOpen(false)} title="New tool" wide>
        <form onSubmit={createTool} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="tb-name" className="mb-1 block text-sm text-stone-300">Name</label>
              <Input
                id="tb-name"
                value={bName}
                onChange={(e) => setBName(e.target.value)}
                placeholder="my_tool_name"
                pattern="[a-z][a-z0-9_]{2,40}"
                title="Lowercase letters, digits, underscores (3–41 chars)"
                required
              />
            </div>
            <div>
              <label htmlFor="tb-type" className="mb-1 block text-sm text-stone-300">Type</label>
              <Select id="tb-type" value={bType} onChange={(e) => setBType(e.target.value as ToolType)}>
                {TOOL_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <label htmlFor="tb-desc" className="mb-1 block text-sm text-stone-300">Description</label>
            <Input id="tb-desc" value={bDesc} onChange={(e) => setBDesc(e.target.value)} required />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm text-stone-300">Permissions</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {PERMISSIONS.map((p) => (
                <label key={p} className="flex cursor-pointer items-center gap-1.5 text-xs text-stone-300">
                  <input
                    type="checkbox"
                    checked={bPerms.has(p)}
                    onChange={(e) => {
                      setBPerms((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(p);
                        else next.delete(p);
                        return next;
                      });
                    }}
                    className="h-3.5 w-3.5 accent-copper-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
                  />
                  {p}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-stone-500">
              High-risk permissions require approval before execution.
            </p>
          </fieldset>
          <div>
            <label htmlFor="tb-schema" className="mb-1 block text-sm text-stone-300">Input schema (JSON)</label>
            <textarea id="tb-schema" value={bSchema} onChange={(e) => setBSchema(e.target.value)} rows={4} className={textareaCls} spellCheck={false} />
          </div>
          <div>
            <label htmlFor="tb-source" className="mb-1 block text-sm text-stone-300">Source code</label>
            <textarea id="tb-source" value={bSource} onChange={(e) => setBSource(e.target.value)} rows={6} className={textareaCls} spellCheck={false} required />
          </div>
          <div>
            <label htmlFor="tb-test" className="mb-1 block text-sm text-stone-300">
              Test code <span className="text-stone-500">(runs in the sandbox before registration)</span>
            </label>
            <textarea id="tb-test" value={bTest} onChange={(e) => setBTest(e.target.value)} rows={4} className={textareaCls} spellCheck={false} />
          </div>
          <div>
            <label htmlFor="tb-timeout" className="mb-1 block text-sm text-stone-300">Timeout (ms)</label>
            <Input
              id="tb-timeout"
              type="number"
              min={1000}
              max={120000}
              value={bTimeout}
              onChange={(e) => setBTimeout(Number(e.target.value))}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setBuilderOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Validate, test &amp; save
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
