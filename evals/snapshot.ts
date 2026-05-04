import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

type ToolCall = { tool: string; input: unknown; output: unknown; duration_ms: number };

type DatasetEntry = {
  id: string;
  category: string;
  question: string;
  tags: string[];
  notes?: string;
  trace_id?: string;
  snapshotted_at?: string;
  tool_calls?: ToolCall[];
  final_answer?: string | null;
  plan?: { steps: string[] } | null;
  turn_count?: number | null;
};

async function main() {
  const force = process.argv.includes("--force");

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const datasetPath = path.resolve(__dirname, "dataset.json");
  const entries: DatasetEntry[] = JSON.parse(fs.readFileSync(datasetPath, "utf-8"));

  const toSnapshot = force ? entries : entries.filter((e) => !("tool_calls" in e));

  if (toSnapshot.length === 0) {
    console.log("All entries already snapshotted. Use --force to re-snapshot.");
    return;
  }

  console.log(`Snapshotting ${toSnapshot.length} of ${entries.length} entries...`);

  let matched = 0;
  let missing = 0;

  for (const entry of toSnapshot) {
    const { data, error } = await supabase
      .from("agent_traces")
      .select("id, question, plan, tool_calls, final_answer, turn_count, created_at")
      .eq("question", entry.question)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(`  [ERROR] ${entry.id}: ${error.message}`);
      continue;
    }

    if (!data) {
      console.warn(`  [MISSING] ${entry.id} — no trace found for: "${entry.question}"`);
      missing++;
      continue;
    }

    const idx = entries.indexOf(entry);
    entries[idx] = {
      ...entry,
      trace_id: data.id as string,
      snapshotted_at: new Date().toISOString(),
      tool_calls: (data.tool_calls as ToolCall[]) ?? [],
      final_answer: (data.final_answer as string) ?? null,
      plan: (data.plan as { steps: string[] }) ?? null,
      turn_count: (data.turn_count as number) ?? null,
    };

    matched++;
    console.log(`  [OK] ${entry.id}`);
  }

  fs.writeFileSync(datasetPath, JSON.stringify(entries, null, 2) + "\n", "utf-8");
  console.log(`\nDone. ${matched} matched, ${missing} missing.`);
  if (missing > 0) {
    console.log(`Ask the missing questions verbatim in the chat app, then re-run npm run snapshot.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
