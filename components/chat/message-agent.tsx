"use client";

import { useState, useRef } from "react";
import { Copy, Check, RotateCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThinkingContainer } from "@/components/chat/thinking-container";
import { ChartBlock } from "@/components/chat/chart-block";
import { cn } from "@/lib/utils";
import type { AgentMessage } from "@/types";

interface MessageAgentProps {
  message: AgentMessage;
  isStreaming?: boolean;
  createdAt?: string;
  onRetry?: () => void;
  onFollowup?: (question: string) => void;
}

function PreBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLPreElement>(null);
  function handleCopy() {
    navigator.clipboard.writeText(ref.current?.textContent ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="relative mb-3 last:mb-0">
      <pre
        ref={ref}
        className="text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-3 py-2 pr-8 font-mono overflow-x-auto text-zinc-700 dark:text-zinc-300"
      >
        {children}
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-1.5 right-1.5 p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700"
        aria-label="Copy code"
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  );
}

export function MessageAgent({ message, isStreaming, createdAt, onRetry, onFollowup }: MessageAgentProps) {
  const [copied, setCopied] = useState(false);
  const time = createdAt
    ? new Date(createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;

  function handleCopy() {
    navigator.clipboard.writeText(message.final_answer ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mb-6">
      <ThinkingContainer
        reasoning={message.reasoning}
        states={message.states}
        isStreaming={isStreaming ?? false}
        hasAnswer={!!message.final_answer}
        duration_ms={message.duration_ms}
      />

      {/* Chart */}
      {message.chart && <ChartBlock chart={message.chart} />}

      {/* Pulsing indicator while streaming with no answer yet */}
      {isStreaming && !message.final_answer && (
        <div className="flex items-center gap-1 py-1">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600 animate-bounce [animation-delay:0ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600 animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600 animate-bounce [animation-delay:300ms]" />
        </div>
      )}

      {/* Final answer */}
      {message.final_answer && (
        <div className="group/answer relative">
          <div
            className="prose-answer"
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => (
                  <p className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed mb-3 last:mb-0">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className="text-sm text-zinc-800 dark:text-zinc-200 list-disc pl-4 mb-3 space-y-1">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="text-sm text-zinc-800 dark:text-zinc-200 list-decimal pl-4 mb-3 space-y-1">{children}</ol>
                ),
                li: ({ children }) => (
                  <li className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">{children}</li>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold text-zinc-900 dark:text-zinc-100">{children}</strong>
                ),
                em: ({ children }) => (
                  <em className="italic">{children}</em>
                ),
                h1: ({ children }) => (
                  <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-2 mt-4 first:mt-0">{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2 mt-4 first:mt-0">{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1 mt-3 first:mt-0">{children}</h3>
                ),
                code: ({ children, className }) => {
                  if (className?.includes("language-")) return <>{children}</>;
                  return (
                    <code className="text-xs bg-zinc-100 dark:bg-zinc-800 rounded px-1 py-0.5 font-mono text-zinc-700 dark:text-zinc-300">{children}</code>
                  );
                },
                pre: ({ children }) => <PreBlock>{children}</PreBlock>,
                hr: () => <hr className="border-zinc-200 dark:border-zinc-700 my-3" />,
                table: ({ children }) => (
                  <div className="overflow-x-auto mb-3">
                    <table className="w-full text-sm border-collapse">{children}</table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="border-b border-zinc-200 dark:border-zinc-700">{children}</thead>
                ),
                tbody: ({ children }) => <tbody>{children}</tbody>,
                tr: ({ children }) => (
                  <tr className="border-b border-zinc-100 dark:border-zinc-800 last:border-0">{children}</tr>
                ),
                th: ({ children }) => (
                  <th className="text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide py-2 pr-4 first:pl-0">{children}</th>
                ),
                td: ({ children }) => (
                  <td className="text-sm text-zinc-800 dark:text-zinc-200 py-1.5 pr-4 first:pl-0 whitespace-nowrap">{children}</td>
                ),
              }}
            >
              {message.final_answer}
            </ReactMarkdown>
            {isStreaming && (
              <span className="inline-flex items-center gap-0.5 ml-1 mb-1">
                <span className="w-1 h-1 rounded-full bg-zinc-400 dark:bg-zinc-500 animate-bounce [animation-delay:0ms]" />
                <span className="w-1 h-1 rounded-full bg-zinc-400 dark:bg-zinc-500 animate-bounce [animation-delay:150ms]" />
                <span className="w-1 h-1 rounded-full bg-zinc-400 dark:bg-zinc-500 animate-bounce [animation-delay:300ms]" />
              </span>
            )}
          </div>

          {!isStreaming && !message.error && (
            <div className="absolute -bottom-5 inset-x-0 flex items-center justify-between opacity-0 group-hover/answer:opacity-100 transition-opacity">
              {time ? (
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500 select-none">{time}</span>
              ) : <span />}
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                {copied ? (
                  <><Check className="w-3 h-3" /> Copied</>
                ) : (
                  <><Copy className="w-3 h-3" /> Copy</>
                )}
              </button>
            </div>
          )}

          {message.error && onRetry && !isStreaming && (
            <button
              onClick={onRetry}
              className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Try again
            </button>
          )}
        </div>
      )}

      {/* Follow-up suggestions */}
      {!isStreaming && !message.error && message.followups && message.followups.length > 0 && onFollowup && (
        <div className="flex flex-wrap gap-2 mt-4">
          {message.followups.map((q) => (
            <button
              key={q}
              onClick={() => onFollowup(q)}
              className="text-xs px-3 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
