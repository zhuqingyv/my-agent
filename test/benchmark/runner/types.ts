import type { AgentEvent } from '../../../src/agent/events.js';

// Re-export for convenience
export type { AgentEvent } from '../../../src/agent/events.js';

// ─── Level ───

export type Level = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

export const LEVEL_ORDER: Level[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];

export const LEVEL_CONFIG: Record<Level, { cutoff: number; rate: number; weight: number }> = {
  L0: { cutoff: 1.0, rate: 1.0, weight: 0 },
  L1: { cutoff: 0.75, rate: 0.90, weight: 15 },
  L2: { cutoff: 0.65, rate: 0.80, weight: 20 },
  L3: { cutoff: 0.55, rate: 0.70, weight: 25 },
  L4: { cutoff: 0.45, rate: 0.60, weight: 25 },
  L5: { cutoff: 0.40, rate: 0.50, weight: 15 },
};

// ─── TaskDef (YAML → TS) ───

export interface TaskDef {
  id: string;
  title: string;
  level: Level;
  category: string;
  weight: number;
  fixture?: FixtureSpec;
  userInput?: string;
  rounds?: RoundDef[];
  hardAssertions: HardAssertion[];
  softAssertions: SoftAssertion[];
  runtime: RuntimeSpec;
  reference?: ReferenceSpec;
  dimWeights?: Partial<Record<Dimension, number>>;
  sourcePath: string;
}

export interface FixtureSpec {
  project: string;
  setup?: string[];
}

export interface RoundDef {
  user: string;
  expect?: {
    toolCallsInclude?: string[];
  };
}

export interface RuntimeSpec {
  timeoutSec: number;
  runs: number;
  maxRounds: number | null;
  layer: 'L1' | 'L2';
}

export interface ReferenceSpec {
  referenceRounds?: number;
  humanTimeSec?: number;
  claudeCodeScore?: number;
}

// ─── Assertions ───

export type HardAssertion =
  | { type: 'tool_called'; tool?: string; toolMatches?: string; argsContains?: Record<string, unknown>; argsMatches?: Record<string, string> }
  | { type: 'tool_not_called'; tool?: string; toolMatches?: string }
  | { type: 'tool_retry_max'; maxSameError: number }
  | { type: 'file_content'; path: string; contains?: string; notContains?: string; regex?: string; exact?: string }
  | { type: 'file_exists'; path: string }
  | { type: 'not_file_modified'; path: string }
  | { type: 'no_error_5xx' }
  | { type: 'final_text_contains'; contains?: string; regex?: string }
  | { type: 'final_text_min_chars'; chars: number; chinese?: boolean }
  | { type: 'event_sequence'; sequence: string[] }
  | { type: 'messages_count_max'; max: number }
  | { type: 'exit_code'; cmd: string; code: number };

export interface HardAssertionResult {
  assertion: HardAssertion;
  passed: boolean;
  reason: string;
}

export type SoftAssertion =
  | { type: 'final_text_min_len'; chars: number; weight: number }
  | { type: 'tool_call_count_max'; max: number; weight: number }
  | { type: 'duration_max'; ms: number; weight: number }
  | { type: 'llm_judge'; rubric: string; weight: number }
  | { type: 'reference_match_ratio'; ref: string; weight: number }
  | { type: 'token_usage_max'; max: number; weight: number };

export const M1_SOFT_TYPES = new Set(['final_text_min_len', 'tool_call_count_max', 'duration_max']);

export interface SoftResult {
  assertion: SoftAssertion;
  score: number | null;
  weight: number;
}

// ─── Dimensions (M1 records but doesn't score) ───

export type Dimension = 'ToolAcc' | 'TaskDone' | 'AnsQual' | 'CtxKeep' | 'ErrRec' | 'Eff';

// ─── RunTrace (event-collector output) ───

export interface RunTrace {
  taskId: string;
  runIndex: number;
  events: AgentEvent[];
  toolCalls: ToolCallRecord[];
  finalText: string;
  messagesCount: number;
  thinkingMs: number;
  apiCalls: number;
  startedAt: number;
  elapsedMs: number;
  hitMaxLoops: boolean;
  aborted: boolean;
  crashed: boolean;
  crashReason?: string;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  resultPreview: string;
}

// ─── Scoring ───

export interface TaskScore {
  taskId: string;
  hardPass: boolean;
  softScore: number;
  rawScore: number;
  hardResults: HardAssertionResult[];
  softResults: SoftResult[];
  trace: RunTrace;
}

export interface TaskResult {
  taskId: string;
  level: Level;
  runs: TaskScore[];
  median: number;
  stability: number;
  passRate: number;
}

export interface LevelScore {
  level: Level;
  score: number;
  passRate: number;
  gateOk: boolean;
  tasks: TaskResult[];
}

export interface BenchmarkReport {
  runId: string;
  config: { agent: string; model: string; baseURL: string };
  totalScore: number;
  level: number;
  byLevel: Partial<Record<Level, LevelScore>>;
  weakest: Array<{ taskId: string; median: number; reason: string }>;
  startedAt: string;
  elapsedMs: number;
}

// ─── Run Options (CLI → runner) ───

export interface RunOptions {
  tasksDir: string;
  fixturesDir: string;
  reportsDir: string;
  configPath?: string;
  filterLevel?: Level;
  filterTask?: string;
  runs?: number;
  dryRun?: boolean;
}

// ─── Exit Codes ───

export const EXIT_OK = 0;
export const EXIT_GATE_FAIL = 1;
export const EXIT_L0_INVALID = 2;
export const EXIT_RUNTIME_ERROR = 99;
