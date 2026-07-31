"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bot,
  FileCode2,
  FolderKanban,
  LayoutDashboard,
  MessageSquare,
  PlayCircle,
  Plus,
  Server,
  Settings,
  BarChart3,
  Wrench,
  Sparkles,
} from "lucide-react";
import { clsx } from "@/lib/format";
import { post } from "@/lib/api";
import { toast } from "./Toast";
import { Spinner } from "./Spinner";

interface Action {
  id: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  run: () => void | Promise<void>;
}

function fuzzyScore(query: string, text: string): number {
  // Simple subsequence match; lower is better, -1 = no match.
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  if (t.includes(q)) return t.indexOf(q);
  let ti = 0;
  let score = 0;
  for (const qc of q) {
    const found = t.indexOf(qc, ti);
    if (found === -1) return -1;
    score += found - ti;
    ti = found + 1;
  }
  return score + 50; // subsequence matches rank below substring matches
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const actions = React.useMemo<Action[]>(
    () => [
      { id: "nav-dashboard", label: "Go to Dashboard", icon: <LayoutDashboard size={14} />, run: () => router.push("/app/dashboard") },
      { id: "nav-chat", label: "Go to Chat", icon: <MessageSquare size={14} />, run: () => router.push("/app/chat") },
      { id: "nav-runs", label: "Go to Agent runs", icon: <PlayCircle size={14} />, run: () => router.push("/app/runs") },
      { id: "nav-genomes", label: "Go to Genomes", icon: <Bot size={14} />, run: () => router.push("/app/genomes") },
      { id: "nav-tools", label: "Go to Tools", icon: <Wrench size={14} />, run: () => router.push("/app/tools") },
      { id: "nav-providers", label: "Go to Providers", icon: <Server size={14} />, run: () => router.push("/app/providers") },
      { id: "nav-projects", label: "Go to Projects", icon: <FolderKanban size={14} />, run: () => router.push("/app/projects") },
      { id: "nav-usage", label: "Go to Usage", icon: <BarChart3 size={14} />, run: () => router.push("/app/usage") },
      { id: "nav-settings", label: "Go to Settings", icon: <Settings size={14} />, run: () => router.push("/app/settings") },
      {
        id: "new-chat",
        label: "New chat",
        hint: "Create a conversation",
        icon: <Plus size={14} />,
        run: async () => {
          const c = await post<{ id: string }>("/api/chat/conversations", { title: "New conversation" });
          router.push(`/app/chat/${c.id}`);
        },
      },
      {
        id: "new-project",
        label: "New project",
        icon: <FileCode2 size={14} />,
        run: () => router.push("/app/projects/new"),
      },
      {
        id: "new-run",
        label: "New run",
        icon: <PlayCircle size={14} />,
        run: () => router.push("/app/runs?new=1"),
      },
      {
        id: "guided-demo",
        label: "Guided demo",
        hint: "Run a demo swarm on the mock provider",
        icon: <Sparkles size={14} />,
        run: async () => {
          const res = await post<{ runId: string }>("/api/demo");
          toast("Demo run started", "success");
          router.push(`/app/runs/${res.runId}`);
        },
      },
    ],
    [router]
  );

  const filtered = React.useMemo(() => {
    return actions
      .map((a) => ({ a, score: fuzzyScore(query, `${a.label} ${a.hint ?? ""}`) }))
      .filter((x) => x.score >= 0)
      .sort((x, y) => x.score - y.score)
      .map((x) => x.a);
  }, [actions, query]);

  React.useEffect(() => setActiveIndex(0), [query]);

  async function execute(action: Action) {
    setOpen(false);
    try {
      setBusy(true);
      await action.run();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Action failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {busy && (
        <div className="fixed right-4 top-3 z-[60] text-copper-400">
          <Spinner size={16} />
        </div>
      )}
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            <div className="absolute inset-0 bg-black/60" aria-hidden onClick={() => setOpen(false)} />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Command palette"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="relative w-full max-w-lg overflow-hidden rounded-md border border-ink-700 bg-ink-900 shadow-2xl"
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIndex((i) => Math.max(i - 1, 0));
                }
                if (e.key === "Enter" && filtered[activeIndex]) {
                  e.preventDefault();
                  void execute(filtered[activeIndex]);
                }
              }}
            >
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a command or search…"
                aria-label="Command palette search"
                aria-activedescendant={filtered[activeIndex] ? `cmd-${filtered[activeIndex].id}` : undefined}
                aria-controls="cmd-listbox"
                aria-expanded="true"
                role="combobox"
                className="h-11 w-full border-b border-ink-700 bg-transparent px-4 text-sm text-stone-200 placeholder:text-stone-500 focus:outline-none"
              />
              <ul id="cmd-listbox" role="listbox" className="max-h-72 overflow-y-auto p-1.5">
                {filtered.length === 0 && (
                  <li className="px-3 py-6 text-center text-sm text-stone-500">No matching actions</li>
                )}
                {filtered.map((a, i) => (
                  <li
                    key={a.id}
                    id={`cmd-${a.id}`}
                    role="option"
                    aria-selected={i === activeIndex}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => void execute(a)}
                    className={clsx(
                      "flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm",
                      i === activeIndex ? "bg-ink-800 text-stone-100" : "text-stone-300"
                    )}
                  >
                    <span className="text-stone-500">{a.icon}</span>
                    <span className="flex-1">{a.label}</span>
                    {a.hint && <span className="text-xs text-stone-500">{a.hint}</span>}
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-3 border-t border-ink-700 px-4 py-2 text-xs text-stone-500">
                <span>↑↓ navigate</span>
                <span>↵ run</span>
                <span>esc close</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
