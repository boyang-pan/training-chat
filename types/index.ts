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

export type ChartType = "line" | "bar" | "scatter";

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
  x_label?: string;
  y_label?: string;
}

export interface AgentPlan {
  steps: string[];
}

export interface AgentMessage {
  plan?: AgentPlan;
  states: ReasoningState[];
  chart?: ChartPayload;
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
