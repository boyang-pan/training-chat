"use client";

import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
  PieChart,
  Pie,
  Cell,
  Legend,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useTheme } from "next-themes";
import type { ChartPayload } from "@/types";

interface ChartBlockProps {
  chart: ChartPayload;
}

const DASH_PATTERNS = ["0", "5 5", "2 2"];

export function ChartBlock({ chart }: ChartBlockProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const seriesColor = isDark ? "#e4e4e7" : "#18181b";
  const seriesColors = isDark
    ? ["#e4e4e7", "#a1a1aa", "#71717a"]
    : ["#18181b", "#52525b", "#a1a1aa"];
  const pieColors = isDark
    ? ["#e4e4e7", "#a1a1aa", "#71717a", "#3f3f46"]
    : ["#18181b", "#52525b", "#a1a1aa", "#d4d4d8"];
  const gridColor = isDark ? "#3f3f46" : "#e4e4e7";
  const tickColor = isDark ? "#a1a1aa" : "#71717a";
  const tooltipBg = isDark ? "#27272a" : "#ffffff";
  const tooltipBorder = isDark ? "#3f3f46" : "#e4e4e7";
  const tooltipText = isDark ? "#f4f4f5" : "#18181b";

  const axisTickStyle = {
    fontSize: 11,
    fill: tickColor,
    fontFamily: "var(--font-ibm-plex-mono), monospace",
  };

  const tooltipContentStyle = {
    border: `1px solid ${tooltipBorder}`,
    borderRadius: "4px",
    fontSize: 11,
    fontFamily: "var(--font-ibm-plex-mono), monospace",
    backgroundColor: tooltipBg,
    color: tooltipText,
    boxShadow: "none",
  };

  const legendStyle = {
    fontSize: 11,
    fontFamily: "var(--font-ibm-plex-mono), monospace",
    color: tickColor,
  };

  const { type, title, subtitle, data, x_key, y_key, y_keys, x_label, y_label } = chart;

  const activeSeries = y_keys && y_keys.length > 0 ? y_keys : [y_key];
  const isMulti = activeSeries.length > 1;

  const axisLabel = (value: string, angle: number, position: "insideBottom" | "insideLeft") => ({
    value,
    angle,
    position,
    style: axisTickStyle,
  });

  const chartHeight = isMulti || type === "pie" ? 260 : 240;

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-5 my-2">
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</p>
      {subtitle && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 mb-3">{subtitle}</p>
      )}

      <ResponsiveContainer width="100%" height={chartHeight}>
        {type === "line" ? (
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis
              dataKey={x_key}
              tick={axisTickStyle}
              label={x_label ? axisLabel(x_label, 0, "insideBottom") : undefined}
            />
            <YAxis
              tick={axisTickStyle}
              label={y_label ? axisLabel(y_label, -90, "insideLeft") : undefined}
            />
            <Tooltip contentStyle={tooltipContentStyle} />
            {isMulti && <Legend wrapperStyle={legendStyle} />}
            {activeSeries.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={seriesColors[i % seriesColors.length]}
                strokeWidth={1.5}
                strokeDasharray={DASH_PATTERNS[i % DASH_PATTERNS.length]}
                dot={false}
                activeDot={{ r: 3, fill: seriesColors[i % seriesColors.length] }}
              />
            ))}
          </LineChart>
        ) : type === "area" ? (
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <defs>
              {activeSeries.map((key, i) => (
                <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={seriesColors[i % seriesColors.length]} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={seriesColors[i % seriesColors.length]} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis
              dataKey={x_key}
              tick={axisTickStyle}
              label={x_label ? axisLabel(x_label, 0, "insideBottom") : undefined}
            />
            <YAxis
              tick={axisTickStyle}
              label={y_label ? axisLabel(y_label, -90, "insideLeft") : undefined}
            />
            <Tooltip contentStyle={tooltipContentStyle} />
            {isMulti && <Legend wrapperStyle={legendStyle} />}
            {activeSeries.map((key, i) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke={seriesColors[i % seriesColors.length]}
                strokeWidth={1.5}
                strokeDasharray={DASH_PATTERNS[i % DASH_PATTERNS.length]}
                fill={`url(#fill-${key})`}
                dot={false}
                activeDot={{ r: 3, fill: seriesColors[i % seriesColors.length] }}
              />
            ))}
          </AreaChart>
        ) : type === "bar" ? (
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis dataKey={x_key} tick={axisTickStyle} />
            <YAxis tick={axisTickStyle} />
            <Tooltip contentStyle={tooltipContentStyle} />
            {isMulti && <Legend wrapperStyle={legendStyle} />}
            {activeSeries.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                fill={seriesColors[i % seriesColors.length]}
                radius={[2, 2, 0, 0]}
              />
            ))}
          </BarChart>
        ) : type === "pie" ? (
          <PieChart margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
            <Pie
              data={data}
              dataKey={y_key}
              nameKey={x_key}
              cx="50%"
              cy="45%"
              outerRadius={80}
              strokeWidth={1}
              stroke={isDark ? "#18181b" : "#ffffff"}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={pieColors[i % pieColors.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipContentStyle} />
            <Legend wrapperStyle={legendStyle} />
          </PieChart>
        ) : (
          <ScatterChart margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis dataKey={x_key} tick={axisTickStyle} name={x_label ?? x_key} />
            <YAxis dataKey={y_key} tick={axisTickStyle} name={y_label ?? y_key} />
            <Tooltip contentStyle={tooltipContentStyle} cursor={{ strokeDasharray: "3 3" }} />
            <Scatter data={data} fill={seriesColor} />
          </ScatterChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
