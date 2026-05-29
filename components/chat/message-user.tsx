"use client";

import { memo, useState, useRef } from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageUserProps {
  content: string;
  isNew?: boolean;
  createdAt?: string;
  onEdit?: (newContent: string) => void;
  isStreaming?: boolean;
}

export const MessageUser = memo(function MessageUser({ content, isNew, createdAt, onEdit, isStreaming }: MessageUserProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const time = createdAt
    ? new Date(createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;

  function adjustHeight() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function startEdit() {
    setEditValue(content);
    setIsEditing(true);
    setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
      adjustHeight();
    }, 0);
  }

  function cancelEdit() {
    setIsEditing(false);
    setEditValue("");
  }

  function confirmEdit() {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === content) {
      cancelEdit();
      return;
    }
    onEdit?.(trimmed);
    setIsEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      confirmEdit();
    }
    if (e.key === "Escape") {
      cancelEdit();
    }
  }

  if (isEditing) {
    return (
      <div className="flex justify-end mb-4">
        <div className="flex flex-col items-end gap-2 w-full max-w-[85%]">
          <div className="w-full rounded-2xl rounded-tr-sm overflow-hidden border border-zinc-600 dark:border-zinc-500">
            <textarea
              ref={textareaRef}
              value={editValue}
              onChange={(e) => { setEditValue(e.target.value); adjustHeight(); }}
              onKeyDown={handleKeyDown}
              rows={1}
              className="w-full resize-none text-sm bg-zinc-800 dark:bg-zinc-600 text-white outline-none px-4 py-2.5 leading-relaxed min-h-[42px] max-h-[200px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={cancelEdit}
              className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors px-2 py-1"
            >
              Cancel
            </button>
            <button
              onClick={confirmEdit}
              disabled={!editValue.trim()}
              className="text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-3 py-1 rounded-md hover:bg-zinc-700 dark:hover:bg-zinc-200 transition-colors disabled:opacity-40"
            >
              Regenerate
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex justify-end mb-4 group/msg", isNew && "animate-in fade-in slide-in-from-bottom-2 duration-300")}>
      <div className="flex flex-col items-end gap-1 max-w-[85%]">
        <div className="relative">
          <div className="bg-zinc-900 dark:bg-zinc-700 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
            {content}
          </div>
          {onEdit && !isStreaming && (
            <button
              onClick={startEdit}
              title="Edit message"
              className="absolute bottom-1 -left-7 opacity-0 group-hover/msg:opacity-50 hover:!opacity-100 transition-opacity p-1 rounded text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {time && (
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500 opacity-0 group-hover/msg:opacity-100 transition-opacity select-none pr-1">
            {time}
          </span>
        )}
      </div>
    </div>
  );
});
