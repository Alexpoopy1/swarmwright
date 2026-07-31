"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Bot,
  ChevronDown,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  PlayCircle,
  Plus,
  Search,
  Server,
  Settings,
  Sparkles,
  Wrench,
} from "lucide-react";
import { clsx } from "@/lib/format";
import { get, post } from "@/lib/api";
import { CommandPalette, Toaster, toast } from "@/components/ui";

const NAV = [
  { href: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/chat", label: "Chat", icon: MessageSquare },
  { href: "/app/runs", label: "Agent runs", icon: PlayCircle },
  { href: "/app/projects", label: "Projects", icon: FolderKanban },
  { href: "/app/genomes", label: "Genomes", icon: Bot },
  { href: "/app/tools", label: "Tools", icon: Wrench },
  { href: "/app/providers", label: "Providers", icon: Server },
  { href: "/app/usage", label: "Usage", icon: BarChart3 },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

interface Me {
  id: string;
  email: string;
  name: string;
  workspaceId?: string;
  workspaceName?: string;
}

function NewMenu() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  async function newChat() {
    setBusy(true);
    try {
      const c = await post<{ id: string }>("/api/chat/conversations", { title: "New conversation" });
      router.push(`/app/chat/${c.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not create chat", "error");
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  async function guidedDemo() {
    setBusy(true);
    try {
      const res = await post<{ runId: string }>("/api/demo");
      toast("Demo run started", "success");
      router.push(`/app/runs/${res.runId}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not start demo", "error");
      setBusy(false);
    }
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative px-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-copper-700 bg-copper-600/20 text-sm font-medium text-copper-300 transition-colors duration-150 hover:bg-copper-600/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500 disabled:opacity-50"
      >
        <Plus size={14} /> New <ChevronDown size={12} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-3 right-3 top-10 z-40 overflow-hidden rounded-md border border-ink-600 bg-ink-800 shadow-xl"
        >
          <button
            role="menuitem"
            onClick={() => void newChat()}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-stone-200 transition-colors hover:bg-ink-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-copper-500"
          >
            <MessageSquare size={14} className="text-stone-500" /> New chat
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              router.push("/app/projects/new");
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-stone-200 transition-colors hover:bg-ink-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-copper-500"
          >
            <FolderKanban size={14} className="text-stone-500" /> New project
          </button>
          <button
            role="menuitem"
            onClick={() => void guidedDemo()}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-stone-200 transition-colors hover:bg-ink-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-copper-500"
          >
            <Sparkles size={14} className="text-stone-500" /> Guided demo
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = React.useState<Me | null>(null);
  const [signingOut, setSigningOut] = React.useState(false);

  React.useEffect(() => {
    get<Me & { user?: Me; workspace?: { name?: string } }>("/api/me")
      .then((res) => {
        const user = res.user ?? res;
        setMe({
          id: user.id,
          email: user.email,
          name: user.name,
          workspaceName: res.workspace?.name ?? res.workspaceName,
        });
      })
      .catch(() => {
        // layout already guards auth; treat as transient
      });
  }, []);

  async function signOut() {
    setSigningOut(true);
    try {
      await post("/api/auth/signout");
    } catch {
      // even on error, clear client-side and move on
    }
    router.push("/signin");
    router.refresh();
  }

  return (
    <div className="flex h-screen bg-ink-950">
      {/* Sidebar */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-ink-800 bg-ink-900">
        <Link
          href="/app/dashboard"
          className="flex h-12 items-center gap-2 border-b border-ink-800 px-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-copper-500"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-md border border-copper-700 bg-copper-600/20 font-mono text-xs font-bold text-copper-300">
            S
          </span>
          <span className="text-sm font-semibold text-stone-100">Swarmwright</span>
        </Link>

        <div className="py-3">
          <NewMenu />
        </div>

        <nav aria-label="Workspace" className="flex-1 overflow-y-auto px-2">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150 ease-out",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500",
                  active ? "bg-ink-800 text-copper-300" : "text-stone-400 hover:bg-ink-850 hover:text-stone-200"
                )}
              >
                <item.icon size={15} aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-ink-800 p-3">
          <p className="truncate text-xs text-stone-400" title={me?.email}>
            {me?.email ?? "…"}
          </p>
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={signingOut}
            className="mt-1.5 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-stone-500 transition-colors hover:text-ember-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500 disabled:opacity-50"
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900 px-4">
          <span className="text-sm text-stone-400">
            {me?.workspaceName ?? "Personal"} <span className="text-stone-600">workspace</span>
          </span>
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
            }}
            aria-label="Open command palette"
            className="flex h-7 items-center gap-2 rounded-md border border-ink-600 bg-ink-800 px-2.5 text-xs text-stone-400 transition-colors hover:border-ink-500 hover:text-stone-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
          >
            <Search size={12} /> Command palette
            <kbd className="rounded border border-ink-600 bg-ink-900 px-1 font-mono text-[10px] text-stone-500">⌘K</kbd>
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      <CommandPalette />
      <Toaster />
    </div>
  );
}
