import { getAuthUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/client";
import type { UserProfile } from "@/lib/agent/system-prompt";

const ALLOWED_SPORTS = ["running", "cycling", "triathlon", "other"] as const;
const ALLOWED_EXPERIENCE = ["beginner", "intermediate", "advanced"] as const;
const ALLOWED_GOAL_TYPES = ["race_prep", "fitness", "performance", "other"] as const;
const ALLOWED_UNITS = ["metric", "imperial"] as const;

// Infer primary_sport and max_heart_rate from Strava activity data
async function inferFromStrava(userId: string): Promise<Partial<UserProfile>> {
  const inferred: Partial<UserProfile> = {};

  // Primary sport: most frequent sport_type
  const { data: sportData } = await supabaseAdmin
    .from("activities")
    .select("sport_type")
    .eq("user_id", userId)
    .not("sport_type", "is", null);

  if (sportData && sportData.length > 0) {
    const counts: Record<string, number> = {};
    for (const row of sportData) {
      const t = (row.sport_type as string).toLowerCase();
      const bucket =
        t.includes("run") ? "running" :
        t.includes("ride") || t.includes("cycling") ? "cycling" :
        t.includes("swim") || t.includes("triathlon") ? "triathlon" :
        null;
      if (bucket) counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top) inferred.primary_sport = top[0] as UserProfile["primary_sport"];
  }

  // Max HR: highest recorded across all activities
  const { data: hrData } = await supabaseAdmin
    .from("activities")
    .select("max_heartrate")
    .eq("user_id", userId)
    .not("max_heartrate", "is", null)
    .order("max_heartrate", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (hrData?.max_heartrate) {
    inferred.max_heart_rate = hrData.max_heartrate as number;
  }

  return inferred;
}

export async function GET() {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  // Bootstrap: if row doesn't exist or inferred fields are missing, populate from Strava
  const needsInference = !profile || (!profile.primary_sport && !profile.max_heart_rate);
  if (needsInference) {
    const inferred = await inferFromStrava(user.id);
    if (Object.keys(inferred).length > 0) {
      const { data: upserted } = await supabaseAdmin
        .from("user_profiles")
        .upsert(
          { user_id: user.id, ...inferred, updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        )
        .select()
        .maybeSingle();
      profile = upserted ?? profile;
    }
  }

  return Response.json({ profile: profile ?? null });
}

export async function PATCH(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as Partial<UserProfile>;

  // Validate & sanitize
  const patch: Partial<UserProfile> = {};

  if (body.date_of_birth !== undefined) {
    patch.date_of_birth = body.date_of_birth || null;
  }
  if (body.weight_kg !== undefined) {
    const w = Number(body.weight_kg);
    patch.weight_kg = body.weight_kg === null ? null : (!isNaN(w) && w > 0 && w < 1000 ? w : undefined);
  }
  if (body.height_cm !== undefined) {
    const h = Number(body.height_cm);
    patch.height_cm = body.height_cm === null ? null : (!isNaN(h) && h > 0 && h < 1000 ? h : undefined);
  }
  if (body.preferred_units !== undefined && ALLOWED_UNITS.includes(body.preferred_units as typeof ALLOWED_UNITS[number])) {
    patch.preferred_units = body.preferred_units;
  }
  if (body.primary_sport !== undefined) {
    patch.primary_sport = body.primary_sport === null ? null :
      ALLOWED_SPORTS.includes(body.primary_sport as typeof ALLOWED_SPORTS[number]) ? body.primary_sport : undefined;
  }
  if (body.experience_level !== undefined) {
    patch.experience_level = body.experience_level === null ? null :
      ALLOWED_EXPERIENCE.includes(body.experience_level as typeof ALLOWED_EXPERIENCE[number]) ? body.experience_level : undefined;
  }
  if (body.max_heart_rate !== undefined) {
    const hr = Number(body.max_heart_rate);
    patch.max_heart_rate = body.max_heart_rate === null ? null : (!isNaN(hr) && hr > 0 && hr < 300 ? hr : undefined);
  }
  if (body.goal_type !== undefined) {
    patch.goal_type = body.goal_type === null ? null :
      ALLOWED_GOAL_TYPES.includes(body.goal_type as typeof ALLOWED_GOAL_TYPES[number]) ? body.goal_type : undefined;
  }
  if (body.goal_event_name !== undefined) patch.goal_event_name = body.goal_event_name || null;
  if (body.goal_event_distance !== undefined) patch.goal_event_distance = body.goal_event_distance || null;
  if (body.goal_event_date !== undefined) patch.goal_event_date = body.goal_event_date || null;
  if (body.current_injuries !== undefined) {
    patch.current_injuries = body.current_injuries ? body.current_injuries.slice(0, 500) : null;
  }

  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .upsert(
      { user_id: user.id, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    )
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ profile: data });
}
