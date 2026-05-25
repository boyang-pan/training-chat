"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { ArrowUp, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface InputBarProps {
  onSubmit: (value: string) => void;
  disabled?: boolean;
  onStop?: () => void;
  onQueue?: (value: string) => void;
  onClearQueue?: () => void;
  hasQueuedMessage?: boolean;
  initialValue?: string;
  onDraftChange?: (value: string) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export function InputBar({ onSubmit, disabled, onStop, onQueue, onClearQueue, hasQueuedMessage, initialValue, onDraftChange, textareaRef: externalRef }: InputBarProps) {
  const [value, setValue] = useState(initialValue ?? "");
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalRef ?? internalRef;

  // Focus when streaming finishes (disabled: true → false)
  const prevDisabled = useRef(disabled);
  useEffect(() => {
    if (prevDisabled.current && !disabled) {
      textareaRef.current?.focus();
    }
    prevDisabled.current = disabled;
  }, [disabled]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    adjustHeight();
  }, []);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (disabled && onQueue) {
      onQueue(trimmed);
      setValue("");
      onDraftChange?.("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      return;
    }
    if (disabled) return;
    onSubmit(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="space-y-1.5">
    <div
      className={cn(
        "border border-zinc-200 dark:border-zinc-700 rounded-lg flex items-center gap-2 p-2 transition-colors",
        "focus-within:border-zinc-400 dark:focus-within:border-zinc-500"
      )}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          adjustHeight();
          onDraftChange?.(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? "Type your next question…" : "Ask about your training..."}
        rows={1}
        className={cn(
          "flex-1 resize-none text-sm bg-transparent outline-none border-0 focus:ring-0",
          "placeholder:text-zinc-400 dark:placeholder:text-zinc-500 text-zinc-900 dark:text-zinc-100",
          "min-h-[40px] max-h-[160px] py-2 px-1 leading-relaxed",
        )}
      />
      {disabled && onStop ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onStop}
          className="shrink-0 h-8 w-8 text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <Square className="w-4 h-4" />
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleSubmit}
          disabled={!value.trim() || disabled}
          className="shrink-0 h-8 w-8 text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30"
        >
          <ArrowUp className="w-4 h-4" />
        </Button>
      )}
    </div>
    {hasQueuedMessage ? (
      <div className="flex items-center justify-between px-1">
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500 select-none">
          1 message queued · will send when done
        </p>
        <button
          onClick={onClearQueue}
          className="flex items-center gap-0.5 text-[11px] text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          aria-label="Cancel queued message"
        >
          <X className="w-3 h-3" />
          Cancel
        </button>
      </div>
    ) : (
      <p className="text-center text-[11px] text-zinc-400 dark:text-zinc-600 select-none">
        Training Chat can make mistakes. Double-check responses.
      </p>
    )}
    </div>
  );
}
