import { anthropic } from "@ai-sdk/anthropic";
import { stepCountIs, generateText } from "ai";
import { createAgentTools } from "@/lib/agent/tools";
import { SYSTEM_PROMPT } from "@/lib/agent/system-prompt";
import { supabaseAdmin } from "@/lib/supabase/client";
import { getAuthUser } from "@/lib/supabase/server";
import { logger, streamText } from "@/lib/braintrust";

export const maxDuration = 300; // Vercel Pro max

export async function POST(request: Request) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { question, history, conversation_id, timezone } = await request.json();

    const userId = user.id;
    const firstName = user.user_metadata?.first_name as string | undefined;
    const agentTools = createAgentTools(userId);

    const now = new Date();
    const weekStart = (() => {
      const d = new Date(now);
      const day = d.getDay();
      d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
      return d.toISOString().split("T")[0];
    })();
    const dateContext = `Today's date context: today=${now.toISOString().split("T")[0]}, day_of_week=${now.toLocaleDateString("en-US", { weekday: "long" })}, iso_week_start=${weekStart}, month_start=${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01.`;

    const timezoneContext = timezone ? `User's local timezone: ${timezone}. Always convert start_date (stored as UTC) to this timezone when displaying activity times.` : "";
    const systemPrompt = `${SYSTEM_PROMPT}\n\n${dateContext}\n\n${timezoneContext ? timezoneContext + "\n\n" : ""}${firstName ? `The user's first name is ${firstName}. ` : ""}Current user ID: ${userId}. Always include WHERE user_id = '${userId}' in every SQL query.`;

    const span = logger.startSpan({ name: "agent-turn" });

    const toolCalls: Array<{
      tool: string;
      input: unknown;
      output: unknown;
      duration_ms: number;
    }> = [];

    // Phase 2 config — shared across retry attempts
    const answerSpan = span.startSpan({ name: "answer" });
    const phase2Config = {
      model: anthropic("claude-sonnet-4-6"),
      providerOptions: {
        anthropic: {
          thinking: { type: "adaptive" },
          headers: {
            "anthropic-beta": "interleaved-thinking-2025-05-14",
          },
        },
      },
      system: systemPrompt,
      messages: [
        ...(history ?? []),
        { role: "user" as const, content: question },
      ],
      tools: agentTools,
      stopWhen: stepCountIs(20),
      onStepFinish: ({ toolCalls: stepToolCalls, toolResults }: { toolCalls: Array<{ toolName: string; input: unknown }>; toolResults: Array<{ output: unknown }> }) => {
        stepToolCalls.forEach((tc, i) => {
          const toolSpan = answerSpan.startSpan({ name: `tool:${tc.toolName}` });
          toolSpan.log({
            input: tc.input,
            output: toolResults[i]?.output ?? null,
          });
          toolSpan.end();

          toolCalls.push({
            tool: tc.toolName,
            input: tc.input,
            output: toolResults[i]?.output ?? null,
            duration_ms: 0,
          });
        });
      },
      onFinish: async ({
        text,
        finishReason,
        steps,
        usage,
      }: {
        text: string;
        finishReason: string;
        steps: unknown[];
        usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
      }) => {
        console.log(`[agent] finished — reason: ${finishReason}, steps: ${steps.length}, answer_length: ${text.length}`);

        const toolErrorCount = toolCalls.filter((tc) => {
          const out = tc.output as Record<string, unknown> | null;
          return out !== null && typeof out === "object" && "error" in out;
        }).length;

        answerSpan.log({
          input: question,
          output: text,
          metrics: {
            prompt_tokens: usage?.inputTokens,
            completion_tokens: usage?.outputTokens,
            tokens: usage?.totalTokens,
            tool_error_count: toolErrorCount,
            tool_call_count: toolCalls.length,
          },
        });
        answerSpan.end();

        span.log({
          input: question,
          metadata: {
            finishReason,
            stepCount: steps.length,
            toolNames: toolCalls.map((tc) => tc.tool),
          },
        });
        span.end();
        await logger.flush();

        if (!conversation_id) return;
        await supabaseAdmin.from("agent_traces").insert({
          user_id: userId,
          conversation_id,
          question,
          tool_calls: toolCalls,
          final_answer: text,
          turn_count: toolCalls.length,
        });
      },
    };

    // Build a custom stream that emits our protocol lines so the client
    // can parse both tool-call events and text deltas in real time.
    // Protocol:
    //   0:"text chunk"          — text delta
    //   9:{toolName, args}      — tool call start
    //   a:{result}              — tool result
    //   d:{}                    — stream done
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Retry loop — Anthropic returns overloaded_error (529) and rate_limit_error (429) transiently
        const maxAttempts = 3;
        let lastErr: unknown;
        let incompleteResponse = false;
        let completedSuccessfully = false;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          if (attempt > 0) {
            console.log(`[agent] retrying Phase 2 (attempt ${attempt + 1})...`);
            await new Promise((r) => setTimeout(r, 2000 * attempt));
          }
          try {
            const result = streamText(phase2Config);
            let hasText = false;
            let hasToolResults = false;
            for await (const chunk of result.fullStream) {
              let line: string | null = null;

              if (chunk.type === "reasoning-delta") {
                line = `r:${JSON.stringify(chunk.text)}\n`;
              } else if (chunk.type === "text-delta") {
                hasText = true;
                line = `0:${JSON.stringify(chunk.text)}\n`;
              } else if (chunk.type === "tool-call") {
                let parsedInput: unknown = chunk.input;
                try { parsedInput = JSON.parse(chunk.input as string); } catch {}
                line = `9:${JSON.stringify({ toolName: chunk.toolName, args: parsedInput })}\n`;
              } else if (chunk.type === "tool-result") {
                hasToolResults = true;
                line = `a:${JSON.stringify({ result: chunk.output })}\n`;
              } else if (chunk.type === "finish") {
                if (hasToolResults && !hasText) {
                  incompleteResponse = true;
                } else {
                  completedSuccessfully = true;
                }
              }

              if (line) controller.enqueue(encoder.encode(line));
            }
            lastErr = null;
            break; // success
          } catch (err) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);
            const isTransient =
              msg.toLowerCase().includes("overload") ||
              msg.includes("529") ||
              msg.toLowerCase().includes("rate_limit") ||
              msg.includes("429");
            console.error(`[agent] Phase 2 attempt ${attempt + 1} failed:`, msg);
            if (!isTransient) break; // don't retry non-transient errors
          }
        }

        if (completedSuccessfully) {
          try {
            const res = await generateText({
              model: anthropic("claude-sonnet-4-6"),
              prompt: `The user asked about their Strava training data: "${question}"\n\nSuggest 3 short follow-up questions they might naturally ask next (under 60 characters each). Output ONLY a JSON array of 3 strings with no other text. Example: ["How did I do last week?", "What's my longest run?", "Am I improving?"]`,
              maxOutputTokens: 150,
            });
            const match = res.text.match(/\[[\s\S]*\]/);
            if (match) {
              const parsed = JSON.parse(match[0]);
              if (Array.isArray(parsed)) {
                controller.enqueue(encoder.encode(`f:${JSON.stringify({ followups: parsed.slice(0, 3) })}\n`));
              }
            }
          } catch {
            // skip follow-ups if generation fails
          }
          controller.enqueue(encoder.encode(`d:{}\n`));
        }

        if (lastErr || incompleteResponse) {
          const errMsg = incompleteResponse
            ? "The response was cut off before a final answer was produced (likely a rate limit). Please try again."
            : (lastErr instanceof Error && lastErr.message) ||
              (typeof lastErr === "object" && lastErr !== null && "responseBody" in lastErr
                ? String((lastErr as Record<string, unknown>).responseBody).slice(0, 200)
                : null) ||
              "The AI service is currently overloaded. Please try again in a moment.";
          try {
            controller.enqueue(encoder.encode(`e:${JSON.stringify({ message: errMsg })}\n`));
          } catch {}
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    console.error("Agent route error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
