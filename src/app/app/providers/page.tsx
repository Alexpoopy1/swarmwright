"use client";

import * as React from "react";
import { AlertTriangle, PlugZap, Plus, Server, Trash2 } from "lucide-react";
import { del, get, post } from "@/lib/api";
import { timeAgo, usd } from "@/lib/format";
import type { ModelInfo } from "@/types";
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

interface Connection {
  id: string;
  provider: string;
  label: string;
  status: "untested" | "ok" | "failed" | string;
  maskedHint?: string;
  lastCheckedAt?: string | null;
  createdAt?: string;
  metadataJson?: string | Record<string, unknown> | null;
}

const PROVIDERS = ["openai", "openrouter", "groq", "deepseek", "ollama", "openai-compatible"] as const;

const STATUS_TONE: Record<string, "sage" | "ember" | "stone"> = {
  ok: "sage",
  failed: "ember",
  untested: "stone",
};

function maskedHint(c: Connection): string {
  if (c.maskedHint) return c.maskedHint;
  const meta = typeof c.metadataJson === "string" ? safeParse(c.metadataJson) : c.metadataJson;
  const hint = (meta as Record<string, unknown> | null | undefined)?.maskedHint;
  if (typeof hint === "string") return hint;
  return c.provider === "mock" ? "no key needed" : "••••";
}

function safeParse(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default function ProvidersPage() {
  const [connections, setConnections] = React.useState<Connection[] | null>(null);
  const [error, setError] = React.useState(false);
  const [usingDevKey, setUsingDevKey] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [modelsFor, setModelsFor] = React.useState<string | null>(null);
  const [models, setModels] = React.useState<ModelInfo[] | null>(null);
  const [modelsError, setModelsError] = React.useState<string | null>(null);
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = React.useState<Connection | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Add form
  const [kind, setKind] = React.useState<"mock" | "real">("real");
  const [provider, setProvider] = React.useState<string>("openai");
  const [label, setLabel] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      const res = await get<{ connections?: Connection[] } | Connection[]>("/api/providers");
      setConnections(Array.isArray(res) ? res : res.connections ?? []);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
    get<{ usingDefaultEncryptionKey?: boolean; encryptionKeyIsDefault?: boolean }>("/api/me")
      .then((me) => {
        if (me.usingDefaultEncryptionKey ?? me.encryptionKeyIsDefault) setUsingDevKey(true);
      })
      .catch(() => {});
  }, [load]);

  async function addConnection(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body =
        kind === "mock"
          ? { provider: "mock", authType: "none", label: "Mock (offline)" }
          : {
              provider,
              authType: "api_key",
              label: label.trim() || provider,
              apiKey: apiKey || undefined,
              baseUrl: baseUrl.trim() || undefined,
            };
      await post("/api/providers", body);
      toast("Connection added", "success");
      setAddOpen(false);
      setLabel("");
      setApiKey("");
      setBaseUrl("");
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not add connection", "error");
    } finally {
      setBusy(false);
    }
  }

  async function test(c: Connection) {
    setTestingId(c.id);
    try {
      const res = await post<{ ok?: boolean; status?: string; error?: string }>(`/api/providers/${c.id}/test`);
      const ok = res.ok ?? res.status === "ok";
      toast(ok ? `“${c.label}” connection OK` : `Test failed: ${res.error ?? "unknown error"}`, ok ? "success" : "error");
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Test failed", "error");
      await load();
    } finally {
      setTestingId(null);
    }
  }

  async function disconnect() {
    if (!disconnectTarget) return;
    setBusy(true);
    try {
      await del(`/api/providers/${disconnectTarget.id}`);
      toast("Connection removed", "success");
      setDisconnectTarget(null);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Disconnect failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function showModels(c: Connection) {
    setModelsFor(c.id);
    setModels(null);
    setModelsError(null);
    try {
      const res = await get<{ models?: ModelInfo[] } | ModelInfo[]>(`/api/providers/${c.id}/models`);
      setModels(Array.isArray(res) ? res : res.models ?? []);
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : "Could not load models");
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-stone-100">Providers</h1>
        <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}>
          <Plus size={13} /> Add connection
        </Button>
      </div>

      {usingDevKey && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-400" role="alert">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            Set <code className="font-mono">SECRET_ENCRYPTION_KEY</code> in <code className="font-mono">.env</code> —
            keys are currently encrypted with the dev default.
          </span>
        </div>
      )}

      <div className="mt-5">
        {connections === null && !error && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        )}
        {error && (
          <EmptyState
            title="Could not load providers"
            action={
              <Button size="sm" onClick={() => void load()}>
                Retry
              </Button>
            }
          />
        )}
        {connections !== null && connections.length === 0 && !error && (
          <EmptyState
            icon={<Server size={26} />}
            title="No providers connected"
            hint="Connect a real provider or use the offline mock provider to explore."
            action={
              <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}>
                <Plus size={13} /> Add connection
              </Button>
            }
          />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {(connections ?? []).map((c) => (
            <div key={c.id} className="rounded-md border border-ink-700 bg-ink-900 p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-md border border-ink-600 bg-ink-800 font-mono text-sm font-semibold uppercase text-copper-300">
                    {c.provider.slice(0, 1)}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-stone-100">{c.label}</p>
                    <p className="font-mono text-xs text-stone-500">
                      {c.provider} · {maskedHint(c)}
                    </p>
                  </div>
                </div>
                <Badge tone={STATUS_TONE[c.status] ?? "stone"}>{c.status}</Badge>
              </div>
              <p className="mt-2 text-xs text-stone-500">
                {c.lastCheckedAt ? `Last checked ${timeAgo(c.lastCheckedAt)}` : "Never checked"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void test(c)} loading={testingId === c.id}>
                  <PlugZap size={12} /> Test
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void showModels(c)}>
                  Models
                </Button>
                <Button size="sm" variant="danger" onClick={() => setDisconnectTarget(c)}>
                  <Trash2 size={12} /> Disconnect
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add connection dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add connection">
        <form onSubmit={addConnection} className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={kind === "mock" ? "primary" : "secondary"}
              onClick={() => setKind("mock")}
            >
              Mock provider (no key needed)
            </Button>
            <Button
              type="button"
              size="sm"
              variant={kind === "real" ? "primary" : "secondary"}
              onClick={() => setKind("real")}
            >
              Real provider
            </Button>
          </div>
          {kind === "real" && (
            <>
              <div>
                <label htmlFor="pc-provider" className="mb-1 block text-sm text-stone-300">Provider</label>
                <Select id="pc-provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label htmlFor="pc-label" className="mb-1 block text-sm text-stone-300">Label</label>
                <Input id="pc-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={provider} />
              </div>
              <div>
                <label htmlFor="pc-key" className="mb-1 block text-sm text-stone-300">API key</label>
                <Input
                  id="pc-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={provider === "ollama" ? "Not required for Ollama" : "sk-…"}
                />
              </div>
              <div>
                <label htmlFor="pc-base" className="mb-1 block text-sm text-stone-300">
                  Base URL <span className="text-stone-500">(optional)</span>
                </label>
                <Input id="pc-base" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…" />
              </div>
            </>
          )}
          <Button type="submit" variant="primary" loading={busy} className="mt-1">
            Add connection
          </Button>
        </form>
      </Dialog>

      {/* Models dialog */}
      <Dialog open={modelsFor !== null} onClose={() => setModelsFor(null)} title="Models" wide>
        {models === null && !modelsError && <Skeleton className="h-40" />}
        {modelsError && (
          <p role="alert" className="rounded-md border border-ember-500/40 bg-ember-500/10 px-3 py-2 text-sm text-ember-400">
            {modelsError}
          </p>
        )}
        {models !== null && models.length === 0 && (
          <p className="py-6 text-center text-sm text-stone-500">No models reported by this provider.</p>
        )}
        {models !== null && models.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-xs text-stone-500">
                  <th className="py-2 pr-3 font-medium">Model</th>
                  <th className="py-2 pr-3 font-medium">Context</th>
                  <th className="py-2 pr-3 font-medium">Tools</th>
                  <th className="py-2 pr-3 font-medium">Input /1k</th>
                  <th className="py-2 font-medium">Output /1k</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={`${m.provider}/${m.model}`} className="border-b border-ink-800">
                    <td className="py-2 pr-3">
                      <span className="font-mono text-xs text-stone-200">{m.model}</span>
                      <span className="ml-2 text-xs text-stone-500">{m.label}</span>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-stone-300">{m.contextLimit.toLocaleString()}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={m.supportsTools ? "sage" : "stone"}>{m.supportsTools ? "yes" : "no"}</Badge>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-stone-300">{usd(m.inputPer1k)}</td>
                    <td className="py-2 font-mono text-xs text-stone-300">{usd(m.outputPer1k)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Dialog>

      {/* Disconnect confirm */}
      <Dialog open={disconnectTarget !== null} onClose={() => setDisconnectTarget(null)} title="Disconnect provider">
        <p className="text-sm text-stone-300">
          Remove “{disconnectTarget?.label}”? Stored credentials will be deleted. Existing usage history is kept.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setDisconnectTarget(null)}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" onClick={() => void disconnect()} loading={busy}>
            Disconnect
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
