/**
 * Per-user Strava Phase 2 sync — detailed activity enrichment.
 * Backfills calories, max_watts, description for all summary activities.
 * Rate-limit aware: backs off at 85% of 100 req/15-min and stops at 85% of 1000 req/day.
 * Safe to interrupt and re-trigger — only processes sync_status='summary' rows.
 */
import { supabaseAdmin } from "@/lib/supabase/client";
import { refreshStravaToken } from "./strava-sync";

const RATE_LIMIT_15MIN = 100;
const RATE_LIMIT_DAILY = 1000;
const BACKOFF_THRESHOLD = 0.85;

interface StravaSegmentEffort {
  id: number;
  segment: { id: number };
  name: string;
  elapsed_time: number;
  moving_time: number;
  start_date: string;
  distance: number;
  average_watts?: number | null;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  average_cadence?: number | null;
  pr_rank?: number | null;
  kom_rank?: number | null;
  achievements?: unknown[];
}

interface StravaLap {
  id: number;
  name: string;
  elapsed_time: number;
  moving_time: number;
  start_date: string;
  distance: number;
  start_index?: number;
  end_index?: number;
  total_elevation_gain?: number;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  average_cadence?: number | null;
  average_watts?: number | null;
  device_watts?: boolean | null;
}

interface StravaSplitMetric {
  split: number;
  distance: number;
  elapsed_time: number;
  moving_time: number;
  average_speed?: number;
  average_heartrate?: number | null;
  pace_zone?: number | null;
}

function parseRateLimitUsage(header: string | null): { used: number; limit: number } {
  if (!header) return { used: 0, limit: RATE_LIMIT_15MIN };
  const [used, limit] = header.split(",").map(Number);
  return { used, limit };
}

async function fetchDetailedActivity(token: string, activityId: number) {
  const res = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 429) return { error: "rate_limited" as const, rateLimitUsage: null, segmentEfforts: [], laps: [], splits: [] };
  if (!res.ok) return { error: `${res.status}` as const, rateLimitUsage: null, segmentEfforts: [], laps: [], splits: [] };

  const data = await res.json();
  return {
    error: null,
    fields: {
      calories: data.calories ?? null,
      max_watts: data.max_watts ?? null,
      description: data.description ?? null,
    },
    segmentEfforts: (data.segment_efforts ?? []) as StravaSegmentEffort[],
    laps: (data.laps ?? []) as StravaLap[],
    splits: (data.splits_metric ?? []) as StravaSplitMetric[],
    rateLimitUsage: res.headers.get("X-RateLimit-Usage"),
  };
}

export interface Phase2BatchResult {
  processed: number;
  remaining: number;
  completed: boolean;
  jobId: string;
}

/**
 * Process a single batch of Phase 2 enrichment for a user.
 * Finds or creates a running job row, processes up to `batchSize` activities,
 * and returns. Designed to be called repeatedly by a cron job every 15 minutes.
 * Does not sleep internally — the cron schedule handles timing.
 */
export async function syncStravaActivitiesPhase2Batch(
  userId: string,
  batchSize = 80
): Promise<Phase2BatchResult> {
  // Find existing running or rate_limited job, or create a new one
  let { data: job } = await supabaseAdmin
    .from("strava_sync_jobs")
    .select("id, synced, total")
    .eq("user_id", userId)
    .eq("phase", 2)
    .in("status", ["running", "rate_limited"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!job) {
    const { data: newJob, error: jobError } = await supabaseAdmin
      .from("strava_sync_jobs")
      .insert({ user_id: userId, phase: 2, status: "running" })
      .select()
      .single();
    if (jobError || !newJob) throw new Error(`Failed to create job: ${jobError?.message}`);
    job = newJob;
  } else {
    // Reset rate_limited back to running at the start of a new batch
    await supabaseAdmin
      .from("strava_sync_jobs")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", job.id);
  }

  const updateJob = (fields: Record<string, unknown>) =>
    supabaseAdmin
      .from("strava_sync_jobs")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", job!.id);

  // Fetch batch of summary activities + count already detailed
  const [{ data: summaryActivities, error }, { count: detailedCount }] = await Promise.all([
    supabaseAdmin
      .from("activities")
      .select("id")
      .eq("user_id", userId)
      .eq("sync_status", "summary")
      .order("start_date", { ascending: false })
      .limit(batchSize),
    supabaseAdmin
      .from("activities")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("sync_status", "detailed"),
  ]);

  if (error) throw new Error(`Failed to fetch summary activities: ${error.message}`);

  // Nothing left to enrich
  if (!summaryActivities || summaryActivities.length === 0) {
    const total = detailedCount ?? 0;
    await updateJob({ status: "completed", total, synced: total });
    return { processed: 0, remaining: 0, completed: true, jobId: job!.id };
  }

  const alreadySynced = detailedCount ?? 0;
  await updateJob({ synced: alreadySynced });

  let accessToken = await refreshStravaToken(userId);
  let processed = 0;

  for (const { id: activityId } of summaryActivities) {
    const result = await fetchDetailedActivity(accessToken, activityId as number);

    if (result.error === "rate_limited") {
      console.log(`[cron-p2] user ${userId}: rate limited mid-batch, marking job`);
      await updateJob({ status: "rate_limited" });
      break;
    }
    if (result.error) {
      console.warn(`[cron-p2] user ${userId}: activity ${activityId} error ${result.error}`);
      continue;
    }

    // Stop early if approaching 15-min rate limit — next cron tick handles more
    let ratioUsed = 0;
    if (result.rateLimitUsage) {
      const { used, limit } = parseRateLimitUsage(result.rateLimitUsage);
      ratioUsed = limit > 0 ? used / limit : 0;
      if (ratioUsed >= BACKOFF_THRESHOLD) {
        console.log(`[cron-p2] user ${userId}: rate limit ${used}/${limit}, stopping batch early`);
        await updateJob({ status: "rate_limited" });
        break;
      }
    }

    await supabaseAdmin
      .from("activities")
      .update({ ...result.fields, sync_status: "detailed", synced_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("id", activityId);

    if (result.segmentEfforts.length > 0) {
      const rows = result.segmentEfforts.map((se) => ({
        id: se.id,
        user_id: userId,
        activity_id: activityId as number,
        segment_id: se.segment.id,
        name: se.name,
        elapsed_time: se.elapsed_time,
        moving_time: se.moving_time,
        start_date: se.start_date,
        distance: se.distance,
        average_watts: se.average_watts ?? null,
        average_heartrate: se.average_heartrate ?? null,
        max_heartrate: se.max_heartrate ?? null,
        average_cadence: se.average_cadence ?? null,
        pr_rank: se.pr_rank ?? null,
        kom_rank: se.kom_rank ?? null,
        achievements: se.achievements ? JSON.stringify(se.achievements) : null,
      }));
      const { error: seError } = await supabaseAdmin
        .from("segment_efforts")
        .upsert(rows, { onConflict: "user_id,id" });
      if (seError) console.warn(`[cron-p2] segment efforts error for activity ${activityId}:`, seError.message);
    }

    if (result.laps.length > 0) {
      const lapRows = result.laps.map((l) => ({
        id: l.id,
        user_id: userId,
        activity_id: activityId as number,
        name: l.name,
        elapsed_time: l.elapsed_time,
        moving_time: l.moving_time,
        start_date: l.start_date,
        distance: l.distance,
        start_index: l.start_index ?? null,
        end_index: l.end_index ?? null,
        total_elevation_gain: l.total_elevation_gain ?? null,
        average_speed: l.average_speed ?? null,
        max_speed: l.max_speed ?? null,
        average_heartrate: l.average_heartrate ?? null,
        max_heartrate: l.max_heartrate ?? null,
        average_cadence: l.average_cadence ?? null,
        average_watts: l.average_watts ?? null,
        device_watts: l.device_watts ?? null,
      }));
      const { error: lapError } = await supabaseAdmin
        .from("activity_laps")
        .upsert(lapRows, { onConflict: "user_id,id" });
      if (lapError) console.warn(`[cron-p2] laps error for activity ${activityId}:`, lapError.message);
    }

    if (result.splits.length > 0) {
      const splitRows = result.splits.map((s) => ({
        user_id: userId,
        activity_id: activityId as number,
        split: s.split,
        distance: s.distance,
        elapsed_time: s.elapsed_time,
        moving_time: s.moving_time,
        average_speed: s.average_speed ?? null,
        average_heartrate: s.average_heartrate ?? null,
        pace_zone: s.pace_zone ?? null,
      }));
      const { error: splitError } = await supabaseAdmin
        .from("activity_splits")
        .upsert(splitRows, { onConflict: "user_id,activity_id,split" });
      if (splitError) console.warn(`[cron-p2] splits error for activity ${activityId}:`, splitError.message);
    }

    processed++;
    if (processed % 10 === 0) {
      await updateJob({ synced: alreadySynced + processed });
    }

    // Adaptive sleep: skip delay when under 50% rate-limit usage, slow down above 70%
    const sleepMs = ratioUsed < 0.5 ? 0 : ratioUsed < 0.7 ? 100 : 300;
    if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
  }

  // Recount remaining after batch
  const { count: remainingCount } = await supabaseAdmin
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("sync_status", "summary");

  const remaining = remainingCount ?? 0;
  const newSynced = alreadySynced + processed;
  const completed = remaining === 0;

  await updateJob({ synced: newSynced, ...(completed ? { status: "completed" } : {}) });
  console.log(`[cron-p2] user ${userId}: batch done — processed=${processed}, remaining=${remaining}`);

  return { processed, remaining, completed, jobId: job!.id };
}

export async function syncStravaActivitiesPhase2(userId: string): Promise<void> {
  // Create a sync job row for progress tracking
  const { data: job, error: jobError } = await supabaseAdmin
    .from("strava_sync_jobs")
    .insert({ user_id: userId, phase: 2, status: "running" })
    .select()
    .single();

  if (jobError || !job) {
    console.error(`[sync-p2] failed to create job for user ${userId}:`, jobError);
    return;
  }

  const updateJob = (fields: Record<string, unknown>) =>
    supabaseAdmin
      .from("strava_sync_jobs")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", job.id);

  try {
    // Fetch all summary (not yet enriched) activities for this user
    const [{ data: summaryActivities, error }, { count: alreadyDone }] = await Promise.all([
      supabaseAdmin
        .from("activities")
        .select("id")
        .eq("user_id", userId)
        .eq("sync_status", "summary")
        .order("start_date", { ascending: false }),
      supabaseAdmin
        .from("activities")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("sync_status", "detailed"),
    ]);

    if (error) throw new Error(`Failed to fetch summary activities: ${error.message}`);
    if (!summaryActivities || summaryActivities.length === 0) {
      await updateJob({ status: "completed", total: alreadyDone ?? 0, synced: alreadyDone ?? 0 });
      return;
    }

    // Use cumulative totals so the progress bar continues from where it left off
    const alreadySynced = alreadyDone ?? 0;
    const total = alreadySynced + summaryActivities.length;
    await updateJob({ total, synced: alreadySynced });

    let synced = alreadySynced;
    let dailyUsed = 0;
    // Refresh token once at the start; will re-refresh if it expires mid-run
    let accessToken = await refreshStravaToken(userId);

    for (const { id: activityId } of summaryActivities) {
      if (dailyUsed >= RATE_LIMIT_DAILY * BACKOFF_THRESHOLD) {
        console.log(`[sync-p2] user ${userId}: approaching daily limit, stopping. Re-trigger tomorrow.`);
        break;
      }

      const result = await fetchDetailedActivity(accessToken, activityId as number);

      if (result.error === "rate_limited") {
        console.log(`[sync-p2] user ${userId}: 15-min rate limit hit, sleeping 15m...`);
        await new Promise((r) => setTimeout(r, 15 * 60 * 1000));
        // Refresh token after long sleep
        accessToken = await refreshStravaToken(userId);
        continue;
      }

      if (result.error) {
        console.warn(`[sync-p2] user ${userId}: activity ${activityId} error ${result.error}`);
        continue;
      }

      // Check 15-min rate limit usage and back off if approaching threshold
      let legacyRatioUsed = 0;
      if (result.rateLimitUsage) {
        const { used, limit } = parseRateLimitUsage(result.rateLimitUsage);
        dailyUsed++;
        legacyRatioUsed = limit > 0 ? used / limit : 0;
        if (legacyRatioUsed >= BACKOFF_THRESHOLD) {
          console.log(`[sync-p2] user ${userId}: rate limit ${used}/${limit}, sleeping 60s...`);
          await new Promise((r) => setTimeout(r, 60 * 1000));
        }
      }

      await supabaseAdmin
        .from("activities")
        .update({
          ...result.fields,
          sync_status: "detailed",
          synced_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("id", activityId);

      if (result.segmentEfforts.length > 0) {
        const rows = result.segmentEfforts.map((se) => ({
          id: se.id,
          user_id: userId,
          activity_id: activityId as number,
          segment_id: se.segment.id,
          name: se.name,
          elapsed_time: se.elapsed_time,
          moving_time: se.moving_time,
          start_date: se.start_date,
          distance: se.distance,
          average_watts: se.average_watts ?? null,
          average_heartrate: se.average_heartrate ?? null,
          max_heartrate: se.max_heartrate ?? null,
          average_cadence: se.average_cadence ?? null,
          pr_rank: se.pr_rank ?? null,
          kom_rank: se.kom_rank ?? null,
          achievements: se.achievements ? JSON.stringify(se.achievements) : null,
        }));
        const { error: seError } = await supabaseAdmin
          .from("segment_efforts")
          .upsert(rows, { onConflict: "user_id,id" });
        if (seError) console.warn(`[sync-p2] segment efforts error for activity ${activityId}:`, seError.message);
      }

      if (result.laps.length > 0) {
        const lapRows = result.laps.map((l) => ({
          id: l.id,
          user_id: userId,
          activity_id: activityId as number,
          name: l.name,
          elapsed_time: l.elapsed_time,
          moving_time: l.moving_time,
          start_date: l.start_date,
          distance: l.distance,
          start_index: l.start_index ?? null,
          end_index: l.end_index ?? null,
          total_elevation_gain: l.total_elevation_gain ?? null,
          average_speed: l.average_speed ?? null,
          max_speed: l.max_speed ?? null,
          average_heartrate: l.average_heartrate ?? null,
          max_heartrate: l.max_heartrate ?? null,
          average_cadence: l.average_cadence ?? null,
          average_watts: l.average_watts ?? null,
          device_watts: l.device_watts ?? null,
        }));
        const { error: lapError } = await supabaseAdmin
          .from("activity_laps")
          .upsert(lapRows, { onConflict: "user_id,id" });
        if (lapError) console.warn(`[sync-p2] laps error for activity ${activityId}:`, lapError.message);
      }

      if (result.splits.length > 0) {
        const splitRows = result.splits.map((s) => ({
          user_id: userId,
          activity_id: activityId as number,
          split: s.split,
          distance: s.distance,
          elapsed_time: s.elapsed_time,
          moving_time: s.moving_time,
          average_speed: s.average_speed ?? null,
          average_heartrate: s.average_heartrate ?? null,
          pace_zone: s.pace_zone ?? null,
        }));
        const { error: splitError } = await supabaseAdmin
          .from("activity_splits")
          .upsert(splitRows, { onConflict: "user_id,activity_id,split" });
        if (splitError) console.warn(`[sync-p2] splits error for activity ${activityId}:`, splitError.message);
      }

      synced++;

      // Update progress every 10 activities
      if (synced % 10 === 0) {
        await updateJob({ synced });
      }

      const legacySleepMs = legacyRatioUsed < 0.5 ? 0 : legacyRatioUsed < 0.7 ? 100 : 300;
      if (legacySleepMs > 0) await new Promise((r) => setTimeout(r, legacySleepMs));
    }

    await updateJob({ status: "completed", synced, total });
    console.log(`[sync-p2] user ${userId}: done — ${synced}/${total} enriched`);
  } catch (err) {
    console.error(`[sync-p2] user ${userId} failed:`, err);
    await updateJob({ status: "failed", error: String(err) });
  }
}
