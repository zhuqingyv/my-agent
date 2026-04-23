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
}

export interface AgentConfig {
  model: ModelConfig;
  mcpServers: Record<string, McpServerConfig>;
  systemPrompt?: string;
  maxLoops?: number;
}

export interface ArchivedMessage {
  role: string;
  content: unknown;
  [key: string]: unknown;
}

export interface Agent {
  chat(
    userMessage: string,
    signal?: AbortSignal
  ): AsyncGenerator<AgentEvent, void, unknown>;
  reset(): void;
  getTaskStack(): TaskStack;
  getArchive(taskId: string): ArchivedMessage[] | null;
  abortAll(): number;
}
