"use client";

import { useState, useEffect } from "react";
import { Brain, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReasoningStateRow } from "@/components/chat/reasoning-state";
import type { ReasoningState } from "@/types";

interface ThinkingContainerProps {
  reasoning?: string;
  states: ReasoningState[];
  isStreaming: boolean;
  hasAnswer: boolean;
  hasError?: boolean;
  duration_ms?: number;
}

export function ThinkingContainer({
  reasoning,
  states,
  isStreaming,
  hasAnswer,
  hasError,
  duration_ms,
}: ThinkingContainerProps) {
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null);
  const [streamJustEnded, setStreamJustEnded] = useState(false);

  useEffect(() => {
    if (isStreaming) {
      setStreamJustEnded(false);
      return;
    }
    setStreamJustEnded(true);
    const t = setTimeout(() => setStreamJustEnded(false), 1000);
    return () => clearTimeout(t);
  }, [isStreaming]);

  const hasContent = !!reasoning || states.length > 0;
  if (!hasContent) return null;

  // Automatic: open while streaming, for 1s after it ends, or on error. User override wins.
  const isOpen = userCollapsed !== null ? !userCollapsed : (isStreaming || streamJustEnded || !!hasError);

  function headerLabel() {
    if (isStreaming && !hasAnswer) {
      const activeState = states.find((s) => s.status === "active");
      return activeState?.label ?? "Thinking";
    }
    if (isStreaming && hasAnswer) {
      return "Writing response…";
    }
    const toolCount = states.filter((s) => s.id !== "planning" && s.toolCall).length;
    const timeStr = duration_ms ? ` · ${Math.round(duration_ms / 1000)}s` : "";
    return toolCount > 0
      ? `Thought · ${toolCount} tool${toolCount !== 1 ? "s" : ""}${timeStr}`
      : `Thought${timeStr}`;
  }

  return (
    <div className="mb-3">
      <button
        onClick={() => setUserCollapsed(isOpen)}
        className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors mb-1.5"
      >
        {isStreaming ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <ChevronDown
            className={cn(
              "w-3 h-3 transition-transform duration-200",
              !isOpen && "-rotate-90"
            )}
          />
        )}
        <Brain className="w-3 h-3" />
        <span>{headerLabel()}</span>
      </button>

      <div
        className={cn(
          "grid transition-all duration-300 ease-in-out",
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          {reasoning && (
            <div className="border-l-2 border-zinc-200 dark:border-zinc-700 pl-3 mb-2">
              <p className="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                {reasoning}
              </p>
            </div>
          )}

          {states.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {states.map((state) => (
                <ReasoningStateRow key={state.id} state={state} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
