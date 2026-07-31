import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Database,
  Dna,
  Github,
  History,
  MessagesSquare,
  ShieldCheck,
  Wrench,
} from "lucide-react";

const FEATURES = [
  {
    icon: MessagesSquare,
    title: "Chat Mode",
    desc: "Direct multi-model conversation with streaming, branching, and council mode across providers.",
  },
  {
    icon: Bot,
    title: "Agentic Swarms",
    desc: "Turn a goal into a plan, then watch a dynamic agent swarm write files, tools, and tests.",
  },
  {
    icon: Dna,
    title: "Agent Genome",
    desc: "Transparent performance learning over agent configurations — success rates you can inspect.",
  },
  {
    icon: History,
    title: "Swarm Time Machine",
    desc: "Event-sourced history: scrub any run, inspect state-at-time, fork and branch from anywhere.",
  },
  {
    icon: Wrench,
    title: "Tool Factory",
    desc: "Agents propose, test, and register their own tools — sandboxed, risk-classified, approved by you.",
  },
  {
    icon: ShieldCheck,
    title: "Human Control",
    desc: "Pause, resume, stop, approve, or fork any run. Budgets and autonomy levels you set.",
  },
];

const ARCH_STEPS = [
  { label: "UI", sub: "Next.js workspace" },
  { label: "API", sub: "REST + SSE" },
  { label: "Orchestrator", sub: "durable engine" },
  { label: "Providers · Sandbox · Event Store", sub: "any model, safe execution, full history" },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-ink-950">
      {/* Hero */}
      <section className="mx-auto flex max-w-5xl flex-col items-center px-6 pb-20 pt-28 text-center">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-md border border-copper-700 bg-copper-600/20 font-mono text-lg font-bold text-copper-300">
            S
          </span>
          <span className="text-2xl font-semibold tracking-tight text-stone-100">Swarmwright</span>
        </div>
        <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight text-stone-100">
          An open-source autonomous AI development workspace
        </h1>
        <p className="mt-4 max-w-xl text-base text-stone-400">
          Connect any model, coordinate agent swarms, ship software — with full human control,
          event-sourced history, and honest limits.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/app"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-copper-700 bg-copper-600 px-4 text-sm font-medium text-stone-100 transition-colors duration-150 ease-out hover:bg-copper-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
          >
            Open workspace <ArrowRight size={15} />
          </Link>
          <a
            href="https://github.com/swarmwright/swarmwright"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-ink-600 bg-ink-800 px-4 text-sm font-medium text-stone-200 transition-colors duration-150 ease-out hover:bg-ink-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
          >
            <Github size={15} /> Star on GitHub
          </a>
        </div>
        <p className="mt-4 text-xs text-stone-500">
          MIT licensed · works fully offline with the built-in mock provider
        </p>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-5xl px-6 pb-20">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-md border border-ink-700 bg-ink-900 p-5 transition-colors duration-150 ease-out hover:border-ink-600"
            >
              <f.icon size={20} className="text-copper-400" aria-hidden />
              <h2 className="mt-3 text-sm font-semibold text-stone-100">{f.title}</h2>
              <p className="mt-1.5 text-sm leading-6 text-stone-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Architecture strip */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <h2 className="mb-6 text-center text-sm font-semibold uppercase tracking-widest text-stone-500">
          Architecture
        </h2>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          {ARCH_STEPS.map((step, i) => (
            <div key={step.label} className="flex flex-1 items-center gap-2">
              <div className="flex-1 rounded-md border border-ink-700 bg-ink-900 px-4 py-3 text-center">
                <div className="flex items-center justify-center gap-1.5 text-sm font-medium text-stone-200">
                  {i === ARCH_STEPS.length - 1 && <Database size={13} className="text-copper-400" aria-hidden />}
                  {step.label}
                </div>
                <div className="mt-0.5 text-xs text-stone-500">{step.sub}</div>
              </div>
              {i < ARCH_STEPS.length - 1 && (
                <ArrowRight size={14} className="shrink-0 rotate-90 text-copper-600 sm:rotate-0" aria-hidden />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-ink-800">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs text-stone-500">
          <span>Swarmwright — MIT License</span>
          <div className="flex items-center gap-4">
            <Link href="/signin" className="transition-colors hover:text-stone-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500">
              Sign in
            </Link>
            <Link href="/onboarding" className="transition-colors hover:text-stone-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500">
              Get started
            </Link>
            <a
              href="https://github.com/swarmwright/swarmwright"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-stone-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
