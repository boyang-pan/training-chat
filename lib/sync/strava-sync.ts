/**
 * Per-user Strava sync library.
 * Called after OAuth to populate a user's activities and personal records.
 */
import { supabaseAdmin } from "@/lib/supabase/client";
import { syncStravaActivitiesPhase2 } from "./strava-sync-phase2";

// ---- Types ----

interface StravaActivitySummary {
  id: number;
  name: string;
  type: string;
  workout_type?: number;
  start_date: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed: number;
  max_speed: number;
  perceived_exertion?: number;
  average_watts?: number;
  weighted_average_watts?: number;
  kilojoules?: number;
  device_watts?: boolean;
  gear_id?: string;
}

// ---- Helpers ----

async function fetchActivitiesPage(
  token: string,
  page: number,
  perPage = 200,
  after?: number
): Promise<StravaActivitySummary[]> {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
    ...(after !== undefined ? { after: String(after) } : {}),
  });
  const url = `https://www.strava.com/api/v3/athlete/activities?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Strava API error: ${res.status} ${res.statusText}`);
  return res.json();
}

function mapActivity(userId: string, a: StravaActivitySummary) {
  return {
    id: a.id,
    user_id: userId,
    name: a.name,
    type: a.type,
    workout_type: a.workout_type ?? null,
    start_date: a.start_date,
    distance_meters: a.distance,
    moving_time_seconds: a.moving_time,
    elapsed_time_seconds: a.elapsed_time,
    elevation_gain_meters: a.total_elevation_gain,
    average_heartrate: a.average_heartrate ?? null,
    max_heartrate: a.max_heartrate ?? null,
    average_speed_mps: a.average_speed,
    max_speed_mps: a.max_speed,
    perceived_exertion: a.perceived_exertion ?? null,
    average_watts: a.average_watts ?? null,
    weighted_average_watts: a.weighted_average_watts ?? null,
    kilojoules: a.kilojoules ?? null,
    device_watts: a.device_watts ?? null,
    gear_id: a.gear_id ?? null,
    sync_status: "summary" as const,
    synced_at: new Date().toISOString(),
  };
}

async function computePersonalRecords(userId: string) {
  const records: Array<{ metric: string; column: string; type?: string; minDistance?: number; requireNotNull?: string }> = [
    { metric: "longest_run",          column: "distance_meters",   type: "Run" },
    { metric: "longest_ride",         column: "distance_meters",   type: "Ride" },
    { metric: "fastest_run_pace",     column: "average_speed_mps", type: "Run",  minDistance: 1000 },
    { metric: "highest_elevation_run",column: "elevation_gain_meters", type: "Run" },
  ];

  for (const rec of records) {
    let query = supabaseAdmin
      .from("activities")
      .select(`id, ${rec.column}, start_date`)
      .eq("user_id", userId)
      .order(rec.column, { ascending: false })
      .limit(1);

    if (rec.type) query = query.eq("type", rec.type);
    if (rec.minDistance) query = query.gt("distance_meters", rec.minDistance);
    if (rec.requireNotNull) query = query.not(rec.requireNotNull, "is", null);

    const { data } = await query.single();
    if (!data) continue;

    const row = data as unknown as Record<string, unknown>;
    await supabaseAdmin.from("personal_records").upsert({
      user_id: userId,
      metric: rec.metric,
      activity_id: row.id as number,
      value: row[rec.column] as number,
      achieved_at: row.start_date as string,
      updated_at: new Date().toISOString(),
    });
  }
}

// ---- Token refresh ----

export async function refreshStravaToken(userId: string): Promise<string> {
  const { data: conn, error } = await supabaseAdmin
    .from("strava_connections")
    .select("access_token, refresh_token, token_expires_at")
    .eq("user_id", userId)
    .single();

  if (error || !conn) throw new Error("No Strava connection found for user");

  // Return existing token if still valid (with 5 min buffer)
  if (new Date(conn.token_expires_at).getTime() > Date.now() + 5 * 60 * 1000) {
    return conn.access_token;
  }

  // Refresh
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token,
    }),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);

  const tokens = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };

  await supabaseAdmin.from("strava_connections").update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expires_at: new Date(tokens.expires_at * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);

  return tokens.access_token;
}

// ---- Incremental sync (manual trigger) ----

/**
 * Fetches only activities newer than the latest one in the DB, upserts them,
 * then fires Phase 2 to enrich both the new rows and any previously
 * interrupted summary-only rows.
 *
 * Returns the number of newly imported activities.
 */
export async function syncNewActivities(userId: string): Promise<{ newActivities: number }> {
  const accessToken = await refreshStravaToken(userId);

  // Find the most recent activity start_date to use as the `after` cursor
  const { data: latest } = await supabaseAdmin
    .from("activities")
    .select("start_date")
    .eq("user_id", userId)
    .order("start_date", { ascending: false })
    .limit(1)
    .single();

  const after = latest?.start_date
    ? Math.floor(new Date(latest.start_date).getTime() / 1000)
    : undefined;

  let page = 1;
  let totalNew = 0;

  while (true) {
    const activities = await fetchActivitiesPage(accessToken, page, 200, after);
    if (activities.length === 0) break;

    const rows = activities.map((a) => mapActivity(userId, a));
    const { error } = await supabaseAdmin.from("activities").upsert(rows);
    if (error) throw new Error(`Upsert error on page ${page}: ${error.message}`);

    totalNew += activities.length;
    if (activities.length < 200) break;
    page++;
    await new Promise((r) => setTimeout(r, 500));
  }

  if (totalNew > 0) {
    await computePersonalRecords(userId);

    // Keep Phase 1 job count in sync so it matches Phase 2's total
    const { data: p1Job } = await supabaseAdmin
      .from("strava_sync_jobs")
      .select("id, synced, total")
      .eq("user_id", userId)
      .eq("phase", 1)
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    if (p1Job) {
      await supabaseAdmin
        .from("strava_sync_jobs")
        .update({
          synced: (p1Job.synced ?? 0) + totalNew,
          total: (p1Job.total ?? 0) + totalNew,
          updated_at: new Date().toISOString(),
        })
        .eq("id", p1Job.id);
    }
  }

  // Phase 2 picks up new summary rows AND any previously interrupted ones
  syncStravaActivitiesPhase2(userId).catch((err) =>
    console.error(`[sync-manual] phase2 kick failed for user ${userId}:`, err)
  );

  return { newActivities: totalNew };
}

// ---- Main sync function ----

/**
 * Sync all Strava activities for a user (Phase 1: summaries + personal records).
 * Safe to call multiple times — uses upsert.
 * Fires Phase 2 (detailed enrichment) in the background after completion.
 */
export async function syncStravaActivities(
  userId: string,
  accessToken: string
): Promise<{ synced: number }> {
  console.log(`[sync-p1] starting for user ${userId}`);

  // Create a sync job row for progress tracking
  const { data: job } = await supabaseAdmin
    .from("strava_sync_jobs")
    .insert({ user_id: userId, phase: 1, status: "running" })
    .select()
    .single();

  const updateJob = (fields: Record<string, unknown>) =>
    supabaseAdmin
      .from("strava_sync_jobs")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", job?.id ?? "");

  try {
    let page = 1;
    let totalSynced = 0;

    while (true) {
      const activities = await fetchActivitiesPage(accessToken, page);
      if (activities.length === 0) break;

      const rows = activities.map((a) => mapActivity(userId, a));
      const { error } = await supabaseAdmin.from("activities").upsert(rows);
      if (error) throw new Error(`Upsert error on page ${page}: ${error.message}`);

      totalSynced += activities.length;
      await updateJob({ synced: totalSynced });

      if (activities.length < 200) break;
      page++;

      await new Promise((r) => setTimeout(r, 500));
    }

    await computePersonalRecords(userId);
    await updateJob({ status: "completed", total: totalSynced, synced: totalSynced });

    // Fire Phase 2 in the background
    syncStravaActivitiesPhase2(userId).catch((err) =>
      console.error(`[sync-p2] background kick failed for user ${userId}:`, err)
    );

    return { synced: totalSynced };
  } catch (err) {
    await updateJob({ status: "failed", error: String(err) });
    throw err;
  }
}
