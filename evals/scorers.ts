type ToolCall = { tool: string; input: unknown; output: unknown; duration_ms: number };

type TraceOutput = {
  question: string;
  tool_calls: ToolCall[];
  final_answer: string | null;
  plan: { steps: string[] } | null;
  turn_count: number | null;
};

// Scorers read trace data from output. input only needs .question for regex-gating.
type ScorerArgs = { input: { question: string }; output: TraceOutput };

// 1. get_schema must appear before first run_query
export function schemaBeforeQuery({ output }: ScorerArgs): number | null {
  const tools = output.tool_calls.map((tc) => tc.tool);
  const firstSchema = tools.indexOf("get_schema");
  const firstQuery = tools.indexOf("run_query");
  if (firstQuery === -1) return null; // no run_query in this trace, rule doesn't apply
  if (firstSchema === -1) return 0; // queried without ever calling get_schema
  return firstSchema < firstQuery ? 1 : 0;
}

// 2. If get_schema was called, at least one data-fetching tool must follow.
// Catches the "inspects schema, never queries" silent failure.
const DATA_TOOLS = new Set(["run_query", "get_personal_records", "get_activity_detail"]);

export function schemaLeadsToQuery({ output }: ScorerArgs): number | null {
  const tools = output.tool_calls.map((tc) => tc.tool);
  if (!tools.includes("get_schema")) return null; // schema wasn't called, rule doesn't apply
  return tools.some((t) => DATA_TOOLS.has(t)) ? 1 : 0;
}

// 3. (removed) get_date_context was a tool; date context is now pre-injected into the system
// prompt at request time, so this check is no longer applicable.

// 4. Pace/speed questions must use the m/s → min/km conversion formula in SQL.
// Formula: 1000 / (average_speed_mps * 60)
// Regex checks for the two key numeric parts: `1000 /` and `/ 60`.
const PACE_QUESTION_RE = /\b(pace|fast|slow|speed|min\/km|split|per\s+km|per\s+mile)\b/i;
const CONVERSION_RE = /1000\s*\/|\/\s*60/;

export function unitConversionInSQL({ input, output }: ScorerArgs): number | null {
  if (!PACE_QUESTION_RE.test(input.question)) return null;

  const queries = output.tool_calls
    .filter((tc) => tc.tool === "run_query")
    .map((tc) => (tc.input as { sql: string }).sql ?? "");

  // If the agent answered a pace question without run_query (e.g. via get_personal_records), skip.
  if (queries.length === 0) return null;

  return queries.some((sql) => CONVERSION_RE.test(sql)) ? 1 : 0;
}

// 5. PR questions must use get_personal_records(), not raw SQL against the personal_records table.
// The pre-computed table exists precisely so the agent doesn't recompute PRs from scratch.
const PR_QUESTION_RE = /\b(personal\s+record|all[- ]time|fastest\s+ever|best\s+ever|\bprs?\b|\bpb\b)\b/i;

export function usesPersonalRecordsTool({ input, output }: ScorerArgs): number | null {
  if (!PR_QUESTION_RE.test(input.question)) return null;
  return output.tool_calls.map((tc) => tc.tool).includes("get_personal_records") ? 1 : 0;
}

// 6. Fitness/form questions must use get_training_load(), not manual CTL/ATL SQL.
const TRAINING_LOAD_RE =
  /\b(fitness|fatigue|form|ctl|atl|tsb|acwr|overtraining?|readiness|ready\s+to\s+race|injury\s+risk|training\s+load)\b/i;

export function usesTrainingLoadTool({ input, output }: ScorerArgs): number | null {
  if (!TRAINING_LOAD_RE.test(input.question)) return null;
  return output.tool_calls.map((tc) => tc.tool).includes("get_training_load") ? 1 : 0;
}

// 7. render_chart must never be the last action — the system prompt requires text analysis after every chart.
export function chartIsNotFinalAction({ output }: ScorerArgs): number | null {
  const tools = output.tool_calls.map((tc) => tc.tool);
  if (!tools.includes("render_chart")) return null;

  const lastChartIndex = tools.lastIndexOf("render_chart");
  const chartIsLast = lastChartIndex === tools.length - 1;
  const hasTextAfter =
    typeof output.final_answer === "string" && output.final_answer.trim().length > 0;

  return !chartIsLast && hasTextAfter ? 1 : 0;
}

// 8. Questions referencing notes must call get_notes() — cross-session memory only works if it's queried.
const NOTES_QUESTION_RE =
  /\b(notes?|wrote|journal|context|remember|recall|i\s+mentioned|i\s+said)\b/i;

export function usesNotesTool({ input, output }: ScorerArgs): number | null {
  if (!NOTES_QUESTION_RE.test(input.question)) return null;
  return output.tool_calls.map((tc) => tc.tool).includes("get_notes") ? 1 : 0;
}

// 9. Segment questions that run SQL must query segment_efforts, not activities.
const SEGMENT_QUESTION_RE = /\b(segment|kom|strava\s+segment|segment\s+effort|leaderboard)\b/i;
const SEGMENT_TABLE_RE = /\bsegment_efforts\b/i;

export function segmentQueryUsesSegmentEfforts({ input, output }: ScorerArgs): number | null {
  if (!SEGMENT_QUESTION_RE.test(input.question)) return null;
  const queries = output.tool_calls
    .filter((tc) => tc.tool === "run_query")
    .map((tc) => (tc.input as { sql: string }).sql ?? "");
  if (queries.length === 0) return null; // no SQL run — no penalty
  return queries.some((sql) => SEGMENT_TABLE_RE.test(sql)) ? 1 : 0;
}
