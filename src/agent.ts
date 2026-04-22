import OpenAI from 'openai';
import { encode as toonEncode } from '@toon-format/toon';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions';
import type {
  Agent,
  AgentConfig,
  ArchivedMessage,
  McpConnection,
} from './mcp/types.js';
import { createTaskStack, type Task, type TaskStack } from './task-stack.js';

const TOOL_NAME_SEP = '__';
const DEFAULT_MAX_LOOPS = 20;
const STACK_STATE_PREFIX = '\n--- STACK_STATE ---\n';
const CREATE_TASK_TOOL_NAME = 'create_task';
const TOOL_RESULT_MAX_CHARS = 4000;

function compactToolResult(
  result: string,
  maxChars: number = TOOL_RESULT_MAX_CHARS
): string {
  let out = result;

  try {
    const parsed = JSON.parse(out);
    const hasArrayShape =
      Array.isArray(parsed) ||
      (parsed &&
        typeof parsed === 'object' &&
        Object.values(parsed).some(Array.isArray));
    if (hasArrayShape) {
      try {
        const toon = toonEncode(parsed);
        if (typeof toon === 'string' && toon.length < out.length) {
          out = toon;
        }
      } catch {
        // TOON encode failed, keep JSON
      }
    }
  } catch {
    // not JSON, keep as-is
  }

  if (out.length > maxChars) {
    const headLen = Math.floor(maxChars * 0.75);
    const tailLen = Math.floor(maxChars * 0.25);
    const head = out.slice(0, headLen);
    const tail = out.slice(-tailLen);
    const dropped = out.length - headLen - tailLen;
    out = head + `\n\n[...truncated ${dropped} chars...]\n\n` + tail;
  }

  return out;
}

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

function tryExtractJsonObject(text: string): Record<string, any> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = text.slice(start, end + 1);
  try {
    const parsed = JSON.parse(candidate);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function isPlainObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function normalizeArguments(raw: unknown): Record<string, any> {
  if (raw == null) return {};
  if (isPlainObject(raw)) return raw;
  if (typeof raw !== 'string') return {};
  const s = raw.trim();
  if (!s) return {};
  try {
    const parsed = JSON.parse(s);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    const extracted = tryExtractJsonObject(s);
    return extracted ?? {};
  }
}

let callIdCounter = 0;
function ensureToolCallId(id: string | undefined | null): string {
  if (id && typeof id === 'string' && id.trim()) return id;
  callIdCounter += 1;
  return `call_${Date.now().toString(36)}_${callIdCounter}`;
}

function normalizeToolCalls(
  rawCalls: unknown
): ChatCompletionMessageToolCall[] | null {
  if (!Array.isArray(rawCalls) || rawCalls.length === 0) return null;
  const out: ChatCompletionMessageToolCall[] = [];
  for (const call of rawCalls) {
    if (!call || typeof call !== 'object') continue;
    const c = call as any;
    const fn = c.function;
    if (!fn || typeof fn.name !== 'string' || !fn.name) continue;
    out.push({
      id: ensureToolCallId(c.id),
      type: 'function',
      function: {
        name: fn.name,
        arguments:
          typeof fn.arguments === 'string'
            ? fn.arguments
            : JSON.stringify(fn.arguments ?? {}),
      },
    });
  }
  return out.length > 0 ? out : null;
}

function renderStackState(stack: TaskStack): string {
  const cur = stack.current();
  const pending = stack.pending();

  if (!cur && pending.length === 0) return '';

  const lines: string[] = [
    '<stack_state note="内部状态，禁止向用户输出">',
  ];
  lines.push(
    cur ? `Current task: ${cur.prompt}` : 'Current task: (none)'
  );

  if (pending.length === 0) {
    lines.push('Pending tasks: (none)');
  } else {
    lines.push('Pending tasks (top first):');
    const topFirst = pending.slice().reverse();
    topFirst.forEach((t, i) => {
      lines.push(`  ${i + 1}. ${t.prompt}`);
    });
    lines.push('Rules:');
    lines.push('  - 需要拆分才调 create_task，不要重复已在栈里的。');
  }

  lines.push('</stack_state>');
  return STACK_STATE_PREFIX + lines.join('\n');
}

function removeLastStackStateMessage(
  messages: ChatCompletionMessageParam[]
): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (
      m.role === 'system' &&
      typeof m.content === 'string' &&
      m.content.startsWith(STACK_STATE_PREFIX)
    ) {
      messages.splice(i, 1);
      return;
    }
  }
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
  const tools: ChatCompletionTool[] = [...mcpTools, CREATE_TASK_TOOL];
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
    task: Task
  ): AsyncGenerator<string, { text: string; hitMaxLoops: boolean }, unknown> {
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

      const response = await client.chat.completions.create(request);
      const choice = (response as any).choices?.[0];
      if (!choice) {
        const text = '[agent] model returned no choices';
        messages.push({ role: 'assistant', content: text });
        yield text;
        finalText = text;
        return { text: finalText, hitMaxLoops: false };
      }
      const msg = choice.message ?? {};
      const toolCalls = normalizeToolCalls((msg as any).tool_calls);

      if (!toolCalls) {
        const content = typeof msg.content === 'string' ? msg.content : '';
        messages.push({ role: 'assistant', content });
        if (content) yield content;
        finalText = content;
        return { text: finalText, hitMaxLoops: false };
      }

      messages.push({
        role: 'assistant',
        content: typeof msg.content === 'string' ? msg.content : '',
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        const fullName = tc.function.name;
        const args = normalizeArguments(tc.function.arguments);
        yield `\n[tool] ${fullName} ${JSON.stringify(args)}\n`;

        let toolResult: string;
        let isError = false;

        if (fullName === CREATE_TASK_TOOL_NAME) {
          const promptArg =
            typeof args.prompt === 'string' ? args.prompt.trim() : '';
          const reasonArg =
            typeof args.reason === 'string' ? args.reason : undefined;
          if (!promptArg) {
            toolResult = 'Error: create_task requires a non-empty "prompt"';
            isError = true;
          } else {
            try {
              const newTask = stack.push({
                prompt: promptArg,
                reason: reasonArg,
                parentId: task.id,
                messageAnchor: -1,
              });
              toolResult = JSON.stringify({
                ok: true,
                taskId: newTask.id,
                stackSize: stack.size(),
              });
            } catch (err) {
              toolResult = `Error: ${(err as Error).message}`;
              isError = true;
            }
          }
        } else {
          const route = routeToolCall(connections, fullName);
          if (!route) {
            toolResult = `Error: unknown tool '${fullName}'`;
            isError = true;
          } else {
            try {
              const r = await route.conn.call(route.toolName, args);
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
        yield `[tool:${isError ? 'err' : 'ok'}] ${short}\n`;
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: compactToolResult(toolResult),
        });
      }
    }

    const stop = `[agent] task [${task.id}] reached max loop count (${maxLoops}), aborting`;
    messages.push({ role: 'assistant', content: stop });
    yield stop;
    finalText = stop;
    return { text: finalText, hitMaxLoops: true };
  }

  async function* chat(
    userMessage: string
  ): AsyncGenerator<string, void, unknown> {
    try {
      stack.push({
        prompt: userMessage,
        messageAnchor: -1,
      });
    } catch (err) {
      const text = `[agent] failed to push root task: ${(err as Error).message}`;
      yield text;
      return;
    }

    while (stack.size() > 0) {
      const task = stack.pop();
      if (!task) break;

      task.messageAnchor = messages.length;

      yield `[task] → [${task.id}] ${task.prompt.slice(0, 80)}\n`;

      let taskText = '';
      let hitMaxLoops = false;
      let failed = false;
      let failMessage = '';

      try {
        const gen = runTask(task);
        while (true) {
          const { value, done } = await gen.next();
          if (done) {
            const result = value ?? { text: '', hitMaxLoops: false };
            taskText = result.text ?? '';
            hitMaxLoops = result.hitMaxLoops === true;
            break;
          }
          yield value as string;
        }
      } catch (err) {
        failed = true;
        failMessage = (err as Error).message;
      }

      if (failed) {
        stack.markFailed(task.id, failMessage);
        foldMessages(
          task.messageAnchor,
          task.id,
          `FAILED: ${failMessage}`.slice(0, 500)
        );
        yield `[task] x [${task.id}] failed: ${failMessage}\n`;
      } else if (hitMaxLoops) {
        stack.markFailed(task.id, taskText);
        foldMessages(task.messageAnchor, task.id, taskText);
        yield `[task] x [${task.id}] max loops\n`;
      } else {
        stack.markDone(task.id, taskText);
        foldMessages(task.messageAnchor, task.id, taskText || '(no output)');
        const next = stack.peek();
        yield next
          ? `[task] ok [${task.id}] → next: [${next.id}]\n`
          : `[task] ok [${task.id}] → (stack empty)\n`;
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
