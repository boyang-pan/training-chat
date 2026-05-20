import { tool } from "ai";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/client";
import { computeTrainingLoad, type TrainingLoadResult } from "@/lib/agent/training-load";
import type { ChartPayload, WorkoutPayload, SegmentEffort, SegmentPayload } from "@/types";

const trainingLoadCache = new Map<string, { result: TrainingLoadResult; ts: number }>();
const TRAINING_LOAD_CACHE_TTL = 5 * 60 * 1000;

/**
 * Factory that creates agent tools scoped to a specific user.
 * All DB queries are filtered by userId.
 */
export function createAgentTools(userId: string) {
  return {
    run_query: tool({
      description:
        "Executes a read-only SQL query against the activities database. Use for all data retrieval. SQL must be SELECT only — no mutations. Always include WHERE user_id = '" + userId + "' to scope results to the current user.",
      inputSchema: z.object({
        sql: z
          .string()
          .describe("The SQL query to execute. Must be a SELECT statement."),
      }),
      execute: async ({ sql }: { sql: string }) => {
        const safeQuery = stripAndValidateQuery(sql);
        if (!safeQuery) {
          return { error: "Only SELECT statements are permitted." };
        }
        const start = Date.now();
        try {
          const { data, error } = await supabaseAdmin.rpc("run_readonly_query", {
            query: safeQuery,
            p_user_id: userId,
          });
          if (error) return { error: error.message };
          return {
            rows: data,
            row_count: Array.isArray(data) ? data.length : 0,
            duration_ms: Date.now() - start,
          };
        } catch (err) {
          return { error: String(err) };
        }
      },
    }),

    get_activity_detail: tool({
      description:
        "Returns full details for a single activity by ID. Use when you need to drill into a specific activity beyond what aggregates provide.",
      inputSchema: z.object({
        activity_id: z.number().describe("The activity ID"),
      }),
      execute: async ({ activity_id }: { activity_id: number }) => {
        const { data, error } = await supabaseAdmin
          .from("activities")
          .select("*")
          .eq("user_id", userId)
          .eq("id", activity_id)
          .single();
        if (error) return { error: error.message };
        return data;
      },
    }),

    get_personal_records: tool({
      description:
        "Returns all pre-computed personal records from the personal_records table. Use this instead of computing PRs from raw data.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supabaseAdmin
          .from("personal_records")
          .select("metric, value, achieved_at, activities(name, type, start_date)")
          .eq("user_id", userId)
          .order("metric");
        if (error) return { error: error.message };
        return data;
      },
    }),

    get_notes: tool({
      description:
        "Returns activity notes (user-provided subjective context). Use to retrieve cross-session memory. Optionally filter by date range.",
      inputSchema: z.object({
        start_date: z
          .string()
          .optional()
          .describe("ISO date string (YYYY-MM-DD) — start of date range"),
        end_date: z
          .string()
          .optional()
          .describe("ISO date string (YYYY-MM-DD) — end of date range"),
      }),
      execute: async ({ start_date, end_date }: { start_date?: string; end_date?: string }) => {
        let query = supabaseAdmin
          .from("activity_notes")
          .select("*, activities(name, type, start_date)")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        if (start_date) query = query.gte("note_date", start_date);
        if (end_date) query = query.lte("note_date", end_date);

        const { data, error } = await query;
        if (error) return { error: error.message };
        return data;
      },
    }),

    add_note: tool({
      description:
        "Writes a user-provided note to the activity_notes table. Only call this after the user has explicitly provided subjective context to save.",
      inputSchema: z.object({
        content: z.string().describe("The note content to save"),
        activity_id: z
          .number()
          .optional()
          .describe("Activity ID to link this note to, if applicable"),
        note_date: z
          .string()
          .optional()
          .describe("ISO date (YYYY-MM-DD) to associate this note with"),
      }),
      execute: async ({ content, activity_id, note_date }: { content: string; activity_id?: number; note_date?: string }) => {
        const { data, error } = await supabaseAdmin
          .from("activity_notes")
          .insert({
            user_id: userId,
            content,
            activity_id: activity_id ?? null,
            note_date: note_date ?? null,
          })
          .select()
          .single();
        if (error) return { error: error.message };
        return { success: true, note: data };
      },
    }),

    render_chart: tool({
      description:
        "Returns a chart payload for the frontend to render inline. Use when trends or comparisons are better expressed visually. Chart type guide: line=single metric trend over time; area=cumulative buildup or ramp (CTL, mileage); bar=weekly/monthly aggregates; scatter=correlation between two metrics; pie=distribution/proportion breakdown. Use y_keys (array) instead of y_key when comparing 2–3 related metrics on the same time axis (e.g. CTL+ATL+TSB). Always follow render_chart with a written analysis — never let a chart be your final action.",
      inputSchema: z.object({
        type: z.enum(["line", "bar", "scatter", "area", "pie"]).describe("Chart type"),
        title: z.string().describe("Chart title"),
        subtitle: z.string().optional().describe("Optional subtitle"),
        data: z
          .array(z.record(z.string(), z.union([z.string(), z.number()])))
          .describe("Array of data point objects"),
        x_key: z.string().describe("Key in data objects to use for x-axis"),
        y_key: z.string().describe("Key in data objects to use for y-axis (single series)"),
        y_keys: z
          .array(z.string())
          .optional()
          .describe("Keys for multiple series (overrides y_key); max 3 series"),
        x_label: z.string().optional().describe("X-axis label"),
        y_label: z.string().optional().describe("Y-axis label"),
      }),
      execute: async (params) => {
        return params as ChartPayload;
      },
    }),

    render_workout: tool({
      description:
        "Emits a structured workout payload for the frontend to render as a Zwift-style bar chart. Use when prescribing an endurance workout (run, ride, swim). Each segment needs a zone (1–7), duration in minutes, and optionally an intensity percentage and label. Always follow render_workout with a written explanation of the workout — never let it be your final action. Do NOT use for strength training.",
      inputSchema: z.object({
        title: z.string().describe("Workout name, e.g. 'Threshold Intervals'"),
        sport: z.enum(["run", "ride", "swim", "other"]),
        total_duration_min: z.number().describe("Total workout duration in minutes"),
        description: z.string().optional().describe("Optional one-line summary"),
        segments: z.array(z.object({
          duration_min: z.number().describe("Segment duration in minutes"),
          zone: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7)]).describe("Training zone (1=Recovery, 2=Endurance, 3=Tempo, 4=Threshold, 5=VO2max, 6=Anaerobic, 7=Neuromuscular)"),
          intensity_pct: z.number().optional().describe("Intensity as % of FTP or HRmax (0–150). Omit to use zone midpoint."),
          label: z.string().optional().describe("Segment label, e.g. 'warm-up', '4×1km @ T-pace', 'recovery jog'"),
        })),
      }),
      execute: async (params) => params as WorkoutPayload,
    }),

    render_segment_chart: tool({
      description:
        "Fetches all efforts for a specific Strava segment and returns a visualization payload. Use when the user asks about their history or progression on a named segment. First call run_query to find the segment_id (SELECT segment_id, name FROM segment_efforts WHERE user_id = '...' AND name ILIKE '%segment name%' LIMIT 1). Always follow render_segment_chart with written commentary on the trend.",
      inputSchema: z.object({
        segment_id: z.number().describe("Strava segment ID"),
        segment_name: z.string().optional().describe("Segment name for display (pass the name from your run_query result)"),
        distance_m: z.number().optional().describe("Segment distance in meters (pass if known from run_query)"),
      }),
      execute: async ({ segment_id, segment_name, distance_m }: { segment_id: number; segment_name?: string; distance_m?: number }) => {
        const { data, error } = await supabaseAdmin
          .from("segment_efforts")
          .select("start_date, elapsed_time, pr_rank")
          .eq("user_id", userId)
          .eq("segment_id", segment_id)
          .order("start_date", { ascending: true });

        if (error) return { error: error.message };
        if (!data?.length) return { error: "No efforts found for this segment." };

        const bestTime = Math.min(...data.map((r) => r.elapsed_time));
        const bestRow = data.find((r) => r.elapsed_time === bestTime)!;

        const efforts: SegmentEffort[] = data.map((r) => ({
          date: r.start_date.split("T")[0],
          time_sec: r.elapsed_time,
          is_best: r.elapsed_time === bestTime,
          pr_rank: r.pr_rank ?? undefined,
        }));

        return {
          name: segment_name ?? `Segment ${segment_id}`,
          distance_m: distance_m ?? 0,
          efforts,
          best_time_sec: bestTime,
          best_date: bestRow.start_date.split("T")[0],
          effort_count: data.length,
        } satisfies SegmentPayload;
      },
    }),

    get_training_load: tool({
      description:
        "Computes Chronic Training Load (CTL = fitness), Acute Training Load (ATL = fatigue), Training Stress Balance (TSB = form), and Acute:Chronic Workload Ratio (ACWR = injury risk). Uses activity duration in minutes as the load proxy. Returns current values plus a time series suitable for charting with render_chart.",
      inputSchema: z.object({
        days: z
          .number()
          .optional()
          .describe("Number of trailing days to include in the series (default 90, max 365)"),
      }),
      execute: async ({ days = 90 }: { days?: number }) => {
        const returnDays = Math.min(Math.max(days, 1), 365);
        const cacheKey = `${userId}:${returnDays}`;
        const hit = trainingLoadCache.get(cacheKey);
        if (hit && Date.now() - hit.ts < TRAINING_LOAD_CACHE_TTL) return hit.result;

        // Fetch a long window so the EMA is well-seeded before the return period starts.
        // CTL time constant is 42 days — we want at least 180 days of warm-up.
        const seedDays = Math.max(returnDays + 180, 365);
        const since = new Date(Date.now() - seedDays * 24 * 60 * 60 * 1000).toISOString();

        const { data, error } = await supabaseAdmin
          .from("activities")
          .select("start_date, moving_time_seconds")
          .eq("user_id", userId)
          .gte("start_date", since)
          .order("start_date", { ascending: true });

        if (error) return { error: error.message };
        const result = computeTrainingLoad(data ?? [], returnDays);
        trainingLoadCache.set(cacheKey, { result, ts: Date.now() });
        return result;
      },
    }),

    ask_user: tool({
      description:
        "Asks the user a clarifying question mid-reasoning. Only use when the question is genuinely ambiguous and the answer would materially change your analysis.",
      inputSchema: z.object({
        question: z
          .string()
          .describe("The clarifying question to ask the user"),
      }),
      execute: async ({ question }: { question: string }) => {
        return { question, awaiting_response: true };
      },
    }),
  };
}

/** Returns the comment-stripped SQL if safe, or null if not permitted. */
function stripAndValidateQuery(sql: string): string | null {
  const stripped = sql.replace(/^(\s*--[^\n]*\n)+/g, "").trim();
  const normalized = stripped.toUpperCase();
  if (!normalized.startsWith("SELECT") && !normalized.startsWith("WITH")) {
    return null;
  }
  const forbidden = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE", "GRANT", "REVOKE"];
  if (forbidden.some((kw) => new RegExp(`\\b${kw}\\b`).test(normalized))) {
    return null;
  }
  return stripped.replace(/;+$/, "");
}

