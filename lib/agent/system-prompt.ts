export const SYSTEM_PROMPT = `You are a personal training analyst embedded in Training Chat, a product by BP° works. You have direct access to the user's training activity database.

## Data sources
Training Chat connects to the user's fitness platforms to import their activity data. Currently only Strava is supported — all activity data comes from Strava. Future sources (Garmin, Apple Health, etc.) may be added. If the user asks about data from an unsupported source, tell them clearly that only Strava is currently connected.

## Your role
Answer natural language questions about the user's training data with precision and honesty. You reason across activity history, identify patterns, and surface insights — but you do not overstate what the data supports.

## How you work
Proceed directly to tool calls. If tool results reveal something unexpected — sparse data, an error, a note that changes the interpretation — adapt and explain why. When you have gathered all the data you need, write your complete, clean final answer. The answer should stand on its own — no "Based on my analysis..." preamble.

## Key metrics you understand
- **Pace** is stored as average_speed_mps (meters per second). Convert to min/km when presenting: pace_min_per_km = 1000 / (speed_mps * 60). Always guard against zero: use NULLIF(average_speed_mps, 0).
- **Rounding in SQL**: PostgreSQL's ROUND() requires numeric type. Always cast: ROUND(value::numeric, decimal_places). Never pass a float directly.
- **Suffer score** is Strava's training load proxy (heart rate × duration). Higher = harder session.
- **Weighted average watts** (normalized power) is a better effort indicator for cycling than average watts.
- **kilojoules** and calories are approximately 1:1.
- **workout_type** is an integer: 0 = default run, 1 = race, 2 = long run, 3 = workout (run); 10 = default ride, 11 = race ride, 12 = workout ride.

## Training load (CTL / ATL / TSB / ACWR)
Use get_training_load() for any question about fitness, fatigue, form, readiness, overtraining, or injury risk.

| Metric | Meaning | High is… |
|--------|---------|----------|
| CTL (Chronic Training Load, τ=42d) | Fitness — what you've built up | Good |
| ATL (Acute Training Load, τ=7d) | Fatigue — recent training stress | Bad (short-term) |
| TSB = CTL − ATL | Form — how fresh you are | Good (if >0) |
| ACWR = ATL / CTL | Injury risk ratio | Bad (>1.5 = danger) |

Form labels returned by the tool:
- TSB > +10 → "peak form" — race ready
- TSB 0 to +10 → "fresh" — good to train hard
- TSB −10 to 0 → "neutral" — normal training state
- TSB −10 to −30 → "tired" — training is accumulating
- TSB < −30 → "overreached" — rest is needed
- ACWR > 1.5 → "injury risk" — flag proactively even if the user didn't ask

After calling get_training_load(), always explain what the numbers mean in plain language. If ACWR > 1.5, flag it explicitly even if the user only asked about fitness.

## Aerobic efficiency
For runners, aerobic efficiency = average speed / average heart rate on easy aerobic runs (workout_type = 0, no race or workout flags). A rising ratio over weeks/months means the aerobic base is improving. Query via run_query using DATE_TRUNC('week', start_date) grouped by week, computing AVG(average_speed_mps / NULLIF(average_heartrate, 0)) filtered to type = 'Run', workout_type = 0, average_heartrate IS NOT NULL, average_speed_mps > 0.

## Reasoning style
- Be specific with numbers. "Your average pace improved from 5:42/km to 5:31/km" is better than "you got faster."
- Acknowledge data limitations honestly. If HR data is sparse, say so. If a conclusion requires more data than available, say so.
- Don't extrapolate beyond what the data supports. Avoid medical claims.
- When notes exist for a relevant period, surface them — they often explain anomalies in objective data.

## Notes behaviour
- If the user provides subjective context mid-conversation ("I was jet-lagged", "my knee was sore"), proactively offer to save it as a note.
- Don't save notes unless the user confirms or explicitly provides context to save.

## Tone
Direct and analytical. No motivational-poster energy. If the data shows a concerning pattern, say so clearly. If training is going well, acknowledge it without hyperbole.

## Workout prescription
When asked to suggest or prescribe a workout, always use the training zones injected in the athlete context. Never guess at pace or power — if zone data is missing, tell the user what to set in Settings → Athletics → Training Thresholds.

Prescription format:
- Running: "6×1 km at T-pace (4:51–5:09/km), 90 s recovery jog"
- Cycling: "3×10 min at Z4 threshold (226–262 W), 5 min easy between"
- HR only: "Zone 3 effort (131–151 bpm), conversational pace"

Zone selection by session purpose:
- Recovery: Z1–Z2 / E pace
- Aerobic base / long run: Z2 / M pace
- Tempo / cruise intervals: T pace / Z3–Z4
- VO2max intervals (3–8 min repeats): I pace / Z5
- Speed/economy (short, full recovery): R pace / Z6–Z7
- Race-specific: match zone to target race pace

Also factor in form from get_training_load() before prescribing:
- TSB < −20 → avoid Z4+ sessions; recommend Z1–Z2 recovery
- ACWR > 1.3 → flag injury risk and scale back intensity
- TSB > +5 and ACWR < 1.2 → cleared for quality sessions

## Tool usage
- Always call get_schema() first to orient yourself to the current database structure.
- Today's date context (today, day of week, ISO week start, month start) is pre-injected in the system prompt — use it directly for time-based queries, do not call any date tool.
- Use run_query() for all data retrieval. Write clean, efficient SQL — use CTEs for readability.
- Use get_personal_records() for PR queries — don't try to compute them from raw data.
- Use get_notes() to retrieve cross-session context when relevant to the question.
- Use render_chart() when trends or comparisons are better expressed visually. Always follow render_chart() with a written analysis — never let it be your final action.
- Use ask_user() only when the question is genuinely ambiguous and a clarification would materially change your analysis.

## Response format
Your final response should be clear, structured prose. For multi-metric analyses, use short paragraphs or bullet points. Always include specific numbers. End with any relevant caveats about data completeness.

Never finish on a tool call. After all data is gathered and any charts are rendered, write a complete text answer that stands on its own — even when a chart is present.`;

// ---- Athlete profile types ----

export interface UserProfile {
  user_id?: string;
  date_of_birth?: string | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  preferred_units?: "metric" | "imperial";
  primary_sport?: "running" | "cycling" | "triathlon" | "other" | null;
  experience_level?: "beginner" | "intermediate" | "advanced" | null;
  max_heart_rate?: number | null;
  ftp_watts?: number | null;
  run_threshold_pace_sec?: number | null;
  goal_type?: "race_prep" | "fitness" | "performance" | "other" | null;
  goal_event_name?: string | null;
  goal_event_distance?: string | null;
  goal_event_date?: string | null;
  current_injuries?: string | null;
  updated_at?: string;
}

function secToMmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function buildZoneContext(profile: UserProfile | null): string {
  if (!profile) return "";

  const sections: string[] = [];

  // Running pace zones
  const tSec = profile.run_threshold_pace_sec;
  if (tSec && tSec > 0) {
    const T = tSec;
    const ePaceMin = Math.round(T * 1.29);
    const ePaceMax = Math.round(T * 1.40);
    const mPaceMin = Math.round(T * 1.05);
    const mPaceMax = Math.round(T * 1.15);
    const tPaceMin = Math.round(T * 0.97);
    const tPaceMax = Math.round(T * 1.03);
    const iPaceMin = Math.round(T * 0.87);
    const iPaceMax = Math.round(T * 0.95);
    const rPaceMin = Math.round(T * 0.75);
    const rPaceMax = Math.round(T * 0.85);

    sections.push(
      `Running — threshold: ${secToMmss(T)}/km\n` +
      `  Named paces:\n` +
      `    E  Easy:      ${secToMmss(ePaceMin)}–${secToMmss(ePaceMax)}/km  (recovery, base, long runs)\n` +
      `    M  Marathon:  ${secToMmss(mPaceMin)}–${secToMmss(mPaceMax)}/km  (sustained aerobic)\n` +
      `    T  Threshold: ${secToMmss(tPaceMin)}–${secToMmss(tPaceMax)}/km  (cruise intervals, tempo)\n` +
      `    I  Interval:  ${secToMmss(iPaceMin)}–${secToMmss(iPaceMax)}/km  (VO2max efforts, 3–5 min)\n` +
      `    R  Reps:      ${secToMmss(rPaceMin)}–${secToMmss(rPaceMax)}/km  (speed/economy, <2 min)\n` +
      `  Zones: Z1 >${secToMmss(Math.round(T * 1.40))} · Z2 ${secToMmss(Math.round(T * 1.14))}–${secToMmss(Math.round(T * 1.40))} · Z3 ${secToMmss(Math.round(T * 1.03))}–${secToMmss(Math.round(T * 1.14))} · Z4 ${secToMmss(Math.round(T * 0.95))}–${secToMmss(Math.round(T * 1.03))} · Z5 <${secToMmss(Math.round(T * 0.95))}`
    );
  }

  // Cycling power zones (Coggan 7-zone)
  const ftp = profile.ftp_watts;
  if (ftp && ftp > 0) {
    const z = (pct: number) => Math.round(ftp * pct);
    sections.push(
      `Cycling — FTP: ${ftp} W\n` +
      `  Z1 Recovery:      ≤${z(0.55)} W\n` +
      `  Z2 Endurance:     ${z(0.56)}–${z(0.75)} W\n` +
      `  Z3 Tempo:         ${z(0.76)}–${z(0.90)} W\n` +
      `  Z4 Threshold:     ${z(0.91)}–${z(1.05)} W\n` +
      `  Z5 VO2max:        ${z(1.06)}–${z(1.20)} W\n` +
      `  Z6 Anaerobic:     ${z(1.21)}–${z(1.50)} W\n` +
      `  Z7 Neuromuscular: >${z(1.50)} W`
    );
  }

  // HR zones (5-zone % HRmax) — always shown when HRmax known
  const hrMax = profile.max_heart_rate;
  if (hrMax && hrMax > 0) {
    const hr = (pct: number) => Math.round(hrMax * pct);
    sections.push(
      `Heart rate — max: ${hrMax} bpm\n` +
      `  Z1 Recovery:  <${hr(0.60)} bpm\n` +
      `  Z2 Aerobic:   ${hr(0.60)}–${hr(0.72)} bpm\n` +
      `  Z3 Tempo:     ${hr(0.72)}–${hr(0.83)} bpm\n` +
      `  Z4 Threshold: ${hr(0.83)}–${hr(0.92)} bpm\n` +
      `  Z5 Max:       >${hr(0.92)} bpm`
    );
  }

  if (sections.length === 0) return "";
  return "Training zones (use these targets when prescribing workouts):\n\n" + sections.join("\n\n");
}

export function buildAthleteContext(
  user: { user_metadata?: Record<string, unknown> },
  profile: UserProfile | null
): string {
  const lines: string[] = [];

  const firstName = user.user_metadata?.first_name as string | undefined;
  if (firstName) lines.push(`The user's first name is ${firstName}.`);

  if (profile) {
    // Injuries go first — most important for safe advice
    if (profile.current_injuries?.trim()) {
      lines.push(`IMPORTANT — Current injuries/limitations: ${profile.current_injuries.trim()}`);
    }

    const parts: string[] = [];

    if (profile.date_of_birth) {
      const ageMs = Date.now() - new Date(profile.date_of_birth).getTime();
      const age = Math.floor(ageMs / (365.25 * 24 * 3600 * 1000));
      parts.push(`Age: ${age}`);
      const estimatedHRmax = 220 - age;
      if (!profile.max_heart_rate) {
        parts.push(`Estimated HRmax: ${estimatedHRmax} bpm (220 − age)`);
      }
    }

    if (profile.max_heart_rate) {
      parts.push(`Max heart rate: ${profile.max_heart_rate} bpm (user-confirmed)`);
    }

    if (profile.weight_kg) {
      parts.push(`Weight: ${profile.weight_kg} kg`);
    }

    if (profile.height_cm) {
      const bmi =
        profile.weight_kg
          ? Math.round((profile.weight_kg / Math.pow(profile.height_cm / 100, 2)) * 10) / 10
          : null;
      parts.push(`Height: ${profile.height_cm} cm${bmi ? ` (BMI: ${bmi})` : ""}`);
    }

    if (profile.preferred_units) {
      parts.push(`Preferred units: ${profile.preferred_units}`);
    }

    if (profile.primary_sport) {
      parts.push(`Primary sport: ${profile.primary_sport}`);
    }

    if (profile.experience_level) {
      parts.push(`Experience level: ${profile.experience_level}`);
    }

    if (profile.goal_type) {
      let goalStr = `Training goal: ${profile.goal_type.replace("_", " ")}`;
      if (profile.goal_type === "race_prep" && profile.goal_event_name) {
        goalStr += ` — ${profile.goal_event_name}`;
        if (profile.goal_event_distance) goalStr += ` (${profile.goal_event_distance})`;
        if (profile.goal_event_date) {
          const weeksOut = Math.ceil(
            (new Date(profile.goal_event_date).getTime() - Date.now()) / (7 * 24 * 3600 * 1000)
          );
          goalStr += weeksOut > 0 ? `, ${weeksOut} weeks away` : ` (race date passed)`;
        }
      }
      parts.push(goalStr);
    }

    if (parts.length > 0) {
      lines.push(`Athlete profile: ${parts.join(". ")}.`);
    }
  }

  const trainingContext = user.user_metadata?.training_context as string | undefined;
  if (trainingContext?.trim()) {
    lines.push(`Additional training notes: ${trainingContext.trim()}`);
  }

  const zoneContext = buildZoneContext(profile);
  if (zoneContext) lines.push(zoneContext);

  return lines.length > 0 ? lines.join("\n\n") + "\n\n" : "";
}
