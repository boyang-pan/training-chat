"use client";

import { useState, useEffect } from "react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

type PromptItem = { label: string; prompt: string };

const FALLBACK_PROMPTS: PromptItem[] = [
  { label: "Am I getting faster?", prompt: "Am I getting faster? Identify the sport I do most frequently, then focus on my pace or speed trend over the last 3 months for that sport only." },
  { label: "Heart rate trends?", prompt: "Has my average heart rate at the same pace improved over the last 6 months? Show me the trend." },
  { label: "Suggest a workout", prompt: "Suggest a workout for today based on my current training load and form." },
  { label: "Signs of overtraining?", prompt: "Are there any signs of overtraining in my recent activity? Look at the last 4 weeks only." },
];

const CACHE_KEY = "suggested-prompts";
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function readCache(): PromptItem[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { prompts, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return prompts.map((q: string) => ({ label: q, prompt: q }));
  } catch {
    return null;
  }
}

function writeCache(prompts: string[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ prompts, ts: Date.now() }));
  } catch {}
}

interface EmptyStateProps {
  onPrompt: (prompt: string) => void;
}

export function EmptyState({ onPrompt }: EmptyStateProps) {
  const [visible, setVisible] = useState(false);
  const [prompts, setPrompts] = useState<PromptItem[] | "loading">("loading");

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setPrompts(cached);
      // Silently refresh in background — no skeleton since we have cached data
      fetch("/api/suggested-prompts")
        .then((r) => r.json())
        .then((d) => {
          if (Array.isArray(d.prompts) && d.prompts.length >= 4) {
            writeCache(d.prompts);
            setPrompts(d.prompts.slice(0, 4).map((q: string) => ({ label: q, prompt: q })));
          }
        })
        .catch(() => {});
      return;
    }

    // No cache — show skeleton until API responds, fall back on failure
    const timeout = setTimeout(() => setPrompts(FALLBACK_PROMPTS), 6000);

    fetch("/api/suggested-prompts")
      .then((r) => r.json())
      .then((d) => {
        clearTimeout(timeout);
        if (Array.isArray(d.prompts) && d.prompts.length >= 4) {
          writeCache(d.prompts);
          setPrompts(d.prompts.slice(0, 4).map((q: string) => ({ label: q, prompt: q })));
        } else {
          setPrompts(FALLBACK_PROMPTS);
        }
      })
      .catch(() => { clearTimeout(timeout); setPrompts(FALLBACK_PROMPTS); });

    return () => clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-6 px-6">
      <Logo
        className={cn(
          "w-8 h-8 text-zinc-200 dark:text-zinc-700 transition-all duration-500",
          visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
        )}
      />

      <div
        className={cn(
          "space-y-1 transition-all duration-500",
          visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
        )}
        style={{ transitionDelay: visible ? "100ms" : "0ms" }}
      >
        <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Ask about your training
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Analyze your workouts with AI
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg w-full">
        {prompts === "loading" ? (
          [0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{ transitionDelay: visible ? `${200 + i * 75}ms` : "0ms" }}
              className={cn(
                "animate-pulse bg-zinc-100 dark:bg-zinc-800 rounded-md h-[38px] transition-all duration-500",
                visible ? "opacity-100" : "opacity-0"
              )}
            />
          ))
        ) : (
          prompts.map(({ label, prompt }, i) => (
            <button
              key={label}
              onClick={() => onPrompt(prompt)}
              style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}
              className="animate-in fade-in slide-in-from-bottom-1 duration-300 border border-zinc-200 dark:border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-left"
            >
              {label}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
