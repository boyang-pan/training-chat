"use client";

import { useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";
import { MessageUser } from "@/components/chat/message-user";
import { MessageAgent } from "@/components/chat/message-agent";
import { InputBar } from "@/components/chat/input-bar";
import { EmptyState } from "@/components/chat/empty-state";
import type { AgentMessage, Conversation, Message } from "@/types";
import { useSidebar } from "@/components/layout/resizable-layout";
import { PanelLeftOpen, Pencil, ChevronDown, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

interface LocalMessage {
  id: string;
  role: "user" | "assistant";
  content: string | AgentMessage;
  createdAt?: string;
}

interface ChatViewProps {
  conversationId: string | null;
}

let msgCounter = 0;
function newId() {
  return `msg-${++msgCounter}-${Date.now()}`;
}

/**
 * Parse stream lines into AgentMessage updates.
 * Protocol:
 *   p:{steps}       — plan (ignored; no longer shown as pending states)
 *   0:"text chunk"  — text delta
 *   9:{...}         — tool call
 *   a:{...}         — tool result
 *   b:{...}         — tool call (alternate prefix)
 *   e:{message}     — error
 *   d:{...}         — finish event
 */
function parseStreamLine(
  line: string,
  current: AgentMessage
): { updated: AgentMessage; done: boolean } {
  const updated: AgentMessage = {
    ...current,
    states: [...current.states],
  };

  if (line.startsWith("p:")) {
    try {
      const payload = JSON.parse(line.slice(2)) as { steps: string[] };
      if (Array.isArray(payload.steps)) {
        updated.plan = { steps: payload.steps };
      }
    } catch {}
    return { updated, done: false };
  }

  if (line.startsWith("0:")) {
    try {
      const chunk = JSON.parse(line.slice(2)) as string;
      updated.final_answer = (updated.final_answer ?? "") + chunk;
    } catch {
      // ignore parse errors
    }
    return { updated, done: false };
  }

  if (line.startsWith("r:")) {
    try {
      const chunk = JSON.parse(line.slice(2)) as string;
      updated.reasoning = (updated.reasoning ?? "") + chunk;
    } catch {}
    return { updated, done: false };
  }

  if (line.startsWith("9:") || line.startsWith("b:")) {
    // Tool call — remove "Planning" placeholder on first real tool, then append
    try {
      const payload = JSON.parse(line.slice(2));
      const toolName: string = payload.toolName ?? payload.tool ?? "tool";
      const input = payload.args ?? payload.input ?? {};
      updated.states = updated.states.filter((s) => s.id !== "planning");
      updated.states.push({
        id: `state-${updated.states.length}`,
        label: labelForTool(toolName, input),
        status: "active",
        toolCall: { tool: toolName, input, output: undefined },
      });
    } catch {
      // ignore
    }
    return { updated, done: false };
  }

  if (line.startsWith("a:")) {
    // Tool result — mark the last active state as done
    try {
      const payload = JSON.parse(line.slice(2));
      const output = payload.result ?? payload.output;
      const lastActiveIdx = [...updated.states]
        .reverse()
        .findIndex((s) => s.status === "active");
      if (lastActiveIdx >= 0) {
        const idx = updated.states.length - 1 - lastActiveIdx;
        updated.states[idx] = {
          ...updated.states[idx],
          status: "done",
          toolCall: updated.states[idx].toolCall
            ? { ...updated.states[idx].toolCall!, output }
            : undefined,
        };
        if (
          updated.states[idx].toolCall?.tool === "render_chart" &&
          output &&
          typeof output === "object"
        ) {
          updated.chart = output as AgentMessage["chart"];
        }
      }
    } catch {
      // ignore
    }
    return { updated, done: false };
  }

  if (line.startsWith("e:")) {
    try {
      const payload = JSON.parse(line.slice(2)) as { message: string };
      updated.final_answer = payload.message;
      updated.error = true;
    } catch {}
    return { updated, done: true };
  }

  if (line.startsWith("f:")) {
    try {
      const payload = JSON.parse(line.slice(2)) as { followups: string[] };
      if (Array.isArray(payload.followups)) updated.followups = payload.followups;
    } catch {}
    return { updated, done: false };
  }

  if (line.startsWith("d:")) {
    return { updated, done: true };
  }

  return { updated, done: false };
}

function labelForTool(toolName: string, input: Record<string, unknown>): string {
  const labels: Record<string, string> = {
    get_schema: "Reading the database schema",
    run_query: "Running a query",
    get_activity_detail: "Getting activity detail",
    get_personal_records: "Fetching personal records",
    get_notes: "Checking your notes",
    add_note: "Saving a note",
    render_chart: "Preparing chart",
    ask_user: "Asking a clarifying question",
  };

  if (toolName === "run_query" && input?.sql) {
    const sql = String(input.sql).trim().toLowerCase();
    // Check primary intent first — these win even if other columns are present
    if (sql.includes("segment")) return "Querying segment data";
    if (sql.includes("heartrate") || sql.includes("heart_rate")) return "Querying heart rate data";
    if (sql.includes("pace") || sql.includes("speed_mps")) return "Querying pace data";
    if (sql.includes("calories") || sql.includes("kilojoules")) return "Querying energy data";
    // Volume/distance is a common secondary column — only label it if it's clearly primary
    if (sql.includes("sum(distance") || sql.includes("sum(moving_time") || sql.includes("count(*)")) return "Querying training volume";
    // Elevation and time-based groupings are lower priority
    if (sql.includes("elevation")) return "Querying elevation data";
    if (sql.includes("week")) return "Querying weekly data";
    if (sql.includes("month")) return "Querying monthly data";
    if (sql.includes("year")) return "Querying yearly data";
  }

  if (toolName === "render_chart" && input?.title) {
    return `Preparing chart: ${String(input.title)}`;
  }

  if (toolName === "ask_user" && input?.question) {
    const q = String(input.question);
    return `Asking: ${q.length > 60 ? q.slice(0, 57) + "…" : q}`;
  }

  return labels[toolName] ?? toolName;
}

export function ChatView({ conversationId }: ChatViewProps) {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);
  const [hasTitleBeenSet, setHasTitleBeenSet] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [showScrollButton, setShowScrollButton] = useState(false);
  const shouldAutoScrollRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastQuestionRef = useRef<string>("");
  const abortControllerRef = useRef<AbortController | null>(null);
  // Which conversationId the user is currently viewing
  const activeConvIdRef = useRef<string | null>(null);
  // Per-conversation message cache so background streams survive navigation
  const streamCacheRef = useRef<Map<string, LocalMessage[]>>(new Map());
  // Persistent cache for fully-loaded conversations — enables instant switching
  const loadedConversationCache = useRef<Map<string, LocalMessage[]>>(new Map());
  // Most recent conversations list broadcast by the sidebar
  const conversationsRef = useRef<Conversation[]>([]);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const inputBarRef = useRef<HTMLTextAreaElement>(null);
  // Tracks a conversation ID we just created ourselves so the reset
  // effect below doesn't wipe messages when the URL updates to the new ID
  const selfCreatedIdRef = useRef<string | null>(null);

  // Keep conversationsRef up-to-date from the sidebar broadcast — no title fetch needed
  useEffect(() => {
    function onConversationsUpdated(e: Event) {
      const convs = (e as CustomEvent<Conversation[]>).detail;
      conversationsRef.current = convs;
      const activeId = activeConvIdRef.current;
      if (activeId) {
        const match = convs.find((c) => c.id === activeId);
        if (match?.title) setConversationTitle(match.title);
      }
    }
    window.addEventListener("conversations:updated", onConversationsUpdated);
    return () => window.removeEventListener("conversations:updated", onConversationsUpdated);
  }, []);

  // Load existing messages + title when conversationId changes
  useEffect(() => {
    activeConvIdRef.current = conversationId;
    shouldAutoScrollRef.current = true;
    setShowScrollButton(false);

    // Skip reset when we navigated here by creating the conversation ourselves
    if (conversationId && conversationId === selfCreatedIdRef.current) {
      selfCreatedIdRef.current = null;
      return;
    }

    // If a stream is still running for this conversation, restore its live state
    // instead of wiping messages and fetching from DB (which won't have it yet).
    if (conversationId) {
      const liveCache = streamCacheRef.current.get(conversationId);
      if (liveCache) {
        setMessages(liveCache);
        setConversationTitle(null);
        setIsLoading(true);
        const match = conversationsRef.current.find((c) => c.id === conversationId);
        if (match?.title) setConversationTitle(match.title);
        return;
      }
    }

    setIsLoading(false);
    setMessages([]);
    setConversationTitle(null);
    setHasTitleBeenSet(false);

    if (!conversationId) return;

    // Resolve title instantly from sidebar's already-fetched list
    const titleMatch = conversationsRef.current.find((c) => c.id === conversationId);
    if (titleMatch?.title) setConversationTitle(titleMatch.title);

    // Serve from message cache for instant switching — no network round-trip
    const cachedMessages = loadedConversationCache.current.get(conversationId);
    if (cachedMessages) {
      setMessages(cachedMessages);
      if (cachedMessages.length > 0) setHasTitleBeenSet(true);
      return;
    }

    // Cache miss: fetch from DB
    setIsLoadingHistory(true);
    fetch(`/api/conversations/${conversationId}`)
      .then((r) => r.json())
      .then((data: Message[]) => {
        if (activeConvIdRef.current !== conversationId) return;
        if (!Array.isArray(data)) return;
        const loaded: LocalMessage[] = data.map((m) => ({
          id: m.id,
          role: m.role,
          content:
            m.role === "user"
              ? typeof m.content === "string"
                ? m.content
                : JSON.stringify(m.content)
              : (m.content as AgentMessage),
          createdAt: m.created_at,
        }));
        setMessages(loaded);
        loadedConversationCache.current.set(conversationId, loaded);
        if (loaded.length > 0) setHasTitleBeenSet(true);
      })
      .catch(() => {})
      .finally(() => setIsLoadingHistory(false));
  }, [conversationId]);

  // Press "/" anywhere to focus the chat input
  useEffect(() => {
    function handleSlash(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "/") {
        e.preventDefault();
        inputBarRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleSlash);
    return () => document.removeEventListener("keydown", handleSlash);
  }, []);

  // Auto-select input text when title editing starts
  useLayoutEffect(() => {
    if (isEditingTitle) titleInputRef.current?.select();
  }, [isEditingTitle]);

  function startEditingTitle() {
    if (!conversationId) return;
    setTitleDraft(conversationTitle ?? "");
    setIsEditingTitle(true);
  }

  function commitTitleRename() {
    const trimmed = titleDraft.trim();
    setIsEditingTitle(false);
    if (!trimmed || trimmed === conversationTitle || !conversationId) return;
    setConversationTitle(trimmed);
    setHasTitleBeenSet(true);
    window.dispatchEvent(new CustomEvent("conversation:renamed", { detail: { id: conversationId, title: trimmed } }));
    fetch(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    }).catch(() => {});
  }

  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitTitleRename();
    if (e.key === "Escape") setIsEditingTitle(false);
  }

  // Sync title when renamed from the sidebar
  useEffect(() => {
    function onRenamed(e: Event) {
      const { id, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
      if (id === conversationId) setConversationTitle(title);
    }
    window.addEventListener("conversation:renamed", onRenamed);
    return () => window.removeEventListener("conversation:renamed", onRenamed);
  }, [conversationId]);

  // Track whether the user is near the bottom.
  // shouldAutoScrollRef is a ref (not state) so the auto-scroll effect always
  // reads the latest value synchronously — avoiding a race where rapid
  // setMessages calls during streaming cause the effect to see a stale
  // isAtBottom=true and scroll back down before setIsAtBottom(false) commits.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      shouldAutoScrollRef.current = nearBottom;
      setShowScrollButton(!nearBottom);
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll only when pinned to bottom
  useEffect(() => {
    if (shouldAutoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = useCallback(
    async (question: string) => {
      if (isLoading) return;

      const userMsgId = newId();
      const agentMsgId = newId();

      lastQuestionRef.current = question;
      shouldAutoScrollRef.current = true;
      setShowScrollButton(false);
      setMessages((prev) => [
        ...prev,
        { id: userMsgId, role: "user", content: question },
      ]);
      setIsLoading(true);

      const history = messages.slice(-10).map((m) => ({
        role: m.role,
        content:
          typeof m.content === "string"
            ? m.content
            : (m.content as AgentMessage).final_answer || "I encountered an error processing this request.",
      }));

      // "Planning" spinner shown immediately while Phase 1 runs
      const initialAgentMsg: AgentMessage = {
        states: [{ id: "planning", label: "Planning", status: "active" }],
        final_answer: "",
      };
      setMessages((prev) => [
        ...prev,
        { id: agentMsgId, role: "assistant", content: initialAgentMsg },
      ]);

      const streamStartTime = Date.now();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Create a conversation if this is the first message
      let convId = conversationId;
      if (!convId) {
        try {
          const convRes = await fetch("/api/conversations", { method: "POST" });
          const conv = await convRes.json() as { id: string };
          convId = conv.id;
          selfCreatedIdRef.current = convId;
          router.replace(`/chat/${convId}`);
        } catch {
          // Non-fatal — messages just won't persist
        }
      }

      let currentAgentMsg: AgentMessage = { ...initialAgentMsg };

      // Seed the per-conversation cache so navigation away doesn't lose this stream
      if (convId) {
        streamCacheRef.current.set(convId, [
          ...messages,
          { id: userMsgId, role: "user", content: question },
          { id: agentMsgId, role: "assistant", content: initialAgentMsg },
        ]);
      }

      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, history, conversation_id: convId, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) throw new Error("Stream failed");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            const { updated, done: streamDone } = parseStreamLine(line, currentAgentMsg);
            currentAgentMsg = updated;
            // Always keep the cache current so returning to this conversation
            // shows the live stream state.
            if (convId) {
              streamCacheRef.current.set(
                convId,
                (streamCacheRef.current.get(convId) ?? []).map((m) =>
                  m.id === agentMsgId ? { ...m, content: { ...currentAgentMsg } } : m
                )
              );
            }
            // Only update React state when the user is currently viewing this conversation.
            if (convId === activeConvIdRef.current) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === agentMsgId ? { ...m, content: { ...currentAgentMsg } } : m
                )
              );
            }
            if (streamDone) break;
          }
        }

        // Record elapsed time
        const duration_ms = Date.now() - streamStartTime;

        // Mark all remaining active states as done
        currentAgentMsg = {
          ...currentAgentMsg,
          duration_ms,
          states: currentAgentMsg.states.map((s) =>
            s.status === "active" ? { ...s, status: "done" } : s
          ),
        };

        // Guard: ensure final_answer is never empty before persisting.
        // An empty string would cause Anthropic API errors in subsequent turns
        // when this message is included in history.
        if (!currentAgentMsg.final_answer) {
          currentAgentMsg = {
            ...currentAgentMsg,
            final_answer: "Something went wrong. Please try again.",
            error: true,
          };
        }

        if (convId === activeConvIdRef.current) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === agentMsgId ? { ...m, content: currentAgentMsg } : m
            )
          );
        }

        // Fire-and-forget message persistence
        if (convId) {
          fetch(`/api/conversations/${convId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [
                { role: "user", content: question },
                { role: "assistant", content: currentAgentMsg },
              ],
            }),
          }).catch(() => {});
        }

        // Fire-and-forget title generation (only when user is viewing this conversation)
        if (convId && !hasTitleBeenSet && convId === activeConvIdRef.current) {
          setHasTitleBeenSet(true);
          fetch("/api/title", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conversation_id: convId,
              question,
              answer: currentAgentMsg.final_answer,
            }),
          })
            .then((r) => r.json())
            .then((data) => {
              if (data?.title) {
                setConversationTitle(data.title);
                window.dispatchEvent(
                  new CustomEvent("conversation:renamed", { detail: { id: convId, title: data.title } })
                );
              }
            })
            .catch(() => {});
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          currentAgentMsg = {
            ...currentAgentMsg,
            states: currentAgentMsg.states.map((s) =>
              s.status === "active" ? { ...s, status: "done" } : s
            ),
            final_answer: currentAgentMsg.final_answer || "*(stopped)*",
          };
          setMessages((prev) =>
            prev.map((m) =>
              m.id === agentMsgId ? { ...m, content: currentAgentMsg } : m
            )
          );
        } else {
          console.error("Agent stream error:", err);
          currentAgentMsg = {
            states: [],
            final_answer: "Something went wrong. Please try again.",
          } as AgentMessage;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === agentMsgId ? { ...m, content: currentAgentMsg } : m
            )
          );
        }
      } finally {
        if (convId) {
          // Migrate the completed stream into the persistent message cache
          const streamMessages = streamCacheRef.current.get(convId);
          if (streamMessages) {
            const finalMessages = streamMessages.map((m) =>
              m.id === agentMsgId ? { ...m, content: currentAgentMsg } : m
            );
            loadedConversationCache.current.set(convId, finalMessages);
          }
          streamCacheRef.current.delete(convId);
        }
        if (convId === activeConvIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    [isLoading, messages, conversationId, hasTitleBeenSet]
  );

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const lastAgentMsgId =
    messages.filter((m) => m.role === "assistant").at(-1)?.id ?? null;
  const sidebar = useSidebar();
  const router = useRouter();

  async function handleDeleteConversation() {
    if (!conversationId) return;
    loadedConversationCache.current.delete(conversationId);
    await fetch(`/api/conversations/${conversationId}`, { method: "DELETE" }).catch(() => {});
    router.push("/chat");
  }

  return (
    <div className="relative flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-zinc-100 dark:border-zinc-800 px-4 py-3 shrink-0 flex items-center gap-2">
        {sidebar?.isCollapsed && (
          <button
            onClick={sidebar.toggle}
            title="Show sidebar"
            className="p-1 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        )}
        {conversationId ? (
          isEditingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitleRename}
              onKeyDown={handleTitleKeyDown}
              autoFocus
              className="text-sm font-medium text-zinc-900 dark:text-zinc-100 bg-transparent outline-none border-b border-zinc-300 dark:border-zinc-600 min-w-0 max-w-xs"
            />
          ) : (
            <DropdownMenu>
              <div className="flex items-center border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                <span className="pl-3 pr-2 py-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap max-w-xs truncate">
                  {conversationTitle ?? "New conversation"}
                </span>
                <DropdownMenuTrigger asChild>
                  <button className="border-l border-zinc-200 dark:border-zinc-700 px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors focus:outline-none">
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
                  </button>
                </DropdownMenuTrigger>
              </div>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={startEditingTitle}>
                  <Pencil className="w-3.5 h-3.5" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleDeleteConversation} destructive>
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        ) : (
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">New conversation</p>
        )}
      </div>

      {/* Scroll-to-bottom button */}
      {showScrollButton && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10">
          <button
            onClick={() => {
              if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
              shouldAutoScrollRef.current = true;
              setShowScrollButton(false);
            }}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        {isLoadingHistory ? (
          <div className="max-w-3xl mx-auto px-6 py-6 w-full animate-pulse space-y-6">
            {/* user bubble */}
            <div className="flex justify-end">
              <div className="h-9 w-48 rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
            </div>
            {/* agent block */}
            <div className="space-y-2">
              <div className="h-3.5 w-3/4 rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-3.5 w-full rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-3.5 w-1/2 rounded bg-zinc-100 dark:bg-zinc-800" />
            </div>
            {/* user bubble */}
            <div className="flex justify-end">
              <div className="h-9 w-32 rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
            </div>
            {/* agent block */}
            <div className="space-y-2">
              <div className="h-3.5 w-full rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-3.5 w-2/3 rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-3.5 w-5/6 rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-3.5 w-1/3 rounded bg-zinc-100 dark:bg-zinc-800" />
            </div>
          </div>
        ) : messages.length === 0 ? (
          <EmptyState onPrompt={handleSubmit} />
        ) : (
          <div className="max-w-3xl mx-auto px-6 py-6">
            {messages.map((msg) => {
              if (msg.role === "user") {
                return (
                  <MessageUser
                    key={msg.id}
                    content={msg.content as string}
                    createdAt={msg.createdAt}
                  />
                );
              }
              return (
                <MessageAgent
                  key={msg.id}
                  message={msg.content as AgentMessage}
                  isStreaming={isLoading && msg.id === lastAgentMsgId}
                  createdAt={msg.createdAt}
                  onRetry={
                    msg.id === lastAgentMsgId && (msg.content as AgentMessage).error
                      ? () => handleSubmit(lastQuestionRef.current)
                      : undefined
                  }
                  onFollowup={
                    msg.id === lastAgentMsgId && !isLoading
                      ? handleSubmit
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-zinc-100 dark:border-zinc-800 p-4 shrink-0">
        <div className="max-w-3xl mx-auto">
          <InputBar key={conversationId ?? "new"} onSubmit={handleSubmit} disabled={isLoading} onStop={handleStop} textareaRef={inputBarRef} />

        </div>
      </div>
      <span className="absolute bottom-3 right-4 text-[11px] text-zinc-300 dark:text-zinc-700 select-none pointer-events-none">
        BP° works
      </span>
    </div>
  );
}
