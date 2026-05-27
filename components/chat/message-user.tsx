"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

interface MessageUserProps {
  content: string;
  isNew?: boolean;
  createdAt?: string;
}

export const MessageUser = memo(function MessageUser({ content, isNew, createdAt }: MessageUserProps) {
  const time = createdAt
    ? new Date(createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <div className={cn("flex justify-end mb-4 group/msg", isNew && "animate-in fade-in slide-in-from-bottom-2 duration-300")}>
      <div className="flex flex-col items-end gap-1 max-w-[85%]">
        <div className="bg-zinc-900 dark:bg-zinc-700 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
          {content}
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
