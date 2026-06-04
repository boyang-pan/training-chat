import { getAuthUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/client";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { computeTrainingLoad } from "@/lib/agent/training-load";

const cache = new Map<string, { prompts: string[]; ts: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function GET() {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const userId = user.id;

  const cached = cache.get(userId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return Response.json({ prompts: cached.prompts });
  }

  try {
    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: activities } = await supabaseAdmin
      .from("activities")
      .select("start_date, moving_time_seconds")
      .eq("user_id", userId)
      .gte("start_date", since)
      .order("start_date", { ascending: true });

    let formLabel = "";
    if (activities && activities.length > 0) {
      const load = computeTrainingLoad(
        activities.map((a) => ({
          start_date: a.start_date as string,
          moving_time_seconds: a.moving_time_seconds as number,
        })),
        90
      );
      formLabel = load.current.form_label;
    }

    const lines: string[] = [];
    if (profile?.primary_sport) lines.push(`- Sport: ${profile.primary_sport}`);
    if (profile?.goal_type) {
      let goal = String(profile.goal_type);
      if (profile.goal_event_name) goal += ` (${profile.goal_event_name}`;
      if (profile.goal_event_date) goal += `, ${profile.goal_event_date}`;
      if (profile.goal_event_name) goal += ")";
      lines.push(`- Goal: ${goal}`);
    }
    if (profile?.experience_level) lines.push(`- Experience: ${profile.experience_level}`);
    if (formLabel) lines.push(`- Current form: ${formLabel}`);
    if (profile?.current_injuries) lines.push(`- Injuries: ${profile.current_injuries}`);

    const context = lines.length > 0 ? lines.join("\n") : "- No profile set up";

    const { text } = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      prompt: `You are generating starter questions for an AI training coach.

Athlete:
${context}

Generate exactly 4 short, clickable questions (under 60 characters each) a user would tap to start a conversation about their training data.

Rules:
- If current form is Tired or Very Tired, lean toward recovery/rest questions
- If current form is Fresh or Optimal, lean toward performance or goal-progress questions
- Cover at least 2 different aspects (e.g. recent performance, trends, recovery, goal progress)
- Be specific and concrete — no generic advice questions
- Output ONLY a JSON array of 4 strings`,
      maxOutputTokens: 200,
    });

    const match = text.match(/\[[\s\S]*\]/);
    let prompts: string[] | null = null;
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed) && parsed.length >= 4) {
        prompts = parsed.slice(0, 4);
      }
    }

    if (prompts) cache.set(userId, { prompts, ts: Date.now() });
    return Response.json({ prompts });
  } catch {
    return Response.json({ prompts: null });
  }
}
