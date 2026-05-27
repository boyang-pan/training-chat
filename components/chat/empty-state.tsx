"use client";

import { useState, useEffect } from "react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

const EXAMPLE_PROMPTS: { label: string; prompt: string }[] = [
  {
    label: "Am I getting faster?",
    prompt: "Am I getting faster? Identify the sport I do most frequently, then focus on my pace or speed trend over the last 3 months for that sport only.",
  },
  {
    label: "Heart rate trends?",
    prompt: "Has my average heart rate at the same pace improved over the last 6 months? Show me the trend.",
  },
  {
    label: "Suggest a workout",
    prompt: "Suggest a workout for today based on my current training load and form.",
  },
  {
    label: "Signs of overtraining?",
    prompt: "Are there any signs of overtraining in my recent activity? Look at the last 4 weeks only.",
  },
];

interface EmptyStateProps {
  onPrompt: (prompt: string) => void;
}

export function EmptyState({ onPrompt }: EmptyStateProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
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

      <div className="grid grid-cols-2 gap-2 max-w-sm w-full">
        {EXAMPLE_PROMPTS.map(({ label, prompt }, i) => (
          <button
            key={label}
            onClick={() => onPrompt(prompt)}
            style={{ transitionDelay: visible ? `${200 + i * 75}ms` : "0ms" }}
            className={cn(
              "border border-zinc-200 dark:border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-left transition-all duration-500",
              visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
