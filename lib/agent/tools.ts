import { tool } from "ai";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/client";
import { computeTrainingLoad, type TrainingLoadResult } from "@/lib/agent/training-load";
import type { ChartPayload } from "@/types";

const trainingLoadCache = new Map<string, { result: TrainingLoadResult; ts: number }>();
const TRAINING_LOAD_CACHE_TTL = 5 * 60 * 1000;

/**
 * Factory that creates agent tools scoped to a specific user.
 * All DB queries are filtered by userId.
 */
export function createAgentTools(userId: string) {
  return {
    get_schema: tool({
      description:
        "Returns the database schema including all tables and column definitions. Always call this first to orient yourself.",
      inputSchema: z.object({}),
      execute: async () => {
        return {
          tables: {
            activities: {
              description: "Training activities from connected data sources (scoped to current user)",
              columns: {
                id: "bigint — Strava activity ID",
                user_id: "uuid — owner (always filter by this)",
                name: "text — Activity name",
                type: "text — Run, Ride, Swim, etc.",
                workout_type:
                  "int nullable — 0=default run, 1=race, 2=long run, 3=workout; 10=default ride, 11=race ride, 12=workout ride",
                start_date: "timestamptz",
                distance_meters: "float",
                moving_time_seconds: "int",
                elapsed_time_seconds: "int",
                elevation_gain_meters: "float",
                average_heartrate: "float nullable",
                max_heartrate: "float nullable",
                average_speed_mps: "float — convert to min/km: 1000/(speed*60)",
                max_speed_mps: "float",
                suffer_score: "int nullable",
                perceived_exertion: "int nullable — 1-10",
                average_watts: "float nullable",
                weighted_average_watts: "int nullable — normalised power",
                max_watts: "int nullable",
                kilojoules: "float nullable",
                device_watts: "boolean nullable — true=power meter",
                calories: "float nullable — DetailedActivity only",
                gear_id: "text nullable",
                description: "text nullable — DetailedActivity only",
                sync_status: "text — summary or detailed",
                synced_at: "timestamptz",
              },
            },
            activity_notes: {
              description: "User-provided subjective context, persists across sessions",
              columns: {
                id: "uuid",
                user_id: "uuid — owner",
                activity_id: "bigint nullable — FK to activities",
                note_date: "date nullable",
                content: "text",
                created_at: "timestamptz",
              },
            },
            personal_records: {
              description: "Pre-computed personal records, updated on each sync",
              columns: {
                user_id: "uuid — owner",
                metric: "text — e.g. fastest_run_pace, longest_ride",
                activity_id: "bigint — FK to activities",
                value: "float",
                achieved_at: "timestamptz",
                updated_at: "timestamptz",
              },
            },
            segment_efforts: {
              description:
                "One row per segment effort per activity. Use segment_id to group all efforts on the same " +
                "Strava segment across activities. Useful for: progression over time, PRs, most-ridden segments.",
              columns: {
                id: "bigint — Strava segment effort ID",
                user_id: "uuid — always filter by this",
                activity_id: "bigint — FK to activities.id",
                segment_id: "bigint — Strava segment ID; group by this to see all efforts on one segment",
                name: "text — segment name (consistent per segment_id, denormalised for display)",
                elapsed_time: "int — seconds on segment (wall clock)",
                moving_time: "int — seconds moving on segment",
                start_date: "timestamptz — when this effort started",
                distance: "float — meters",
                average_watts: "float nullable",
                average_heartrate: "float nullable",
                max_heartrate: "float nullable",
                average_cadence: "float nullable",
                pr_rank: "int nullable — 1/2/3 if top-3 personal best at time of activity",
                kom_rank: "int nullable — rank if top-10 KOM at time of activity",
                achievements: "jsonb nullable — [{type_id, type, rank}]; use achievements @> '[{\"type\":\"pr\"}]' to filter PRs",
              },
            },
          },
        };
      },
    }),


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

    get_training_load: tool({
      description:
        "Computes Chronic Training Load (CTL = fitness), Acute Training Load (ATL = fatigue), Training Stress Balance (TSB = form), and Acute:Chronic Workload Ratio (ACWR = injury risk). Uses suffer_score as the load proxy; falls back to activity duration in minutes for activities without HR data. Returns current values plus a time series suitable for charting with render_chart.",
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
          .select("start_date, suffer_score, moving_time_seconds")
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

