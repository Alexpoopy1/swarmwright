"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Download, FileCode2, FileText, Folder, PlayCircle } from "lucide-react";
import { get } from "@/lib/api";
import { timeAgo, usd } from "@/lib/format";
import type { RunStatus } from "@/types";
import { Badge, Button, EmptyState, ResizablePanels, Skeleton, toast } from "@/components/ui";

interface FileEntryLite {
  path: string;
  version: number;
  updatedAt?: string;
}

interface FileDetail {
  path: string;
  content: string;
  version: number;
  language?: string | null;
  updatedAt?: string;
  versions?: Array<{ version: number; createdAt?: string }>;
}

interface RunLite {
  id: string;
  goal: string;
  status: RunStatus;
  costUsd?: number;
}

interface ProjectDetail {
  id: string;
  name: string;
  description?: string | null;
  files?: FileEntryLite[];
}

/* Minimal hljs theme aligned with the ink/copper palette. */
const HLJS_CSS = `
.hljs{color:#d6d3cd}
.hljs-keyword,.hljs-selector-tag,.hljs-built_in{color:#dd9660}
.hljs-string,.hljs-regexp,.hljs-addition{color:#8fae8b}
.hljs-comment,.hljs-quote{color:#78716c;font-style:italic}
.hljs-number,.hljs-literal{color:#e8b07f}
.hljs-title,.hljs-name,.hljs-attr{color:#e7e5e4}
.hljs-deletion{color:#e0725c}
`;

function groupByFolder(files: FileEntryLite[]): Array<[string, FileEntryLite[]]> {
  const groups = new Map<string, FileEntryLite[]>();
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const idx = f.path.lastIndexOf("/");
    const folder = idx === -1 ? "" : f.path.slice(0, idx);
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder)!.push(f);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function langFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", css: "css", html: "xml", md: "markdown", py: "python",
    sql: "sql", sh: "bash", yml: "yaml", yaml: "yaml",
  };
  return map[ext] ?? "plaintext";
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [project, setProject] = React.useState<ProjectDetail | null>(null);
  const [files, setFiles] = React.useState<FileEntryLite[] | null>(null);
  const [error, setError] = React.useState(false);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [fileDetail, setFileDetail] = React.useState<FileDetail | null>(null);
  const [fileLoading, setFileLoading] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState<string | null>(null);
  const [runs, setRuns] = React.useState<RunLite[] | null>(null);
  const [exporting, setExporting] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const [p, f, r] = await Promise.allSettled([
        get<ProjectDetail>(`/api/projects/${projectId}`),
        get<{ files?: FileEntryLite[] } | FileEntryLite[]>(`/api/projects/${projectId}/files`),
        get<{ runs?: RunLite[] } | RunLite[]>(`/api/runs?projectId=${projectId}`),
      ]);
      if (p.status === "fulfilled") setProject(p.value);
      if (f.status === "fulfilled") {
        const v = f.value;
        setFiles(Array.isArray(v) ? v : v.files ?? []);
      } else if (p.status === "fulfilled" && p.value.files) {
        setFiles(p.value.files);
      }
      if (r.status === "fulfilled") {
        const v = r.value;
        setRuns(Array.isArray(v) ? v : v.runs ?? []);
      }
      if (p.status === "rejected" && f.status === "rejected") setError(true);
      else setError(false);
    } catch {
      setError(true);
    }
  }, [projectId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Load file content + highlight.js lazily.
  React.useEffect(() => {
    if (!selectedPath) return;
    let cancelled = false;
    setFileLoading(true);
    setHighlighted(null);
    get<FileDetail>(`/api/projects/${projectId}/file?path=${encodeURIComponent(selectedPath)}`)
      .then(async (detail) => {
        if (cancelled) return;
        setFileDetail(detail);
        try {
          const hljs = (await import("highlight.js/lib/common")).default;
          const lang = detail.language ?? langFromPath(detail.path);
          const result = hljs.getLanguage(lang)
            ? hljs.highlight(detail.content, { language: lang })
            : hljs.highlightAuto(detail.content);
          if (!cancelled) setHighlighted(result.value);
        } catch {
          if (!cancelled) setHighlighted(null);
        }
      })
      .catch((err) => {
        if (!cancelled) toast(err instanceof Error ? err.message : "Could not load file", "error");
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedPath]);

  async function exportProject() {
    setExporting(true);
    try {
      const bundle = await get<{ name: string; files: Array<{ path: string; content: string }> }>(
        `/api/projects/${projectId}/export`
      );
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${bundle.name || "project"}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("Project exported", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Export failed", "error");
    } finally {
      setExporting(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <EmptyState
          title="Could not load project"
          action={
            <Button size="sm" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  const treePane = (
    <div className="p-3">
      <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-stone-500">Files</p>
      {files === null && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6" />
          <Skeleton className="h-6" />
          <Skeleton className="h-6" />
        </div>
      )}
      {files !== null && files.length === 0 && (
        <div className="px-1 py-8 text-center">
          <FileCode2 size={22} className="mx-auto text-stone-600" />
          <p className="mt-2 text-sm text-stone-400">No files yet</p>
          <p className="mt-1 text-xs leading-5 text-stone-500">
            Files your agents create will appear here —{" "}
            <Link href="/app/runs?new=1" className="text-copper-400 hover:underline">
              start a run
            </Link>
            .
          </p>
        </div>
      )}
      {groupByFolder(files ?? []).map(([folder, entries]) => (
        <div key={folder || "(root)"} className="mb-2">
          {folder && (
            <p className="flex items-center gap-1.5 px-1 py-1 font-mono text-xs text-stone-500">
              <Folder size={11} aria-hidden /> {folder}/
            </p>
          )}
          {entries.map((f) => {
            const active = f.path === selectedPath;
            return (
              <button
                key={f.path}
                onClick={() => setSelectedPath(f.path)}
                aria-current={active ? "true" : undefined}
                className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left font-mono text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500 ${
                  active ? "bg-ink-800 text-copper-300" : "text-stone-300 hover:bg-ink-850"
                }`}
              >
                <FileText size={11} className="shrink-0 text-stone-500" aria-hidden />
                <span className="truncate">{f.path.split("/").pop()}</span>
                <span className="ml-auto shrink-0 text-[10px] text-stone-600">v{f.version}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );

  const viewerPane = (
    <div className="flex h-full flex-col">
      <style>{HLJS_CSS}</style>
      {!selectedPath && (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-stone-500">
          Select a file to view it.
        </div>
      )}
      {selectedPath && (
        <>
          <div className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
            <span className="truncate font-mono text-xs text-stone-300">{selectedPath}</span>
            {fileDetail && (
              <span className="shrink-0 text-xs text-stone-500">
                v{fileDetail.version}
                {fileDetail.updatedAt ? ` · ${timeAgo(fileDetail.updatedAt)}` : ""}
              </span>
            )}
          </div>
          <div className="flex-1 overflow-auto">
            {fileLoading && <Skeleton className="m-3 h-40" />}
            {!fileLoading && fileDetail && (
              <pre className="p-3 text-xs leading-5">
                {highlighted !== null ? (
                  <code className="hljs font-mono" dangerouslySetInnerHTML={{ __html: highlighted }} />
                ) : (
                  <code className="font-mono text-stone-300">{fileDetail.content}</code>
                )}
              </pre>
            )}
          </div>
        </>
      )}
    </div>
  );

  const metaPane = (
    <div className="flex flex-col gap-4 p-3">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Project</p>
        <p className="text-sm font-medium text-stone-100">{project?.name ?? "…"}</p>
        {project?.description && <p className="mt-1 text-xs leading-5 text-stone-500">{project.description}</p>}
        <Button size="sm" className="mt-2" onClick={() => void exportProject()} loading={exporting}>
          <Download size={12} /> Export project (JSON)
        </Button>
      </div>

      {fileDetail?.versions && fileDetail.versions.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Version history</p>
          <ul className="flex flex-col gap-1">
            {fileDetail.versions.map((v) => (
              <li key={v.version} className="flex justify-between rounded-md border border-ink-800 bg-ink-900 px-2 py-1 font-mono text-xs text-stone-400">
                <span>v{v.version}</span>
                {v.createdAt && <span>{timeAgo(v.createdAt)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Runs for this project</p>
        {runs === null && <Skeleton className="h-16" />}
        {runs !== null && runs.length === 0 && (
          <p className="text-xs text-stone-500">
            No runs yet —{" "}
            <Link href="/app/runs?new=1" className="text-copper-400 hover:underline">
              start one
            </Link>
            .
          </p>
        )}
        <ul className="flex flex-col gap-1.5">
          {(runs ?? []).map((r) => (
            <li key={r.id}>
              <Link
                href={`/app/runs/${r.id}`}
                className="flex items-center gap-2 rounded-md border border-ink-800 bg-ink-900 px-2 py-1.5 transition-colors hover:border-ink-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
              >
                <PlayCircle size={12} className="shrink-0 text-stone-500" />
                <span className="min-w-0 flex-1 truncate text-xs text-stone-300">{r.goal}</span>
                <Badge tone={r.status === "completed" ? "sage" : r.status === "failed" ? "ember" : "copper"}>
                  {r.status.replace("_", " ")}
                </Badge>
                {typeof r.costUsd === "number" && (
                  <span className="font-mono text-[10px] text-stone-500">{usd(r.costUsd)}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-800 px-4 py-2.5">
        <div>
          <h1 className="text-sm font-semibold text-stone-100">{project?.name ?? "Project"}</h1>
          <p className="font-mono text-xs text-stone-600">{projectId}</p>
        </div>
        <Link href="/app/projects" className="text-xs text-stone-500 hover:text-stone-300">
          All projects
        </Link>
      </div>
      <div className="min-h-0 flex-1">
        <ResizablePanels
          storageKey={`project.${projectId}.outer`}
          defaultRatio={0.24}
          minRatio={0.14}
          left={treePane}
          right={
            <ResizablePanels
              storageKey={`project.${projectId}.inner`}
              defaultRatio={0.68}
              minRatio={0.35}
              left={viewerPane}
              right={metaPane}
            />
          }
        />
      </div>
    </div>
  );
}
