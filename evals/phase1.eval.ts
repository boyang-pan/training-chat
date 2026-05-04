import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { Eval } from "braintrust";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs } from "ai";
import { createAgentTools } from "../lib/agent/tools";
import { SYSTEM_PROMPT } from "../lib/agent/system-prompt";
import {
  schemaBeforeQuery,
  schemaLeadsToQuery,
  unitConversionInSQL,
  usesPersonalRecordsTool,
  usesTrainingLoadTool,
  chartIsNotFinalAction,
  usesNotesTool,
  segmentQueryUsesSegmentEfforts,
} from "./scorers";

type ToolCall = { tool: string; input: unknown; output: unknown; duration_ms: number };

type DatasetEntry = {
  id: string;
  category: string;
  question: string;
  tags: string[];
  notes?: string;
};

function loadDataset() {
  const datasetPath = path.resolve(__dirname, "dataset.json");
  const entries: DatasetEntry[] = JSON.parse(fs.readFileSync(datasetPath, "utf-8"));
  return entries.map((entry) => ({
    id: entry.id,
    input: { question: entry.question },
    metadata: { category: entry.category, tags: entry.tags },
  }));
}

function buildSystemPrompt(userId: string): string {
  const now = new Date();
  const weekStart = (() => {
    const d = new Date(now);
    const day = d.getDay();
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    return d.toISOString().split("T")[0];
  })();
  const dateContext = [
    `Today's date context:`,
    `today=${now.toISOString().split("T")[0]},`,
    `day_of_week=${now.toLocaleDateString("en-US", { weekday: "long" })},`,
    `iso_week_start=${weekStart},`,
    `month_start=${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01.`,
  ].join(" ");
  return `${SYSTEM_PROMPT}\n\n${dateContext}\n\nCurrent user ID: ${userId}. Always include WHERE user_id = '${userId}' in every SQL query.`;
}

Eval("training-chat", {
  data: loadDataset,
  task: async ({ question }: { question: string }, { span }) => {
    const userId = process.env.EVAL_USER_ID;
    if (!userId) throw new Error("EVAL_USER_ID is not set in .env.local");

    const agentTools = createAgentTools(userId);
    const systemPrompt = buildSystemPrompt(userId);
    const toolCalls: ToolCall[] = [];

    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-6"),
      providerOptions: {
        anthropic: {
          thinking: { type: "adaptive" },
          headers: { "anthropic-beta": "interleaved-thinking-2025-05-14" },
        },
      },
      system: systemPrompt,
      messages: [{ role: "user" as const, content: question }],
      tools: agentTools,
      stopWhen: stepCountIs(20),
      onStepFinish: ({
        toolCalls: stepToolCalls,
        toolResults,
      }: {
        toolCalls: Array<{ toolName: string; input: unknown }>;
        toolResults: Array<{ output: unknown }>;
      }) => {
        stepToolCalls.forEach((tc, i) => {
          toolCalls.push({
            tool: tc.toolName,
            input: tc.input,
            output: toolResults[i]?.output ?? null,
            duration_ms: 0,
          });
        });
      },
    });

    const errorCount = toolCalls.filter((tc) => {
      const out = tc.output as Record<string, unknown> | null;
      return out !== null && typeof out === "object" && "error" in out;
    }).length;

    span.log({
      metrics: {
        tool_call_count: toolCalls.length,
        tool_error_count: errorCount,
      },
    });

    return {
      question,
      tool_calls: toolCalls,
      final_answer: text,
      plan: null,
      turn_count: toolCalls.length,
    };
  },
  scores: [
    schemaBeforeQuery,
    schemaLeadsToQuery,
    unitConversionInSQL,
    usesPersonalRecordsTool,
    usesTrainingLoadTool,
    chartIsNotFinalAction,
    usesNotesTool,
    segmentQueryUsesSegmentEfforts,
  ],
  experimentName: "phase2-re-execute",
  trialCount: 1,
});
