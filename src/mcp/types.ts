import type { ChildProcess } from 'node:child_process';
import type { TaskStack } from '../task-stack.js';
import type { AgentEvent } from '../agent/events.js';

export type { AgentEvent } from '../agent/events.js';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpCallResult {
  content: string;
  isError: boolean;
}

export interface McpConnection {
  name: string;
  process: ChildProcess;
  tools: McpTool[];
  call(
    toolName: string,
    args: Record<string, any>,
    signal?: AbortSignal
  ): Promise<McpCallResult>;
  close(): Promise<void>;
}

export interface ModelConfig {
  baseURL: string;
  model: string;
  apiKey: string;
  temperature?: number;
  frequencyPenalty?: number;
  contextWindow?: number;
}

export interface DangerConfig {
  mode?: 'confirm' | 'deny' | 'off';
  allow?: string[];
}

export interface AgentConfig {
  model: ModelConfig;
  mcpServers: Record<string, McpServerConfig>;
  systemPrompt?: string;
  maxLoops?: number;
  danger?: DangerConfig;
}

export interface ArchivedMessage {
  role: string;
  content: unknown;
  [key: string]: unknown;
}

export type ChatContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >;

export interface Agent {
  chat(
    userMessage: ChatContent,
    signal?: AbortSignal
  ): AsyncGenerator<AgentEvent, void, unknown>;
  reset(): void;
  getTaskStack(): TaskStack;
  getArchive(taskId: string): ArchivedMessage[] | null;
  abortAll(): number;
  respondConfirm(requestId: string, approved: boolean): void;
}
