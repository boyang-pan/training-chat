"use client";

import { Logo } from "@/components/ui/logo";

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
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-6 px-6">
      <Logo className="w-8 h-8 text-zinc-200 dark:text-zinc-700" />

      <div className="space-y-1">
        <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Ask about your training
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Analyze your workouts with AI
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 max-w-sm w-full">
        {EXAMPLE_PROMPTS.map(({ label, prompt }) => (
          <button
            key={label}
            onClick={() => onPrompt(prompt)}
            className="border border-zinc-200 dark:border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-left transition-colors"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
