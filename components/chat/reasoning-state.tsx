"use client";

import { useState, useRef } from "react";
import { Check, ChevronDown, Copy, Dot, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ReasoningState } from "@/types";

interface ReasoningStateRowProps {
  state: ReasoningState;
}

export function ReasoningStateRow({ state }: ReasoningStateRowProps) {
  const [isOpen, setIsOpen] = useState(false);
  const canExpand = state.status !== "pending" && state.toolCall !== undefined;

  return (
    <div className="border border-zinc-100 dark:border-zinc-800 rounded-md overflow-hidden animate-in fade-in slide-in-from-left-2 duration-300">
      {/* Header row */}
      <button
        onClick={() => canExpand && setIsOpen((o) => !o)}
        disabled={!canExpand}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
          canExpand ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer" : "cursor-default"
        )}
      >
        {/* Status icon */}
        <span className="shrink-0 w-4 h-4 flex items-center justify-center">
          {state.status === "active" && (
            <Loader2 className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 animate-spin" />
          )}
          {state.status === "done" && (
            <Check className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
          )}
          {state.status === "pending" && (
            <Dot className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600" />
          )}
        </span>

        {/* Label */}
        <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-300 truncate">
          {state.label}
        </span>

        {/* Expand chevron */}
        {canExpand && (
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 shrink-0 transition-transform",
              isOpen && "rotate-180"
            )}
          />
        )}
      </button>

      {/* Expanded panel */}
      {isOpen && state.toolCall && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-3 space-y-2">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 font-tool">
            {state.toolCall.tool}
          </p>

          {state.toolCall.tool === "run_query"
            ? <RunQueryDetail input={state.toolCall.input} output={state.toolCall.output} />
            : <>
                {state.toolCall.input !== undefined && (
                  <div>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 font-tool mb-0.5">input</p>
                    <pre className="text-xs text-zinc-500 font-tool whitespace-pre-wrap break-all">
                      {JSON.stringify(state.toolCall.input, null, 2)}
                    </pre>
                  </div>
                )}
                {state.toolCall.output !== undefined && (
                  <div>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 font-tool mb-0.5">output</p>
                    <div className="max-h-48 overflow-y-auto">
                      <pre className="text-xs text-zinc-500 dark:text-zinc-400 font-tool whitespace-pre-wrap break-all">
                        {JSON.stringify(state.toolCall.output, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </>
          }
        </div>
      )}
    </div>
  );
}

const ROW_LIMIT = 5;

function SqlBlock({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLPreElement>(null);
  function handleCopy() {
    navigator.clipboard.writeText(ref.current?.textContent ?? "");
    setCopied(true);
    toast.success("Copied");
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div>
      <p className="text-xs text-zinc-400 dark:text-zinc-500 font-tool mb-0.5">query</p>
      <div className="relative">
        <pre ref={ref} className="text-xs text-zinc-500 dark:text-zinc-400 font-tool whitespace-pre-wrap break-all bg-zinc-100 dark:bg-zinc-800 rounded p-2 pr-8">
          {sql}
        </pre>
        <button
          onClick={handleCopy}
          className="absolute top-1.5 right-1.5 p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          aria-label="Copy SQL"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
    </div>
  );
}

function RunQueryDetail({ input, output }: { input: unknown; output: unknown }) {
  const sql = (input as { sql?: string })?.sql;

  return (
    <div className="space-y-2">
      {sql && <SqlBlock sql={sql} />}

      {output !== undefined && (
        <div>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 font-tool mb-0.5">result</p>
          <QueryResult output={output} />
        </div>
      )}
    </div>
  );
}

function QueryResult({ output }: { output: unknown }) {
  if (output && typeof output === "object" && "error" in output) {
    return (
      <p className="text-xs text-red-500 font-tool">
        {String((output as { error: unknown }).error)}
      </p>
    );
  }

  const outputObj = output as { rows?: unknown[] } | null;
  const allRows = Array.isArray(outputObj?.rows) ? outputObj.rows : null;

  if (!allRows) {
    return (
      <pre className="text-xs text-zinc-500 dark:text-zinc-400 font-tool whitespace-pre-wrap break-all">
        {JSON.stringify(output, null, 2)}
      </pre>
    );
  }

  if (allRows.length === 0) {
    return <p className="text-xs text-zinc-400 dark:text-zinc-500 font-tool">No rows returned</p>;
  }

  const columns = Object.keys(allRows[0] as object);
  const rows = allRows.slice(0, ROW_LIMIT);
  const overflow = allRows.length - ROW_LIMIT;

  return (
    <div className="space-y-1">
      <div className="overflow-x-auto">
        <table className="text-xs font-tool w-full border-collapse">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col} className="text-left text-zinc-400 dark:text-zinc-500 font-medium px-2 py-1 border-b border-zinc-200 dark:border-zinc-700 whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => (
                  <td key={col} className="text-zinc-500 dark:text-zinc-400 px-2 py-1 border-b border-zinc-100 dark:border-zinc-800 whitespace-nowrap max-w-[200px] truncate">
                    {String((row as Record<string, unknown>)[col] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {overflow > 0 && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500 font-tool px-2">
          and {overflow} more {overflow === 1 ? "row" : "rows"}
        </p>
      )}
    </div>
  );
}
