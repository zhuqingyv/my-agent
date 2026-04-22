import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type {
  Agent,
  AgentConfig,
  ArchivedMessage,
  McpConnection,
} from './mcp/types.js';
import { createTaskStack, type Task, type TaskStack } from './task-stack.js';
import type { AgentEvent } from './agent/events.js';
import {
  normalizeArguments,
  ensureToolCallId,
  normalizeToolCalls,
} from './agent/normalize.js';
import { compactToolResult } from './agent/compact.js';
import {
  STACK_STATE_PREFIX,
  renderStackState,
  removeLastStackStateMessage,
} from './agent/stack-render.js';

const TOOL_NAME_SEP = '__';
const DEFAULT_MAX_LOOPS = 20;
const CREATE_TASK_TOOL_NAME = 'create_task';

const CREATE_TASK_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: CREATE_TASK_TOOL_NAME,
    description:
      '把子任务压栈，当前任务完成后再执行。只有复杂任务需要拆分时才调用，简单问答直接回答不要调。不要重复已在栈里的任务。',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '子任务的完整指令，带上所需上下文。',
        },
        reason: {
          type: 'string',
          description: '为什么需要拆这个子任务（一句话）。',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
};

interface BuiltinToolContext {
  stack: TaskStack;
  currentTask: Task;
}

interface BuiltinTool {
  definition: ChatCompletionTool;
  handler: (
    args: Record<string, any>,
    ctx: BuiltinToolContext
  ) => { content: string; isError: boolean };
}

const builtinTools = new Map<string, BuiltinTool>();

builtinTools.set(CREATE_TASK_TOOL_NAME, {
  definition: CREATE_TASK_TOOL,
  handler: (args, ctx) => {
    const promptArg =
      typeof args.prompt === 'string' ? args.prompt.trim() : '';
    const reasonArg =
      typeof args.reason === 'string' ? args.reason : undefined;
    if (!promptArg) {
      return {
        content: 'Error: create_task requires a non-empty "prompt"',
        isError: true,
      };
    }
    try {
      const newTask = ctx.stack.push({
        prompt: promptArg,
        reason: reasonArg,
        parentId: ctx.currentTask.id,
        messageAnchor: -1,
      });
      return {
        content: JSON.stringify({
          ok: true,
          taskId: newTask.id,
          stackSize: ctx.stack.size(),
        }),
        isError: false,
      };
    } catch (err) {
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
  },
});

function mcpToolsToOpenAI(connections: McpConnection[]): ChatCompletionTool[] {
  const out: ChatCompletionTool[] = [];
  for (const conn of connections) {
    for (const tool of conn.tools) {
      out.push({
        type: 'function',
        function: {
          name: `${conn.name}${TOOL_NAME_SEP}${tool.name}`,
          description: tool.description || tool.name,
          parameters:
            tool.inputSchema && typeof tool.inputSchema === 'object'
              ? (tool.inputSchema as Record<string, any>)
              : { type: 'object', properties: {} },
        },
      });
    }
  }
  return out;
}

function routeToolCall(
  connections: McpConnection[],
  fullName: string
): { conn: McpConnection; toolName: string } | null {
  const sepIdx = fullName.indexOf(TOOL_NAME_SEP);
  if (sepIdx <= 0) return null;
  const serverName = fullName.slice(0, sepIdx);
  const toolName = fullName.slice(sepIdx + TOOL_NAME_SEP.length);
  const conn = connections.find((c) => c.name === serverName);
  if (!conn) return null;
  if (!conn.tools.some((t) => t.name === toolName)) return null;
  return { conn, toolName };
}

export async function createAgent(
  config: AgentConfig,
  connections: McpConnection[]
): Promise<Agent> {
  const client = new OpenAI({
    baseURL: config.model.baseURL,
    apiKey: config.model.apiKey,
  });

  const mcpTools = mcpToolsToOpenAI(connections);
  const tools: ChatCompletionTool[] = [
    ...mcpTools,
    ...[...builtinTools.values()].map((b) => b.definition),
  ];
  const maxLoops = config.maxLoops ?? DEFAULT_MAX_LOOPS;
  const systemPrompt =
    config.systemPrompt ??
    '你是本地 CLI 助手。有工具就用工具，没工具就直接答。\n\n回答规则（严格遵守）：\n- 一句话回答。能一个词就一个词。\n- 不要客套、不要展望、不要"如果你需要..."。\n- 不要复述任务栈状态，那是内部信息。\n- 没有被问到的信息不要主动汇报。\n- 中文问就用中文答。';

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ];
  const stack = createTaskStack();
  const taskArchive = new Map<string, ChatCompletionMessageParam[]>();

  function foldMessages(anchor: number, taskId: string, summary: string): void {
    if (anchor < 0 || anchor > messages.length) return;
    const folded = messages.splice(anchor);
    taskArchive.set(taskId, folded);
    messages.push({
      role: 'system',
      content: `[stack:completed ${taskId}] Summary: ${summary}`,
    });
  }

  async function* runTask(
    task: Task,
    signal?: AbortSignal
  ): AsyncGenerator<AgentEvent, { text: string; hitMaxLoops: boolean }, unknown> {
    const openingContent = task.parentId
      ? `（子任务）${task.prompt}`
      : task.prompt;
    messages.push({ role: 'user', content: openingContent });

    let finalText = '';

    for (let loop = 0; loop < maxLoops; loop++) {
      removeLastStackStateMessage(messages);
      const stateStr = renderStackState(stack);
      if (stateStr) {
        messages.push({ role: 'system', content: stateStr });
      }

      const request: Parameters<typeof client.chat.completions.create>[0] = {
        model: config.model.model,
        messages,
      };
      if (tools.length > 0) {
        request.tools = tools;
        request.tool_choice = 'auto';
      }

      const stream = await client.chat.completions.create(
        { ...request, stream: true },
        { signal }
      );

      let contentBuf = '';
      const toolAcc = new Map<
        number,
        { id: string; name: string; argsBuf: string }
      >();

      for await (const chunk of stream as any) {
        const delta = chunk?.choices?.[0]?.delta;
        if (!delta) continue;

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          contentBuf += delta.content;
          yield { type: 'token', text: delta.content };
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = typeof tc.index === 'number' ? tc.index : 0;
            let cur = toolAcc.get(idx);
            if (!cur) {
              cur = { id: '', name: '', argsBuf: '' };
              toolAcc.set(idx, cur);
            }
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name += tc.function.name;
            if (tc.function?.arguments) cur.argsBuf += tc.function.arguments;
          }
        }
      }

      const assembled = [...toolAcc.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, v]) => ({
          id: v.id,
          type: 'function' as const,
          function: { name: v.name, arguments: v.argsBuf },
        }));
      const toolCalls = normalizeToolCalls(assembled);

      if (!toolCalls) {
        messages.push({ role: 'assistant', content: contentBuf });
        finalText = contentBuf;
        return { text: finalText, hitMaxLoops: false };
      }

      messages.push({
        role: 'assistant',
        content: contentBuf,
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        const fullName = tc.function.name;
        const args = normalizeArguments(tc.function.arguments);
        yield { type: 'tool:call', name: fullName, args };

        let toolResult: string;
        let isError = false;

        const builtin = builtinTools.get(fullName);
        if (builtin) {
          const r = builtin.handler(args, { stack, currentTask: task });
          toolResult = r.content;
          isError = r.isError;
        } else {
          const route = routeToolCall(connections, fullName);
          if (!route) {
            toolResult = `Error: unknown tool '${fullName}'`;
            isError = true;
          } else {
            try {
              const r = await route.conn.call(route.toolName, args, signal);
              toolResult = r.content;
              isError = r.isError;
            } catch (err) {
              toolResult = `Error: ${(err as Error).message}`;
              isError = true;
            }
          }
        }

        const short =
          toolResult.length > 400 ? toolResult.slice(0, 400) + '...' : toolResult;
        yield { type: 'tool:result', ok: !isError, content: short };
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: compactToolResult(toolResult),
        });
      }
    }

    const stop = `[agent] task [${task.id}] reached max loop count (${maxLoops}), aborting`;
    messages.push({ role: 'assistant', content: stop });
    yield { type: 'text', content: stop };
    finalText = stop;
    return { text: finalText, hitMaxLoops: true };
  }

  async function* chat(
    userMessage: string,
    signal?: AbortSignal
  ): AsyncGenerator<AgentEvent, void, unknown> {
    try {
      stack.push({
        prompt: userMessage,
        messageAnchor: -1,
      });
    } catch (err) {
      yield {
        type: 'text',
        content: `[agent] failed to push root task: ${(err as Error).message}`,
      };
      return;
    }

    outer: while (stack.size() > 0) {
      if (signal?.aborted) break;

      const task = stack.pop();
      if (!task) break;

      task.messageAnchor = messages.length;

      yield { type: 'task:start', taskId: task.id, prompt: task.prompt };

      let taskText = '';
      let hitMaxLoops = false;
      let failed = false;
      let failMessage = '';
      let aborted = false;

      try {
        const gen = runTask(task, signal);
        while (true) {
          const { value, done } = await gen.next();
          if (done) {
            const result = value ?? { text: '', hitMaxLoops: false };
            taskText = result.text ?? '';
            hitMaxLoops = result.hitMaxLoops === true;
            break;
          }
          yield value as AgentEvent;
        }
      } catch (err) {
        const name = (err as any)?.name;
        if (signal?.aborted || name === 'AbortError') {
          aborted = true;
        } else {
          failed = true;
          failMessage = (err as Error).message;
        }
      }

      if (aborted) {
        stack.markFailed(task.id, 'aborted');
        foldMessages(task.messageAnchor, task.id, 'ABORTED');
        yield { type: 'task:aborted', taskId: task.id };
        yield { type: 'aborted' };
        stack.abortAll();
        break outer;
      }

      if (failed) {
        stack.markFailed(task.id, failMessage);
        foldMessages(
          task.messageAnchor,
          task.id,
          `FAILED: ${failMessage}`.slice(0, 500)
        );
        yield { type: 'task:failed', taskId: task.id, error: failMessage };
      } else if (hitMaxLoops) {
        stack.markFailed(task.id, taskText);
        foldMessages(task.messageAnchor, task.id, taskText);
        yield { type: 'task:failed', taskId: task.id, error: 'max loops' };
      } else {
        stack.markDone(task.id, taskText);
        foldMessages(task.messageAnchor, task.id, taskText || '(no output)');
        const next = stack.peek();
        yield {
          type: 'task:done',
          taskId: task.id,
          next: next ? next.id : undefined,
        };
      }
    }

    removeLastStackStateMessage(messages);
  }

  function reset(): void {
    messages.length = 0;
    messages.push({ role: 'system', content: systemPrompt });
    stack.clear();
    taskArchive.clear();
  }

  function getTaskStack(): TaskStack {
    return stack;
  }

  function getArchive(taskId: string): ArchivedMessage[] | null {
    const arr = taskArchive.get(taskId);
    if (!arr) return null;
    return arr.slice() as unknown as ArchivedMessage[];
  }

  function abortAll(): number {
    return stack.abortAll();
  }

  return { chat, reset, getTaskStack, getArchive, abortAll };
}

export const __internal__ = {
  mcpToolsToOpenAI,
  routeToolCall,
  normalizeArguments,
  ensureToolCallId,
  normalizeToolCalls,
  renderStackState,
  removeLastStackStateMessage,
  compactToolResult,
  CREATE_TASK_TOOL,
  STACK_STATE_PREFIX,
};
