import { supabaseAdmin } from "@/lib/supabase/client";
import { getAuthUser } from "@/lib/supabase/server";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("id, title, created_at, pinned")
    .eq("user_id", user.id)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function POST() {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from("conversations")
    .insert({ user_id: user.id, title: null })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { status: 201 });
}
