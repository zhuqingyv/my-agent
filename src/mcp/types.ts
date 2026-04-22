import type { ChildProcess } from 'node:child_process';

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
  call(toolName: string, args: Record<string, any>): Promise<McpCallResult>;
  close(): Promise<void>;
}

export interface ModelConfig {
  baseURL: string;
  model: string;
  apiKey: string;
}

export interface AgentConfig {
  model: ModelConfig;
  mcpServers: Record<string, McpServerConfig>;
  systemPrompt?: string;
  maxLoops?: number;
}

export interface Agent {
  chat(userMessage: string): AsyncGenerator<string, void, unknown>;
  reset(): void;
}
