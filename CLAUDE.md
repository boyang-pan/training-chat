# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server at http://localhost:3000
npm run build    # Production build (also runs TypeScript type checking)
npm run lint     # ESLint
```

There are no separate test or typecheck scripts — type errors surface via `npm run build`.

## Architecture

Next.js 16 app with Supabase (PostgreSQL) as the database and Anthropic Claude as the reasoning engine. The core feature is a chat interface where the user asks questions about their Strava training data.

### Agent Pipeline (`app/api/agent/route.ts`)

Two-phase approach per user turn:

**Phase 1 — Plan (`generateObject`):** Calls `claude-opus-4-6` to produce a structured `{ steps: string[] }` plan. Runs before any tool calls. The plan is immediately emitted to the client as a `p:` stream line.

**Phase 2 — Execute (`streamText`):** Calls `claude-opus-4-6` with the 9 tools. Streams output to the client using a custom newline-delimited protocol. Retries up to 3× on 529 overloaded errors (exponential backoff starting at 2s). After the stream finishes, saves an `agent_traces` record via `onFinish`.

`claude-opus-4-6` does **not** support assistant message prefill — the messages array passed to Phase 2 must end with a user message.

### Stream Protocol

`chat-view.tsx` → `parseStreamLine()` parses each newline-terminated line by its prefix:

| Prefix | Content | Client action |
|--------|---------|---------------|
| `p:` | `{"steps": [...]}` | Store plan on `AgentMessage` |
| `0:` | `"text delta"` | Append to `final_answer` |
| `9:` / `b:` | `{"toolName":"...", "args":{...}}` | Add "active" `ReasoningState` |
| `a:` | `{"result": [...]}` | Mark last active state "done"; store tool output; if `render_chart`, store `ChartPayload` |
| `e:` | `{"message":"..."}` | Set `error: true`, put message in `final_answer` |
| `d:` | `{}` | Stream complete |

`AgentMessage.final_answer` must never be empty string before persisting — an empty string causes Anthropic API errors in subsequent turns when included in history. A guard in `handleSubmit` fills it with a fallback error message if empty.

### Agent Tools (`lib/agent/tools.ts`)

| Tool | Purpose |
|------|---------|
| `get_schema()` | Returns DB schema. Always called first. |
| `get_date_context()` | Returns today's date + ISO week/month start. Always called before time-based queries. |
| `run_query(sql)` | Runs a read-only SQL query via Supabase RPC `run_readonly_query`. |
| `get_activity_detail(activity_id)` | Full record for a single Strava activity. |
| `get_personal_records()` | Pre-computed PRs from `personal_records` table. |
| `get_notes(start_date?, end_date?)` | User notes from `activity_notes` (cross-session memory). |
| `add_note(content, activity_id?, note_date?)` | Write a note. Only with explicit user confirmation. |
| `get_training_load(days?)` | Computes CTL/ATL/TSB/ACWR via EMA. Uses `suffer_score`; falls back to `moving_time_seconds / 60` when HR data is absent. Returns `{ current, series[] }`. |
| `render_chart(...)` | Emits a `ChartPayload` for the frontend to render. Must always be followed by text analysis. |
| `ask_user(question)` | Clarifying question mid-reasoning. Used sparingly. |

`run_query` safety: strips leading `-- comments`, then checks the trimmed SQL starts with `SELECT` or `WITH`, and rejects forbidden keywords (`INSERT`, `UPDATE`, `DELETE`, `DROP`, etc.). A second layer of validation runs in the PostgreSQL `run_readonly_query` function.

### Database (`supabase/schema.sql`)

Key tables:

- **`activities`** — Strava activity mirror. Speeds in m/s (`average_speed_mps`), distances in meters, times in seconds. `workout_type` is an int (runs: 0=default, 1=race, 2=long, 3=workout; rides: 10=default, 11=race, 12=workout).
- **`activity_notes`** — Free-text notes with optional `activity_id` and `note_date`. Used as cross-session user memory.
- **`personal_records`** — Pre-computed PRs keyed by metric string (e.g. `fastest_1k_run`).
- **`conversations`** / **`messages`** — Chat history. `messages.content` is JSONB: plain string for user turns, full `AgentMessage` object for assistant turns.
- **`agent_traces`** — Full execution trace per turn (question, plan, tool calls, final answer, turn count). For evals/debugging.

`run_readonly_query(query text)` is a `SECURITY DEFINER` PostgreSQL function that validates and executes read-only SQL, returning a `jsonb` array of rows.

### Key Gotchas

- **Strava pace:** stored as `average_speed_mps` (m/s). Convert to min/km: `1000 / (speed_mps * 60)`.
- **Chat history:** `handleSubmit` sends only the last 10 `messages` as history to the agent.
- **History mapping:** assistant messages in history are serialized as `AgentMessage.final_answer` (plain string). Use `|| "fallback"` not `?? ""` — the `??` operator won't catch empty strings.
- **Message persistence:** fire-and-forget `POST /api/conversations/[id]/messages` after the stream ends. Both user and assistant messages are inserted sequentially (to preserve `created_at` order).
- **Title generation:** fire-and-forget `POST /api/title` after the first turn. `conversations.title` is `null` until then.
- **Supabase client** (`lib/supabase/client.ts`): uses a `Proxy` for lazy initialization. Use `supabaseAdmin` (service role) for server-side agent tool execution.

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
```
