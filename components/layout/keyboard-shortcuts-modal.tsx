"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface KeyboardShortcutsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SHORTCUTS = [
  {
    category: "Navigation",
    items: [
      { keys: ["⌘ B"], description: "Toggle sidebar" },
      { keys: ["⌘ K"], description: "New conversation" },
      { keys: ["⌘ F"], description: "Search conversations" },
    ],
  },
  {
    category: "Chat",
    items: [
      { keys: ["/"], description: "Focus input" },
      { keys: ["Enter"], description: "Send message" },
      { keys: ["⇧ Enter"], description: "New line" },
      { keys: ["Esc"], description: "Stop generation" },
    ],
  },
  {
    category: "Other",
    items: [{ keys: ["?"], description: "Show keyboard shortcuts" }],
  },
];

export function KeyboardShortcutsModal({ open, onOpenChange }: KeyboardShortcutsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-6 gap-0">
        <DialogTitle className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-5">
          Keyboard shortcuts
        </DialogTitle>
        <div className="space-y-5">
          {SHORTCUTS.map((section) => (
            <div key={section.category}>
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2.5">
                {section.category}
              </p>
              <div className="space-y-2">
                {section.items.map((item) => (
                  <div key={item.description} className="flex items-center justify-between">
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">{item.description}</span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((key, i) => (
                        <kbd
                          key={i}
                          className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 rounded"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
