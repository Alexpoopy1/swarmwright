/**
 * ChatWorkspace — the chat mode screen (SPEC §6.2).
 *
 * Conversation sidebar (search, archive, delete, new chat) + chat pane with
 * streaming markdown replies, per-message provider/model/token/cost chips,
 * hover actions (copy, regenerate, edit-and-resend via branch), stop
 * generation (AbortController), model picker flattened from all connected
 * providers, council mode (2–3 connections), token/context usage bar, and
 * .md export.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Download,
  MessageSquarePlus,
  Pencil,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Toggle,
  Tooltip,
  toast,
} from "@/components/ui";
import { del, get, patch, post, ApiError } from "@/lib/api";
import { clsx, timeAgo, tokens as fmtTokens, usd } from "@/lib/format";
import type { ModelInfo } from "@/types";
import type {
  ConversationDetailDto,
  ConversationDto,
  MessageDto,
  ProviderConnectionDto,
} from "@/components/swarm/shared";
import { streamChat, type StreamChatBody } from "@/lib/sse";

// ── Model selection helpers ──────────────────────────────────

interface ModelOption {
  /** "auto" or `${connectionId}|${model}` */
  value: string;
  label: string;
  connectionId?: string;
  model?: string;
  contextLimit?: number;
}

const AUTO_OPTION: ModelOption = { value: "auto", label: "Auto (router)" };

const AUTOSTREAM_KEY = "sw.chat.autostream";

function errMsg(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

// ── Component ────────────────────────────────────────────────

export function ChatWorkspace({ conversationId }: { conversationId?: string }) {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationDto[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const loadConversations = useCallback(async (query: string) => {
    try {
      const q = query.trim();
      const data = await get<ConversationDto[] | { conversations: ConversationDto[] }>(
        `/api/chat/conversations${q ? `?query=${encodeURIComponent(q)}` : ""}`
      );
      setConversations(Array.isArray(data) ? data : data.conversations ?? []);
      setListError(null);
    } catch (err) {
      setListError(errMsg(err, "Failed to load conversations"));
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadConversations(search), 300);
    return () => clearTimeout(t);
  }, [search, loadConversations]);

  const newChat = async () => {
    try {
      const convo = await post<ConversationDto>("/api/chat/conversations", {});
      void loadConversations(search);
      router.push(`/app/chat/${convo.id}`);
    } catch (err) {
      toast(errMsg(err, "Failed to create conversation"), "error");
    }
  };

  const setArchived = async (c: ConversationDto, archived: boolean) => {
    try {
      await patch(`/api/chat/conversations/${encodeURIComponent(c.id)}`, { archived });
      void loadConversations(search);
    } catch (err) {
      toast(errMsg(err, "Failed to update conversation"), "error");
    }
  };

  const deleteConversation = async (c: ConversationDto) => {
    if (!window.confirm(`Delete "${c.title}"? This cannot be undone.`)) return;
    try {
      await del(`/api/chat/conversations/${encodeURIComponent(c.id)}`);
      void loadConversations(search);
      if (conversationId === c.id) router.push("/app/chat");
    } catch (err) {
      toast(errMsg(err, "Failed to delete conversation"), "error");
    }
  };

  const visible = (conversations ?? []).filter((c) => showArchived || !c.archived);

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* Sidebar */}
      <aside
        aria-label="Conversations"
        className="flex w-64 shrink-0 flex-col rounded-md border border-ink-700 bg-ink-900"
      >
        <div className="flex items-center gap-2 border-b border-ink-700 p-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats…"
            aria-label="Search conversations"
          />
          <Tooltip content="New chat">
            <Button size="sm" onClick={() => void newChat()} aria-label="New chat">
              <MessageSquarePlus className="h-4 w-4" aria-hidden />
            </Button>
          </Tooltip>
        </div>
        <div className="border-b border-ink-700 px-2 py-1.5">
          <Toggle
            checked={showArchived}
            onChange={setShowArchived}
            label="Show archived"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {listError ? (
            <p className="p-2 text-xs text-ember-400" role="alert">{listError}</p>
          ) : conversations === null ? (
            <div className="space-y-1.5 p-1">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : visible.length === 0 ? (
            <p className="p-2 text-xs text-stone-500">
              {search ? "No conversations match." : "No conversations yet."}
            </p>
          ) : (
            <ul>
              {visible.map((c) => (
                <li key={c.id} className="group mb-0.5">
                  <div
                    className={clsx(
                      "flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors duration-150",
                      c.id === conversationId
                        ? "bg-ink-800 text-stone-100"
                        : "text-stone-300 hover:bg-ink-850"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => router.push(`/app/chat/${c.id}`)}
                      className="min-w-0 flex-1 truncate text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
                    >
                      <span className="block truncate">{c.title || "Untitled chat"}</span>
                      <span className="block text-[10px] text-stone-500">
                        {c.mode === "council" ? "council · " : ""}
                        {timeAgo(c.createdAt)}
                        {c.archived ? " · archived" : ""}
                      </span>
                    </button>
                    <span className="hidden shrink-0 items-center group-hover:flex">
                      <button
                        type="button"
                        onClick={() => void setArchived(c, !c.archived)}
                        aria-label={c.archived ? `Unarchive ${c.title}` : `Archive ${c.title}`}
                        className="rounded p-1 text-stone-500 hover:text-stone-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
                      >
                        {c.archived ? (
                          <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <Archive className="h-3.5 w-3.5" aria-hidden />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteConversation(c)}
                        aria-label={`Delete ${c.title}`}
                        className="rounded p-1 text-stone-500 hover:text-ember-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Chat pane */}
      {conversationId ? (
        <ChatPane key={conversationId} conversationId={conversationId} />
      ) : (
        <div className="flex min-w-0 flex-1 items-center justify-center rounded-md border border-ink-700 bg-ink-900">
          <EmptyState
            title="Start a conversation"
            hint="Pick a model or let the router choose — then send your first message."
            action={
              <Button onClick={() => void newChat()}>
                <MessageSquarePlus className="mr-1.5 h-4 w-4" aria-hidden />
                New chat
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}

// ── Chat pane ────────────────────────────────────────────────

function ChatPane({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<ConversationDetailDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connections, setConnections] = useState<ProviderConnectionDto[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([AUTO_OPTION]);
  const [modelSel, setModelSel] = useState("auto");
  const [council, setCouncil] = useState(false);
  const [councilIds, setCouncilIds] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadDetail = useCallback(async () => {
    try {
      const d = await get<ConversationDetailDto>(
        `/api/chat/conversations/${encodeURIComponent(conversationId)}`
      );
      setDetail(d);
      setLoadError(null);
    } catch (err) {
      setLoadError(errMsg(err, "Failed to load conversation"));
    }
  }, [conversationId]);

  // ── Start an assistant stream (shared by send/regenerate/handoff) ──
  const startStream = useCallback(
    (body: Omit<StreamChatBody, "conversationId">) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming("");
      streamChat(
        { conversationId, ...body },
        {
          signal: controller.signal,
          onDelta: (delta) => setStreaming((s) => (s ?? "") + delta),
          onDone: () => {
            setStreaming(null);
            abortRef.current = null;
            void loadDetail();
          },
          onError: (err) => {
            setStreaming(null);
            abortRef.current = null;
            toast(err.message, "error");
          },
        }
      );
    },
    [conversationId, loadDetail]
  );

  const stopStreaming = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming((s) => {
      if (s) toast("Generation stopped", "info");
      return null;
    });
  };

  // ── Initial load: conversation + providers/models ─────────
  useEffect(() => {
    void loadDetail();
    (async () => {
      try {
        const conns = await get<ProviderConnectionDto[] | { connections: ProviderConnectionDto[] }>(
          "/api/providers"
        );
        const list = Array.isArray(conns) ? conns : conns.connections ?? [];
        setConnections(list);
        const perConn = await Promise.all(
          list.map((c) =>
            get<ModelInfo[] | { models: ModelInfo[] }>(
              `/api/providers/${encodeURIComponent(c.id)}/models`
            )
              .then((ms) => ({ conn: c, models: Array.isArray(ms) ? ms : ms.models ?? [] }))
              .catch(() => ({ conn: c, models: [] as ModelInfo[] }))
          )
        );
        const options: ModelOption[] = [AUTO_OPTION];
        for (const { conn, models } of perConn) {
          for (const m of models) {
            options.push({
              value: `${conn.id}|${m.model}`,
              label: `${conn.label} · ${m.label || m.model}`,
              connectionId: conn.id,
              model: m.model,
              contextLimit: m.contextLimit,
            });
          }
        }
        setModelOptions(options);
      } catch {
        /* model picker falls back to Auto (router) */
      }
    })();
    return () => abortRef.current?.abort();
  }, [loadDetail]);

  // ── Edit-and-resend handoff: a branched conversation arrives
  //    with a pending stream request in sessionStorage. ──────
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(AUTOSTREAM_KEY);
      if (!raw) return;
      const handoff = JSON.parse(raw) as {
        conversationId: string;
        body: Omit<StreamChatBody, "conversationId">;
      };
      if (handoff.conversationId !== conversationId) return;
      window.sessionStorage.removeItem(AUTOSTREAM_KEY);
      startStream(handoff.body);
    } catch {
      /* malformed handoff — ignore */
    }
  }, [conversationId, startStream]);

  // ── Auto-scroll ───────────────────────────────────────────
  const messages = useMemo(() => detail?.messages ?? [], [detail]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streaming]);

  const selectedOption = modelOptions.find((o) => o.value === modelSel) ?? AUTO_OPTION;

  const streamPrefs = (): Omit<StreamChatBody, "conversationId" | "parentMessageId"> => {
    if (council && councilIds.length >= 2) {
      return { mode: "council", connectionIds: councilIds.slice(0, 3) };
    }
    return {
      mode: "chat",
      connectionId: selectedOption.connectionId,
      model: selectedOption.model,
    };
  };

  const send = async () => {
    const content = input.trim();
    if (!content || sending || streaming !== null) return;
    setSending(true);
    try {
      await post<MessageDto>(
        `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
        { content }
      );
      setInput("");
      await loadDetail();
      startStream(streamPrefs());
    } catch (err) {
      toast(errMsg(err, "Failed to send message"), "error");
    } finally {
      setSending(false);
    }
  };

  const regenerate = (msg: MessageDto) => {
    // Re-answer the user message this assistant reply belongs to.
    const parentUserId =
      msg.parentId ??
      [...messages].reverse().find((m) => m.role === "user" && m.createdAt <= msg.createdAt)?.id;
    startStream({ ...streamPrefs(), parentMessageId: parentUserId });
  };

  const submitEditResend = async (msg: MessageDto) => {
    const content = editText.trim();
    if (!content) return;
    try {
      // Branch the conversation so the original message stays intact.
      let newId: string;
      if (msg.parentId) {
        const res = await post<{ conversationId: string }>(
          `/api/chat/conversations/${encodeURIComponent(conversationId)}/branch`,
          { fromMessageId: msg.parentId }
        );
        newId = res.conversationId;
      } else {
        // First message in the conversation — branch from nothing = fresh copy.
        const res = await post<ConversationDto>("/api/chat/conversations", {
          title: detail?.title,
        });
        newId = res.id;
      }
      await post<MessageDto>(
        `/api/chat/conversations/${encodeURIComponent(newId)}/messages`,
        { content }
      );
      window.sessionStorage.setItem(
        AUTOSTREAM_KEY,
        JSON.stringify({ conversationId: newId, body: streamPrefs() })
      );
      setEditingId(null);
      router.push(`/app/chat/${newId}`);
    } catch (err) {
      toast(errMsg(err, "Failed to branch conversation"), "error");
    }
  };

  const copyMessage = async (msg: MessageDto) => {
    try {
      await navigator.clipboard.writeText(msg.content);
      toast("Copied", "success");
    } catch {
      toast("Copy failed", "error");
    }
  };

  const exportMarkdown = () => {
    if (!detail) return;
    const lines: string[] = [`# ${detail.title || "Conversation"}`, ""];
    for (const m of messages) {
      lines.push(`## ${m.role === "user" ? "You" : "Assistant"}`);
      if (m.provider || m.model) {
        lines.push(
          `_${[m.provider, m.model].filter(Boolean).join(" · ")}${
            m.tokensIn + m.tokensOut > 0 ? ` · ${fmtTokens(m.tokensIn + m.tokensOut)} tokens` : ""
          }${m.costUsd > 0 ? ` · ${usd(m.costUsd)}` : ""}_`,
          ""
        );
      }
      lines.push(m.content, "");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(detail.title || "conversation").replace(/[^a-z0-9-_]+/gi, "-").slice(0, 48)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const usedTokens = messages.reduce((acc, m) => acc + m.tokensIn + m.tokensOut, 0);
  const contextLimit = selectedOption.contextLimit;
  const contextPct = contextLimit ? Math.min(100, (usedTokens / contextLimit) * 100) : null;

  if (loadError) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center rounded-md border border-ink-700 bg-ink-900">
        <p className="text-sm text-ember-400" role="alert">{loadError}</p>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="min-w-0 flex-1 space-y-2 rounded-md border border-ink-700 bg-ink-900 p-3">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-20 w-3/4" />
        <Skeleton className="h-12 w-1/2" />
      </div>
    );
  }

  return (
    <section
      aria-label={`Conversation ${detail.title}`}
      className="flex min-w-0 flex-1 flex-col rounded-md border border-ink-700 bg-ink-900"
    >
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-ink-700 px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-stone-100">
          {detail.title || "Untitled chat"}
        </h2>
        {detail.mode === "council" && <Badge tone="copper">council</Badge>}
        <Tooltip content="Export conversation as Markdown">
          <Button size="sm" variant="ghost" onClick={exportMarkdown} aria-label="Export chat as markdown">
            <Download className="h-4 w-4" aria-hidden />
          </Button>
        </Tooltip>
      </header>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-live="off">
        {messages.length === 0 && streaming === null && (
          <EmptyState
            title="Start a conversation"
            hint="Pick a model or let the router choose."
          />
        )}
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              streaming={streaming !== null}
              editing={editingId === m.id}
              editText={editText}
              onEditStart={() => {
                setEditingId(m.id);
                setEditText(m.content);
              }}
              onEditCancel={() => setEditingId(null)}
              onEditChange={setEditText}
              onEditSubmit={() => void submitEditResend(m)}
              onCopy={() => void copyMessage(m)}
              onRegenerate={m.role === "assistant" ? () => regenerate(m) : undefined}
            />
          ))}
          {streaming !== null && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-md border border-ink-700 bg-ink-850 px-3 py-2">
                {streaming ? (
                  <div className="prose-sw text-sm text-stone-200">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                      {streaming}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm text-stone-500">Thinking…</p>
                )}
                <span
                  className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-copper-500 align-text-bottom"
                  aria-hidden
                />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Context usage bar */}
      <div className="flex items-center gap-2 border-t border-ink-700 px-3 py-1.5">
        <span className="text-[10px] uppercase tracking-wide text-stone-500">context</span>
        <span
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-800"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={contextLimit ?? 0}
          aria-valuenow={usedTokens}
          aria-label={`${fmtTokens(usedTokens)} tokens used${
            contextLimit ? ` of ${fmtTokens(contextLimit)}` : ""
          }`}
        >
          <span
            className={clsx(
              "block h-full rounded-full",
              contextPct !== null && contextPct > 85 ? "bg-ember-500" : "bg-copper-500"
            )}
            style={{ width: `${contextPct ?? (usedTokens > 0 ? 4 : 0)}%` }}
          />
        </span>
        <span className="font-mono text-[10px] text-stone-500">
          {fmtTokens(usedTokens)}
          {contextLimit ? ` / ${fmtTokens(contextLimit)}` : " tokens"}
        </span>
      </div>

      {/* Composer */}
      <div className="border-t border-ink-700 p-3">
        <div className="mx-auto max-w-3xl">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Select
              value={modelSel}
              onChange={(e) => setModelSel(e.target.value)}
              aria-label="Model"
              disabled={council}
            >
              {modelOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Toggle checked={council} onChange={setCouncil} label="Council" />
            {council && (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Council connections (pick 2–3)">
                {connections.map((c) => {
                  const on = councilIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className={clsx(
                        "flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs",
                        on ? "border-copper-600 text-copper-300" : "border-ink-700 text-stone-400"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          setCouncilIds((prev) =>
                            e.target.checked
                              ? [...prev, c.id].slice(-3)
                              : prev.filter((id) => id !== c.id)
                          )
                        }
                        className="accent-copper-500"
                      />
                      {c.label}
                    </label>
                  );
                })}
                {connections.length < 2 && (
                  <span className="text-xs text-stone-500">connect 2+ providers for council mode</span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={3}
              placeholder={
                council
                  ? "Ask the council — 2–3 models answer, the best is synthesized…"
                  : "Message — Enter to send, Shift+Enter for a new line"
              }
              aria-label="Message"
              className="min-h-[4.5rem] flex-1 resize-y rounded-md border border-ink-700 bg-ink-950 p-2 text-sm text-stone-200 placeholder:text-stone-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
            />
            {streaming !== null ? (
              <Button variant="danger" onClick={stopStreaming} aria-label="Stop generation">
                <Square className="mr-1 h-4 w-4" aria-hidden />
                Stop
              </Button>
            ) : (
              <Button onClick={() => void send()} loading={sending} disabled={!input.trim()}>
                Send
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Message bubble ───────────────────────────────────────────

function MessageBubble({
  message: m,
  streaming,
  editing,
  editText,
  onEditStart,
  onEditCancel,
  onEditChange,
  onEditSubmit,
  onCopy,
  onRegenerate,
}: {
  message: MessageDto;
  streaming: boolean;
  editing: boolean;
  editText: string;
  onEditStart: () => void;
  onEditCancel: () => void;
  onEditChange: (v: string) => void;
  onEditSubmit: () => void;
  onCopy: () => void;
  onRegenerate?: () => void;
}) {
  const isUser = m.role === "user";
  const chipParts = [
    m.provider,
    m.model,
    m.tokensIn + m.tokensOut > 0 ? `${fmtTokens(m.tokensIn + m.tokensOut)} tok` : null,
    m.costUsd > 0 ? usd(m.costUsd) : null,
  ].filter(Boolean);

  return (
    <div className={clsx("group flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={clsx(
          "max-w-[85%] rounded-md border px-3 py-2",
          isUser
            ? "border-copper-700/60 bg-copper-700/15 text-stone-100"
            : "border-ink-700 bg-ink-850 text-stone-200"
        )}
      >
        {editing ? (
          <div className="min-w-72">
            <textarea
              value={editText}
              onChange={(e) => onEditChange(e.target.value)}
              rows={4}
              aria-label="Edit message"
              className="w-full resize-y rounded-md border border-ink-700 bg-ink-950 p-2 text-sm text-stone-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
            />
            <div className="mt-1.5 flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" onClick={onEditCancel}>
                Cancel
              </Button>
              <Button size="sm" onClick={onEditSubmit} disabled={!editText.trim()}>
                Branch &amp; resend
              </Button>
            </div>
          </div>
        ) : isUser ? (
          <p className="whitespace-pre-wrap text-sm">{m.content}</p>
        ) : (
          <div className="prose-sw text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {m.content}
            </ReactMarkdown>
          </div>
        )}

        <div
          className={clsx(
            "mt-1 flex items-center gap-1.5",
            isUser ? "justify-end" : "justify-start"
          )}
        >
          {chipParts.length > 0 && (
            <span className="rounded-md border border-ink-700 bg-ink-900 px-1.5 py-0.5 font-mono text-[10px] text-stone-500">
              {chipParts.join(" · ")}
            </span>
          )}
          <span className="hidden items-center gap-0.5 group-hover:flex">
            <Tooltip content="Copy message">
              <button
                type="button"
                onClick={onCopy}
                aria-label="Copy message"
                className="rounded p-1 text-stone-500 hover:text-stone-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden />
              </button>
            </Tooltip>
            {isUser && !streaming && (
              <Tooltip content="Edit and resend (creates a branch)">
                <button
                  type="button"
                  onClick={onEditStart}
                  aria-label="Edit and resend"
                  className="rounded p-1 text-stone-500 hover:text-stone-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </button>
              </Tooltip>
            )}
            {onRegenerate && !streaming && (
              <Tooltip content="Regenerate reply">
                <button
                  type="button"
                  onClick={onRegenerate}
                  aria-label="Regenerate reply"
                  className="rounded p-1 text-stone-500 hover:text-stone-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                </button>
              </Tooltip>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
