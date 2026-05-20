/**
 * Strava Webhook Edge Function (multi-user)
 * Handles new activity events from Strava's Webhook Events API.
 * Routes each event to the correct user via strava_connections.athlete_id.
 *
 * Deploy: supabase functions deploy strava-webhook
 * Set secrets: supabase secrets set STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... etc.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const VERIFY_TOKEN = Deno.env.get("STRAVA_WEBHOOK_VERIFY_TOKEN") ?? "strava-agent-verify";

Deno.serve(async (req) => {
  // Webhook verification (GET)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
      return Response.json({ "hub.challenge": challenge });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // Webhook event (POST)
  if (req.method === "POST") {
    const event = await req.json();

    if (event.object_type !== "activity" || !["create", "update"].includes(event.aspect_type)) {
      return Response.json({ ok: true });
    }

    const activityId = event.object_id as number;
    const athleteId = event.owner_id as number;

    try {
      // Look up which user owns this athlete_id
      const { data: conn, error: connError } = await supabase
        .from("strava_connections")
        .select("user_id, access_token, refresh_token, token_expires_at")
        .eq("athlete_id", athleteId)
        .single();

      if (connError || !conn || !conn.user_id) {
        console.error(`No user found for athlete_id ${athleteId}`);
        return Response.json({ ok: true }); // Not our user — ignore
      }

      const accessToken = await getValidToken(conn);
      const activity = await fetchDetailedActivity(accessToken, activityId);
      await upsertActivity(conn.user_id, activity);
      await recomputePersonalRecords(conn.user_id);
    } catch (err) {
      console.error("Webhook processing error:", err);
      return Response.json({ error: String(err) }, { status: 500 });
    }

    return Response.json({ ok: true });
  }

  return new Response("Method Not Allowed", { status: 405 });
});

async function getValidToken(conn: {
  user_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
}): Promise<string> {
  // Return existing token if still valid (5 min buffer)
  if (new Date(conn.token_expires_at).getTime() > Date.now() + 5 * 60 * 1000) {
    return conn.access_token;
  }

  // Refresh
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: Deno.env.get("STRAVA_CLIENT_ID"),
      client_secret: Deno.env.get("STRAVA_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token,
    }),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const tokens = await res.json();

  await supabase.from("strava_connections").update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expires_at: new Date(tokens.expires_at * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("user_id", conn.user_id);

  return tokens.access_token;
}

async function fetchDetailedActivity(token: string, id: number) {
  const res = await fetch(`https://www.strava.com/api/v3/activities/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Strava API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function upsertActivity(userId: string, a: Record<string, unknown>) {
  const row = {
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
    max_watts: a.max_watts ?? null,
    kilojoules: a.kilojoules ?? null,
    device_watts: a.device_watts ?? null,
    calories: a.calories ?? null,
    gear_id: a.gear_id ?? null,
    description: a.description ?? null,
    sync_status: "detailed",
    synced_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("activities").upsert(row);
  if (error) throw new Error(`Upsert failed: ${error.message}`);
}

async function recomputePersonalRecords(userId: string) {
  const records: Array<{ metric: string; column: string; type?: string; minDistance?: number; requireNotNull?: string }> = [
    { metric: "longest_run",           column: "distance_meters",    type: "Run" },
    { metric: "longest_ride",          column: "distance_meters",    type: "Ride" },
    { metric: "fastest_run_pace",      column: "average_speed_mps",  type: "Run", minDistance: 1000 },
    { metric: "highest_elevation_run", column: "elevation_gain_meters", type: "Run" },
  ];

  for (const rec of records) {
    let query = supabase
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

    await supabase.from("personal_records").upsert({
      user_id: userId,
      metric: rec.metric,
      activity_id: (data as Record<string, unknown>).id,
      value: (data as Record<string, unknown>)[rec.column],
      achieved_at: (data as Record<string, unknown>).start_date,
      updated_at: new Date().toISOString(),
    });
  }
}
