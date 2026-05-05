"use client";

import { memo } from "react";

interface MessageUserProps {
  content: string;
  createdAt?: string;
}

export const MessageUser = memo(function MessageUser({ content, createdAt }: MessageUserProps) {
  const time = createdAt
    ? new Date(createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <div className="flex justify-end mb-4 group/msg">
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
