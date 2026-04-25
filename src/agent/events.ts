export type AgentEvent =
  | { type: 'task:start'; taskId: string; prompt: string }
  | { type: 'task:done'; taskId: string; next?: string }
  | { type: 'task:failed'; taskId: string; error: string }
  | { type: 'task:aborted'; taskId: string }
  | { type: 'tool:call'; name: string; args: Record<string, any> }
  | { type: 'tool:result'; ok: boolean; content: string }
  | { type: 'token'; text: string }
  | { type: 'text'; content: string }
  | { type: 'tool:confirm'; requestId: string; cmd: string; reason: string }
  | { type: 'compact:done'; freed: number }
  | { type: 'aborted' };
