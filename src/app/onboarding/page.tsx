"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, PlugZap, Server, Sparkles } from "lucide-react";
import { get, post } from "@/lib/api";
import { usd } from "@/lib/format";
import { Button, Input, SegmentedControl, Select, Slider, Toaster, toast } from "@/components/ui";

const STEPS = ["Welcome", "Provider", "Test", "Automation", "Budget", "Project"] as const;

const PROVIDERS = ["openai", "openrouter", "groq", "deepseek", "ollama", "openai-compatible"] as const;

const AUTONOMY_OPTIONS = [
  { value: "observe", label: "Observe", hint: "Agents propose everything, you approve each step" },
  { value: "ask_all", label: "Ask all", hint: "Approve every consequential action before it runs" },
  { value: "ask_risky", label: "Ask risky", hint: "Auto-approve safe steps, ask before risky ones" },
  { value: "auto", label: "Auto", hint: "Full autonomy within your budget and limits" },
];

const AUTONOMY_DESC: Record<string, string> = {
  observe: "The swarm works only under close supervision — every action is queued for your approval.",
  ask_all: "Every consequential action (file writes, tool calls, recruitment) asks for your approval first.",
  ask_risky: "Low-risk steps proceed automatically. High-risk permissions and unusual actions require approval.",
  auto: "The swarm runs end-to-end without interruptions, always inside your budget and time limits.",
};

interface Connection {
  id: string;
  provider: string;
  label: string;
  status: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [busy, setBusy] = React.useState(false);

  // Provider state
  const [providerKind, setProviderKind] = React.useState<"mock" | "real" | null>(null);
  const [provider, setProvider] = React.useState<string>("openai");
  const [label, setLabel] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [connection, setConnection] = React.useState<Connection | null>(null);
  const [testResult, setTestResult] = React.useState<{ ok: boolean; error?: string } | null>(null);

  // Preferences
  const [autonomy, setAutonomy] = React.useState("ask_risky");
  const [budget, setBudget] = React.useState(10);

  // Project
  const [projectName, setProjectName] = React.useState("");
  const [projectId, setProjectId] = React.useState<string | null>(null);

  // If the user already has connections, prefill.
  React.useEffect(() => {
    get<{ connections?: Connection[] } | Connection[]>("/api/providers")
      .then((res) => {
        const list = Array.isArray(res) ? res : res.connections ?? [];
        if (list.length > 0) {
          setConnection(list[0]);
          setProviderKind(list[0].provider === "mock" ? "mock" : "real");
        }
      })
      .catch(() => {
        // not signed in yet or endpoint unavailable — onboarding still usable
      });
  }, []);

  function persistBudget() {
    try {
      window.localStorage.setItem("sw.defaultBudget", String(budget));
      const raw = window.localStorage.getItem("sw.defaults");
      const defaults = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      window.localStorage.setItem("sw.defaults", JSON.stringify({ ...defaults, autonomy, budgetUsd: budget }));
    } catch {
      // localStorage unavailable
    }
  }

  async function connectProvider() {
    setBusy(true);
    try {
      const body =
        providerKind === "mock"
          ? { provider: "mock", authType: "none", label: "Mock (offline)" }
          : {
              provider,
              authType: "api_key",
              label: label.trim() || provider,
              apiKey: apiKey || undefined,
              baseUrl: baseUrl.trim() || undefined,
            };
      const res = await post<{ connection?: Connection; id?: string } & Connection>("/api/providers", body);
      const conn: Connection = res.connection ?? { id: res.id ?? (res as Connection).id, provider: body.provider, label: body.label, status: "untested" };
      setConnection(conn);
      toast("Provider connected", "success");
      setStep(2);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not connect provider", "error");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    if (!connection) {
      setStep(3);
      return;
    }
    setBusy(true);
    setTestResult(null);
    try {
      const res = await post<{ ok: boolean; error?: string; status?: string }>(`/api/providers/${connection.id}/test`);
      setTestResult({ ok: res.ok ?? res.status === "ok", error: res.error });
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setBusy(false);
    }
  }

  async function createProject() {
    if (!projectName.trim()) {
      toast("Enter a project name", "error");
      return;
    }
    setBusy(true);
    try {
      const p = await post<{ id: string }>("/api/projects", { name: projectName.trim() });
      setProjectId(p.id);
      toast("Project created", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not create project", "error");
    } finally {
      setBusy(false);
    }
  }

  async function runDemo() {
    setBusy(true);
    try {
      const res = await post<{ runId: string }>("/api/demo");
      toast("Demo run started", "success");
      router.push(`/app/runs/${res.runId}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not start demo", "error");
      setBusy(false);
    }
  }

  function next() {
    if (step === 4) persistBudget();
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }
  function finish() {
    persistBudget();
    router.push("/app");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950 px-4 py-10">
      <Toaster />
      <div className="w-full max-w-xl">
        {/* Progress */}
        <ol className="mb-6 flex items-center gap-1" aria-label="Onboarding progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 flex-col gap-1.5">
              <div
                className={`h-1 rounded-full transition-colors duration-200 ${
                  i <= step ? "bg-copper-500" : "bg-ink-700"
                }`}
              />
              <span className={`text-xs ${i === step ? "text-copper-300" : "text-stone-500"}`}>
                {i + 1}. {s}
              </span>
            </li>
          ))}
        </ol>

        <div className="rounded-md border border-ink-700 bg-ink-900 p-6">
          {step === 0 && (
            <div className="text-center">
              <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md border border-copper-700 bg-copper-600/20 font-mono text-xl font-bold text-copper-300">
                S
              </span>
              <h1 className="text-xl font-semibold text-stone-100">Welcome to Swarmwright</h1>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-400">
                In a few short steps you will connect a model provider, choose how much autonomy the
                swarm gets, set a budget, and create your first project. Everything here can be
                changed later in Settings.
              </p>
            </div>
          )}

          {step === 1 && (
            <div>
              <h1 className="text-lg font-semibold text-stone-100">Connect a provider</h1>
              <p className="mt-1 text-sm text-stone-500">
                Swarmwright is provider-agnostic. Start offline or plug in a real API key.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setProviderKind("mock")}
                  className={`rounded-md border p-4 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500 ${
                    providerKind === "mock" ? "border-copper-600 bg-copper-600/10" : "border-ink-600 bg-ink-800 hover:border-ink-500"
                  }`}
                >
                  <Sparkles size={18} className="text-copper-400" aria-hidden />
                  <p className="mt-2 text-sm font-medium text-stone-100">Mock provider</p>
                  <p className="mt-1 text-xs leading-5 text-stone-400">No key needed — explore everything offline.</p>
                </button>
                <button
                  type="button"
                  onClick={() => setProviderKind("real")}
                  className={`rounded-md border p-4 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500 ${
                    providerKind === "real" ? "border-copper-600 bg-copper-600/10" : "border-ink-600 bg-ink-800 hover:border-ink-500"
                  }`}
                >
                  <Server size={18} className="text-copper-400" aria-hidden />
                  <p className="mt-2 text-sm font-medium text-stone-100">Connect a real provider</p>
                  <p className="mt-1 text-xs leading-5 text-stone-400">OpenAI, OpenRouter, Groq, DeepSeek, Ollama…</p>
                </button>
              </div>

              {providerKind === "real" && (
                <div className="mt-4 flex flex-col gap-3 rounded-md border border-ink-700 bg-ink-850 p-4">
                  <div>
                    <label htmlFor="ob-provider" className="mb-1 block text-sm text-stone-300">Provider</label>
                    <Select id="ob-provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
                      {PROVIDERS.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label htmlFor="ob-label" className="mb-1 block text-sm text-stone-300">Label</label>
                    <Input id="ob-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={provider} />
                  </div>
                  <div>
                    <label htmlFor="ob-key" className="mb-1 block text-sm text-stone-300">API key</label>
                    <Input
                      id="ob-key"
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={provider === "ollama" ? "Not required for Ollama" : "sk-…"}
                    />
                  </div>
                  <div>
                    <label htmlFor="ob-baseurl" className="mb-1 block text-sm text-stone-300">
                      Base URL <span className="text-stone-500">(optional override)</span>
                    </label>
                    <Input id="ob-baseurl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…" />
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div>
              <h1 className="text-lg font-semibold text-stone-100">Test the connection</h1>
              <p className="mt-1 text-sm text-stone-500">
                {connection
                  ? `We will ping “${connection.label}” to verify credentials and reachability.`
                  : "No connection was created — you can skip this step."}
              </p>
              <div className="mt-4">
                <Button onClick={testConnection} loading={busy} disabled={!connection}>
                  <PlugZap size={14} /> Test connection
                </Button>
                {testResult && (
                  <p
                    role="status"
                    className={`mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                      testResult.ok
                        ? "border-sage-500/40 bg-sage-500/10 text-sage-400"
                        : "border-ember-500/40 bg-ember-500/10 text-ember-400"
                    }`}
                  >
                    {testResult.ok ? (
                      <>
                        <Check size={14} /> Connection works.
                      </>
                    ) : (
                      <>Test failed: {testResult.error ?? "unknown error"}. You can continue and fix it later.</>
                    )}
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h1 className="text-lg font-semibold text-stone-100">How much autonomy?</h1>
              <p className="mt-1 text-sm text-stone-500">
                This decides when the swarm pauses to ask you before acting.
              </p>
              <div className="mt-4">
                <SegmentedControl options={AUTONOMY_OPTIONS} value={autonomy} onChange={setAutonomy} />
                <p className="mt-3 rounded-md border border-ink-700 bg-ink-850 px-3 py-2 text-sm leading-6 text-stone-300">
                  {AUTONOMY_DESC[autonomy]}
                </p>
              </div>
            </div>
          )}

          {step === 4 && (
            <div>
              <h1 className="text-lg font-semibold text-stone-100">Default run budget</h1>
              <p className="mt-1 text-sm text-stone-500">
                Runs pause automatically before exceeding this spend. Applies to new runs.
              </p>
              <div className="mt-5">
                <Slider
                  label="Budget per run"
                  value={budget}
                  min={1}
                  max={100}
                  step={1}
                  onChange={setBudget}
                  formatValue={(v) => usd(v)}
                />
              </div>
            </div>
          )}

          {step === 5 && (
            <div>
              <h1 className="text-lg font-semibold text-stone-100">Create your first project</h1>
              <p className="mt-1 text-sm text-stone-500">
                Projects hold the files your agents create. Or jump straight into a guided demo.
              </p>
              <div className="mt-4 flex gap-2">
                <Input
                  aria-label="Project name"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="My first project"
                  disabled={!!projectId}
                />
                <Button onClick={createProject} loading={busy} disabled={!!projectId}>
                  {projectId ? "Created" : "Create"}
                </Button>
              </div>
              {projectId && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-sage-400">
                  <Check size={14} /> Project ready.
                </p>
              )}
              <div className="mt-5 rounded-md border border-ink-700 bg-ink-850 p-4">
                <p className="text-sm font-medium text-stone-200">Prefer a tour?</p>
                <p className="mt-1 text-xs leading-5 text-stone-500">
                  The guided demo spins up a demo project and a full agent swarm on the mock provider —
                  no API key or budget needed.
                </p>
                <Button variant="secondary" size="sm" className="mt-3" onClick={runDemo} loading={busy}>
                  <Sparkles size={13} /> Run guided demo
                </Button>
              </div>
            </div>
          )}

          {/* Nav */}
          <div className="mt-6 flex items-center justify-between border-t border-ink-800 pt-4">
            <div>
              {step > 0 && (
                <Button variant="ghost" size="sm" onClick={back}>
                  <ChevronLeft size={14} /> Back
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={finish}>
                Skip to workspace
              </Button>
              {step === 1 && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void connectProvider()}
                  loading={busy}
                  disabled={!providerKind}
                >
                  Connect <ChevronRight size={14} />
                </Button>
              )}
              {step !== 1 && step < STEPS.length - 1 && (
                <Button variant="primary" size="sm" onClick={next}>
                  Next <ChevronRight size={14} />
                </Button>
              )}
              {step === STEPS.length - 1 && (
                <Button variant="primary" size="sm" onClick={finish}>
                  Go to workspace <ChevronRight size={14} />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
