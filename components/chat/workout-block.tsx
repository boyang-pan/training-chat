"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import type { WorkoutPayload, WorkoutSegment } from "@/types";

// Light mode: low zones are light gray, high zones approach zinc-900
const ZONE_COLORS_LIGHT: Record<number, string> = {
  1: "#d4d4d8", // zinc-300
  2: "#a1a1aa", // zinc-400
  3: "#71717a", // zinc-500
  4: "#52525b", // zinc-600
  5: "#3f3f46", // zinc-700
  6: "#27272a", // zinc-800
  7: "#18181b", // zinc-900
};

// Dark mode: low zones are near-background, high zones are near-white
const ZONE_COLORS_DARK: Record<number, string> = {
  1: "#3f3f46", // zinc-700
  2: "#52525b", // zinc-600
  3: "#71717a", // zinc-500
  4: "#a1a1aa", // zinc-400
  5: "#d4d4d8", // zinc-300
  6: "#e4e4e7", // zinc-200
  7: "#f4f4f5", // zinc-100
};

const ZONE_LABELS: Record<number, string> = {
  1: "Z1 Recovery",
  2: "Z2 Endurance",
  3: "Z3 Tempo",
  4: "Z4 Threshold",
  5: "Z5 VO2max",
  6: "Z6 Anaerobic",
  7: "Z7 Neuromuscular",
};

const ZONE_INTENSITY_MIDPOINT: Record<number, number> = {
  1: 30,
  2: 60,
  3: 78,
  4: 95,
  5: 110,
  6: 130,
  7: 150,
};

function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

const SPORT_LABEL: Record<string, string> = {
  run: "Run",
  ride: "Ride",
  swim: "Swim",
  other: "Other",
};

interface SegmentBarProps {
  seg: WorkoutSegment;
  totalMin: number;
  color: string;
}

function SegmentBar({ seg, totalMin, color }: SegmentBarProps) {
  const [hovered, setHovered] = useState(false);
  const intensity = seg.intensity_pct ?? ZONE_INTENSITY_MIDPOINT[seg.zone];
  const heightPct = Math.min(intensity / 150, 1) * 100;
  const widthPct = (seg.duration_min / totalMin) * 100;

  return (
    <div
      className="relative flex-shrink-0"
      style={{ width: `${widthPct}%`, height: "100%", display: "flex", alignItems: "flex-end" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          width: "100%",
          height: `${heightPct}%`,
          backgroundColor: color,
          borderRadius: "3px 3px 0 0",
          minHeight: 4,
          opacity: hovered ? 0.7 : 1,
          transition: "opacity 0.1s",
        }}
      />
      {hovered && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-2.5 py-1.5 shadow-sm whitespace-nowrap">
            <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
              {ZONE_LABELS[seg.zone]}
            </p>
            {seg.label && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{seg.label}</p>
            )}
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {seg.duration_min % 1 === 0
                ? `${seg.duration_min} min`
                : `${seg.duration_min.toFixed(1)} min`}
              {seg.intensity_pct != null ? ` · ${seg.intensity_pct}%` : ""}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

interface WorkoutBlockProps {
  workout: WorkoutPayload;
}

export function WorkoutBlock({ workout }: WorkoutBlockProps) {
  const { title, sport, total_duration_min, segments, description } = workout;
  const { resolvedTheme } = useTheme();
  const zoneColors = resolvedTheme === "dark" ? ZONE_COLORS_DARK : ZONE_COLORS_LIGHT;

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-5 my-2">
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
        <span className="ml-2 text-xs font-normal text-zinc-400 dark:text-zinc-500">
          {SPORT_LABEL[sport] ?? sport}
        </span>
      </p>
      {description && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 mb-3">{description}</p>
      )}
      <div
        className="flex items-end gap-px mt-3"
        style={{ height: 120 }}
      >
        {segments.map((seg, i) => (
          <SegmentBar key={i} seg={seg} totalMin={total_duration_min} color={zoneColors[seg.zone]} />
        ))}
      </div>
      {/* Zone legend — only zones used in this workout */}
      {(() => {
        const usedZones = [...new Set(segments.map((s) => s.zone))].sort((a, b) => a - b);
        return (
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2.5">
            {usedZones.map((z) => (
              <div key={z} className="flex items-center gap-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: zoneColors[z] }}
                />
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  {ZONE_LABELS[z]}
                </span>
              </div>
            ))}
          </div>
        );
      })()}
      <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-2">
        {formatDuration(total_duration_min)} total
      </p>
    </div>
  );
}
