"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, Trash2, Pencil, MoreHorizontal, PanelLeftClose, Settings, Search } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { useSidebar } from "@/components/layout/resizable-layout";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn, groupByRecency, relativeTime } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Conversation } from "@/types";

interface SidebarProps {
  conversations: Conversation[];
  isLoadingConversations?: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  userEmail?: string | null;
  userName?: string | null;
  onLogout?: () => void;
  onOpenModal?: (tab: "sync" | "settings") => void;
  onOpenSearch?: () => void;
}


function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title ?? "");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) inputRef.current?.select();
  }, [isEditing]);

  function startEditing() {
    setDraft(conversation.title ?? "");
    setIsEditing(true);
  }

  function commitRename() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== conversation.title) {
      onRename(trimmed);
    }
    setIsEditing(false);
  }


  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitRename();
    if (e.key === "Escape") setIsEditing(false);
  }

  return (
    <div
      className={cn(
        "group w-full min-w-0 rounded-md transition-colors flex items-center",
        isActive
          ? "bg-zinc-100 dark:bg-zinc-800"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
      )}
    >
      {/* Main select button */}
      <button
        onClick={onSelect}
        className="flex-1 min-w-0 text-left px-3 py-2 overflow-hidden"
      >
        {isEditing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="w-full text-sm bg-transparent outline-none border-b border-zinc-300 dark:border-zinc-600 leading-snug text-zinc-900 dark:text-zinc-100"
          />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <p
                className={cn(
                  "text-sm truncate leading-snug",
                  isActive
                    ? "font-medium text-zinc-900 dark:text-zinc-100"
                    : "font-normal text-zinc-700 dark:text-zinc-300",
                  !conversation.title && "italic text-zinc-400 dark:text-zinc-500"
                )}
              >
                {conversation.title ?? "New conversation"}
              </p>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[220px]">
              {conversation.title ?? "New conversation"}
            </TooltipContent>
          </Tooltip>
        )}
        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
          {relativeTime(conversation.created_at)}
        </p>
      </button>

      {/* ··· menu — hover reveal */}
      {!isEditing && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 mr-1 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-zinc-200 dark:hover:bg-zinc-700 focus:opacity-100 focus:outline-none"
              aria-label="More options"
            >
              <MoreHorizontal className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right">
            <DropdownMenuItem onSelect={startEditing}>
              <Pencil className="w-3.5 h-3.5" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setShowDeleteDialog(true)} destructive>
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete conversation?</DialogTitle>
            <DialogDescription>
              &ldquo;{conversation.title ?? "New conversation"}&rdquo; will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => { setShowDeleteDialog(false); onDelete(); }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GroupLabel({ label }: { label: string }) {
  return (
    <p className="text-xs text-zinc-400 dark:text-zinc-500 uppercase tracking-wide px-3 pt-3 pb-1">
      {label}
    </p>
  );
}

interface SyncJob {
  phase: number;
  status: "running" | "completed" | "failed";
  total: number | null;
  synced: number;
  error: string | null;
  started_at: string;
  updated_at: string;
}

interface SyncData {
  phase1: SyncJob | null;
  phase2: SyncJob | null;
}

function PhaseRow({ label, job }: { label: string; job: SyncJob }) {
  const { status, synced, total } = job;

  if (status === "completed") {
    return (
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
        <p className="text-xs text-green-500">{synced.toLocaleString()} ✓</p>
      </div>
    );
  }

  const pct = total && total > 0 ? Math.round((synced / total) * 100) : null;
  const etaMins = total ? Math.ceil(((total - synced) / 100) * 15) : null;
  const eta = etaMins && etaMins > 0
    ? etaMins > 60 ? `~${Math.ceil(etaMins / 60)}h left` : `~${etaMins}m left`
    : null;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          {status === "failed"
            ? "failed"
            : total
              ? `${synced.toLocaleString()} / ${total.toLocaleString()}${eta ? ` · ${eta}` : ""}`
              : `${synced.toLocaleString()}…`}
        </p>
      </div>
      {status !== "failed" && (
        <div className="w-full h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-orange-500 rounded-full transition-all duration-500"
            style={{ width: pct !== null ? `${pct}%` : "5%" }}
          />
        </div>
      )}
    </div>
  );
}

function SyncCard({ onViewDetails }: { onViewDetails: () => void }) {
  const [data, setData] = useState<SyncData | null>(null);

  const fetchStatus = () => {
    fetch("/api/sync-status")
      .then((r) => r.json())
      .then((d: SyncData) => setData(d))
      .catch(() => {});
  };

  useEffect(() => { fetchStatus(); }, []);

  useEffect(() => {
    if (!data) return;
    const anyRunning = data.phase1?.status === "running" || data.phase2?.status === "running";
    if (!anyRunning) return;
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, [data]);

  if (!data || (!data.phase1 && !data.phase2)) return null;

  const { phase1, phase2 } = data;
  const anyFailed = phase1?.status === "failed" || phase2?.status === "failed";
  const allDone = phase1?.status === "completed" && phase2?.status === "completed";

  if (allDone) return null;

  return (
    <div className="px-3 pb-2">
      <button
        onClick={onViewDetails}
        className={cn(
          "w-full text-left px-3 py-3 rounded-lg border transition-colors space-y-2.5 group",
          anyFailed
            ? "border-red-200 dark:border-red-900 hover:border-red-300 dark:hover:border-red-800"
            : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
        )}
      >
        <div className="flex items-center justify-between">
          <span className={cn(
            "text-xs font-medium",
            anyFailed ? "text-red-500" : "text-zinc-600 dark:text-zinc-400"
          )}>
            {anyFailed ? "⚠ Sync failed" : "Syncing your data"}
          </span>
          <span className="text-xs text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors">
            View details ›
          </span>
        </div>
        {phase1 && <PhaseRow label="Activities" job={phase1} />}
        {phase2 && <PhaseRow label="Enrichment" job={phase2} />}
      </button>
    </div>
  );
}


export function Sidebar({ conversations, isLoadingConversations, activeId, onSelect, onNew, onDelete, onRename, userEmail, userName, onLogout, onOpenModal, onOpenSearch }: SidebarProps) {
  const groups = groupByRecency(conversations);
  const sidebar = useSidebar();

  return (
    <div className="border-r border-zinc-100 dark:border-zinc-800 flex flex-col h-full bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-baseline gap-2 px-3 py-4">
        <Logo className="w-6 h-6 text-zinc-900 dark:text-zinc-100" />
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex-1">Training Chat</span>
        {sidebar && (
          <button
            onClick={sidebar.toggle}
            title="Hide sidebar"
            className="p-1 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* New conversation */}
      <div className="px-3 pb-3">
        <Button
          variant="outline"
          className="w-full justify-start gap-2 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-normal dark:bg-transparent dark:hover:bg-zinc-800"
          onClick={onNew}
        >
          <Plus className="w-4 h-4" />
          New conversation
        </Button>
      </div>

      <Separator className="bg-zinc-100 dark:bg-zinc-800" />

      {/* Search trigger */}
      {!isLoadingConversations && conversations.length > 0 && (
        <div className="px-3 py-2">
          <Button
            variant="outline"
            className="w-full justify-start gap-2 border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 font-normal dark:bg-transparent dark:hover:bg-zinc-800"
            onClick={onOpenSearch}
          >
            <Search className="w-4 h-4" />
            <span className="flex-1 text-left">Search conversations...</span>
            <kbd className="text-[10px] text-zinc-300 dark:text-zinc-600 font-mono">⌘F</kbd>
          </Button>
        </div>
      )}

      {/* Conversation list */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="px-1.5 pb-2">
          {isLoadingConversations ? (
            <div className="px-1.5 pt-2 space-y-1 animate-pulse">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="px-3 py-2 space-y-1.5">
                  <div className={cn("h-3.5 rounded bg-zinc-100 dark:bg-zinc-800", i % 2 === 0 ? "w-3/4" : "w-1/2")} />
                  <div className="h-2.5 w-1/4 rounded bg-zinc-100 dark:bg-zinc-800" />
                </div>
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <p className="text-xs text-zinc-400 dark:text-zinc-500 px-3 pt-4 text-center">
              No conversations yet
            </p>
          ) : null}

          {!isLoadingConversations && (
            <>
              {groups.today.length > 0 && (
                <>
                  <GroupLabel label="Today" />
                  {groups.today.map((c) => (
                    <ConversationItem
                      key={c.id}
                      conversation={c}
                      isActive={c.id === activeId}
                      onSelect={() => onSelect(c.id)}
                      onDelete={() => onDelete(c.id)}
                      onRename={(title) => onRename(c.id, title)}
                    />
                  ))}
                </>
              )}

              {groups.thisWeek.length > 0 && (
                <>
                  <GroupLabel label="This week" />
                  {groups.thisWeek.map((c) => (
                    <ConversationItem
                      key={c.id}
                      conversation={c}
                      isActive={c.id === activeId}
                      onSelect={() => onSelect(c.id)}
                      onDelete={() => onDelete(c.id)}
                      onRename={(title) => onRename(c.id, title)}
                    />
                  ))}
                </>
              )}

              {groups.earlier.length > 0 && (
                <>
                  <GroupLabel label="Earlier" />
                  {groups.earlier.map((c) => (
                    <ConversationItem
                      key={c.id}
                      conversation={c}
                      isActive={c.id === activeId}
                      onSelect={() => onSelect(c.id)}
                      onDelete={() => onDelete(c.id)}
                      onRename={(title) => onRename(c.id, title)}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Sync card — above footer, visible while syncing or after completion */}
      <SyncCard onViewDetails={() => onOpenModal?.("sync")} />

      {/* Footer */}
      {userEmail && (
        <div className="px-2 py-2 border-t border-zinc-100 dark:border-zinc-800">
          <button
            onClick={() => onOpenModal?.("settings")}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group"
          >
            <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate flex-1 min-w-0 text-left">
              {userName ?? userEmail}
            </span>
            <Settings className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        </div>
      )}
    </div>
  );
}
