"use client";

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useTheme } from "next-themes";
import type { SegmentPayload, SegmentEffort } from "@/types";

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function formatDistance(m: number): string {
  if (m <= 0) return "";
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

interface TooltipPayload {
  payload?: SegmentEffort & { timestamp: number };
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-2.5 py-1.5 shadow-sm">
      <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{formatTime(d.time_sec)}</p>
      {d.is_best && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Personal best</p>
      )}
      {!d.is_best && d.pr_rank && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Top-{d.pr_rank} at the time</p>
      )}
      <p className="text-xs text-zinc-400 dark:text-zinc-500">{d.date}</p>
    </div>
  );
}

interface SegmentBlockProps {
  segment: SegmentPayload;
}

export function SegmentBlock({ segment }: SegmentBlockProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const gridColor = isDark ? "#3f3f46" : "#e4e4e7";
  const tickColor = isDark ? "#a1a1aa" : "#71717a";
  const normalDot = isDark ? "#52525b" : "#a1a1aa";
  const bestDot = isDark ? "#f4f4f5" : "#18181b";

  const axisTickStyle = {
    fontSize: 11,
    fill: tickColor,
    fontFamily: "var(--font-ibm-plex-mono), monospace",
  };

  const tooltipContentStyle = {
    border: "none",
    background: "transparent",
    boxShadow: "none",
    padding: 0,
  };

  // Split into two series for different dot styling
  const normalEfforts = segment.efforts
    .filter((e) => !e.is_best)
    .map((e) => ({ ...e, timestamp: new Date(e.date).getTime() }));

  const bestEffort = segment.efforts
    .filter((e) => e.is_best)
    .map((e) => ({ ...e, timestamp: new Date(e.date).getTime() }));

  // Y-axis domain: give a little breathing room around min/max times
  const allTimes = segment.efforts.map((e) => e.time_sec);
  const minTime = Math.min(...allTimes);
  const maxTime = Math.max(...allTimes);
  const padding = Math.max(Math.round((maxTime - minTime) * 0.15), 5);
  // Reversed: lower time (faster) should appear higher on axis
  const yDomain: [number, number] = [maxTime + padding, Math.max(minTime - padding, 0)];

  const distLabel = formatDistance(segment.distance_m);
  const subtitle = [distLabel, `${segment.effort_count} effort${segment.effort_count !== 1 ? "s" : ""}`, `Best: ${formatTime(segment.best_time_sec)} on ${segment.best_date}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-5 my-2">
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{segment.name}</p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 mb-3">{subtitle}</p>

      <ResponsiveContainer width="100%" height={200}>
        <ScatterChart margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={["auto", "auto"]}
            scale="time"
            tick={axisTickStyle}
            tickFormatter={(v) => {
              const d = new Date(v);
              return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
            }}
          />
          <YAxis
            dataKey="time_sec"
            type="number"
            domain={yDomain}
            tick={axisTickStyle}
            tickFormatter={formatTime}
            width={40}
          />
          <Tooltip content={<CustomTooltip />} contentStyle={tooltipContentStyle} cursor={{ strokeDasharray: "3 3", stroke: gridColor }} />
          <Scatter
            data={normalEfforts}
            fill={normalDot}
            r={3}
          />
          <Scatter
            data={bestEffort}
            fill={bestDot}
            r={5}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
