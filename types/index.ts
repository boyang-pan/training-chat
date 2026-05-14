export type ReasoningStateStatus = "pending" | "active" | "done";

export interface ToolCall {
  tool: string;
  input: unknown;
  output: unknown;
  duration_ms?: number;
}

export interface ReasoningState {
  id: string;
  label: string;
  status: ReasoningStateStatus;
  toolCall?: ToolCall;
}

export type ChartType = "line" | "bar" | "scatter" | "area" | "pie";

export interface ChartDataPoint {
  [key: string]: string | number;
}

export interface ChartPayload {
  type: ChartType;
  title: string;
  subtitle?: string;
  data: ChartDataPoint[];
  x_key: string;
  y_key: string;
  y_keys?: string[];
  x_label?: string;
  y_label?: string;
}

export interface WorkoutSegment {
  duration_min: number;
  zone: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  intensity_pct?: number;
  label?: string;
}

export interface WorkoutPayload {
  title: string;
  sport: "run" | "ride" | "swim" | "other";
  total_duration_min: number;
  segments: WorkoutSegment[];
  description?: string;
}

export interface SegmentEffort {
  date: string;
  time_sec: number;
  is_best: boolean;
  pr_rank?: number;
}

export interface SegmentPayload {
  name: string;
  distance_m: number;
  efforts: SegmentEffort[];
  best_time_sec: number;
  best_date: string;
  effort_count: number;
}

export interface AgentPlan {
  steps: string[];
}

export interface AgentMessage {
  plan?: AgentPlan;
  states: ReasoningState[];
  chart?: ChartPayload;
  workouts?: WorkoutPayload[];
  segment?: SegmentPayload;
  reasoning?: string;
  final_answer: string;
  duration_ms?: number;
  error?: boolean;
  followups?: string[];
}

export interface Conversation {
  id: string;
  title: string | null;
  created_at: string;
  pinned?: boolean;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string | AgentMessage;
  created_at: string;
}
