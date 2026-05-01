"use client";

import { useState, useEffect, useRef } from "react";
import { Search, X, MessageSquare } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn, groupByRecency, relativeTime } from "@/lib/utils";
import type { Conversation } from "@/types";

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  conversations: Conversation[];
  onSelect: (id: string) => void;
}

export function SearchModal({ open, onClose, conversations, onSelect }: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    } else {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const filtered = query.trim()
    ? conversations.filter((c) =>
        (c.title ?? "New conversation").toLowerCase().includes(query.toLowerCase())
      )
    : conversations;

  const groups = groupByRecency(filtered);
  const flatResults = [...groups.today, ...groups.thisWeek, ...groups.earlier];

  function handleSelect(id: string) {
    onClose();
    onSelect(id);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const target = flatResults[activeIndex];
      if (target) handleSelect(target.id);
    }
  }

  function renderGroup(label: string, items: Conversation[], startIndex: number) {
    if (items.length === 0) return null;
    return (
      <>
        <p className="text-xs text-zinc-400 dark:text-zinc-500 uppercase tracking-wide px-4 pt-3 pb-1">
          {label}
        </p>
        {items.map((c, i) => {
          const flatIndex = startIndex + i;
          const isActive = flatIndex === activeIndex;
          return (
            <button
              key={c.id}
              data-index={flatIndex}
              onClick={() => handleSelect(c.id)}
              onMouseEnter={() => setActiveIndex(flatIndex)}
              className={cn(
                "w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors",
                isActive
                  ? "bg-zinc-100 dark:bg-zinc-800"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
              )}
            >
              <MessageSquare className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 shrink-0" />
              <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-300 truncate">
                {c.title ?? "New conversation"}
              </span>
              <span className="text-xs text-zinc-400 dark:text-zinc-500 shrink-0">
                {relativeTime(c.created_at)}
              </span>
            </button>
          );
        })}
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="p-0 gap-0 max-w-xl top-[20%] translate-y-0 overflow-hidden"
      >
        <DialogTitle className="sr-only">Search conversations</DialogTitle>

        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <Search className="w-4 h-4 text-zinc-400 dark:text-zinc-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search conversations..."
            className="flex-1 bg-transparent outline-none text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto max-h-[60vh] py-1">
          {flatResults.length === 0 ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-500 text-center py-8">
              No conversations found
            </p>
          ) : (
            <>
              {renderGroup("Today", groups.today, 0)}
              {renderGroup("This week", groups.thisWeek, groups.today.length)}
              {renderGroup("Earlier", groups.earlier, groups.today.length + groups.thisWeek.length)}
            </>
          )}
        </div>

        {/* Keyboard hints */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-zinc-100 dark:border-zinc-800">
          <span className="text-xs text-zinc-400 dark:text-zinc-500">↑↓ navigate</span>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">↵ open</span>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
