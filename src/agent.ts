import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionUserMessageParam,
} from 'openai/resources/chat/completions';
import type {
  Agent,
  AgentConfig,
  ArchivedMessage,
  ChatContent,
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
import { classifyCommand, isWhitelisted } from './agent/dangerGuard.js';
import {
  STACK_STATE_PREFIX,
  renderStackState,
  removeLastStackStateMessage,
} from './agent/stack-render.js';
import { loadAgentMd } from './agent/memdir.js';
import { estimateTokens } from './agent/tokenCount.js';
import { summarizeRange } from './agent/summarize.js';
import type { SessionStore } from './session/store.js';

export interface CreateAgentOptions {
  resumeMessages?: ChatCompletionMessageParam[];
  sessionStore?: SessionStore;
  sessionId?: string;
}

const TOOL_NAME_SEP = '__';
const DEFAULT_MAX_LOOPS = 20;
const CREATE_TASK_TOOL_NAME = 'create_task';
const DANGER_EXEC_TOOLS = new Set<string>([
  'exec-mcp__execute_command',
  'exec__execute_command',
]);

function extractCommand(args: Record<string, any>): string {
  if (!args) return '';
  if (typeof args.command === 'string') return args.command;
  if (typeof args.cmd === 'string') return args.cmd;
  return '';
}

function isTtyInteractive(): boolean {
  return Boolean((process.stdin as any)?.isTTY);
}
const DEFAULT_CONTEXT_WINDOW = 32768;
const COMPACT_TRIGGER_RATIO = 0.75;
const COMPACT_KEEP_LAST_N = 6;
const COMPACT_MAX_FAILURES = 2;
const COMPACT_MIN_SUMMARY_CHARS = 50;

function findSafeCutIndex(
  messages: ChatCompletionMessageParam[],
  desiredCut: number
): number {
  let cut = Math.max(1, Math.min(desiredCut, messages.length));
  while (cut < messages.length && messages[cut].role === 'tool') {
    cut += 1;
  }
  return cut;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  delay = 1000
): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as any)?.status;
      if (i < retries && (status === 500 || status === 502 || status === 503)) {
        await new Promise((r) => setTimeout(r, delay * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error('unreachable');
}

function cleanErrorMessage(msg: string): string {
  let clean = msg.replace(/<[^>]*>/g, '').trim();
  clean = clean.replace(/\s+/g, ' ');
  return clean.slice(0, 200) || 'unknown error';
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
  connections: McpConnection[],
  options: CreateAgentOptions = {}
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
  const baseSystemPrompt =
    config.systemPrompt ??
    '你是一个强大的本地 CLI 助手。你能执行命令、读写文件、分析项目。\n\n工作方式：\n- 收到任务后，先用工具收集信息，再给出完整回答\n- 分析项目时，至少读取目录结构和 package.json/README，然后给出技术栈、功能、评价\n- 回答要有内容、有深度，不要敷衍\n- 不要客套、不要套话\n- 中文问就用中文答\n\n工具使用规则：\n- 调用 read_file 时必须提供文件路径，例如 ./package.json\n- 调用 list_directory 时必须提供目录路径，用 . 表示当前目录\n- 调用 execute_command 时必须提供具体命令\n- 如果工具调用失败，换个方式重试而不是放弃\n- 不要复述任务栈状态，那是内部信息';
  const cwd = process.cwd();
  const agentMd = loadAgentMd(cwd);
  const envInfo = `\n\n# Environment\n当前工作目录: ${cwd}\n平台: ${process.platform}\nNode: ${process.version}`;
  const systemPrompt = agentMd
    ? `${baseSystemPrompt}${envInfo}\n\n# Project Context\n${agentMd}`
    : `${baseSystemPrompt}${envInfo}`;

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ];
  if (options.resumeMessages && options.resumeMessages.length > 0) {
    for (const m of options.resumeMessages) {
      if (m.role === 'system') continue;
      messages.push(m);
    }
  }
  const sessionStore = options.sessionStore;
  const sessionId = options.sessionId;
  let persistedCount = messages.length;

  function persistPending(): void {
    if (!sessionStore || !sessionId) {
      persistedCount = messages.length;
      return;
    }
    for (let i = persistedCount; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === 'system') continue;
      try {
        sessionStore.append(sessionId, m);
      } catch {
        /* ignore persist failures */
      }
    }
    persistedCount = messages.length;
  }

  const stack = createTaskStack();
  const taskArchive = new Map<string, ChatCompletionMessageParam[]>();
  const pendingConfirms = new Map<string, (approved: boolean) => void>();
  let confirmCounter = 0;
  const nextConfirmId = () => `cf_${++confirmCounter}`;

  function respondConfirm(requestId: string, approved: boolean): void {
    const resolver = pendingConfirms.get(requestId);
    if (!resolver) return;
    pendingConfirms.delete(requestId);
    resolver(approved);
  }

  function awaitConfirm(
    requestId: string,
    signal?: AbortSignal
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      pendingConfirms.set(requestId, resolve);
      if (signal) {
        const onAbort = () => {
          if (pendingConfirms.delete(requestId)) resolve(false);
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }
  const contextWindow = config.model.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const compactThreshold = Math.floor(contextWindow * COMPACT_TRIGGER_RATIO);
  let compactFailures = 0;
  let compactDisabled = false;

  async function maybeCompact(
    signal?: AbortSignal
  ): Promise<{ compacted: boolean; freed: number }> {
    if (compactDisabled) return { compacted: false, freed: 0 };
    const before = estimateTokens(messages);
    if (before <= compactThreshold) return { compacted: false, freed: 0 };

    const keepLastN = Math.min(COMPACT_KEEP_LAST_N, messages.length - 1);
    const desiredCut = messages.length - keepLastN;
    const cut = findSafeCutIndex(messages, desiredCut);
    if (cut <= 1 || cut >= messages.length) return { compacted: false, freed: 0 };

    const middle = messages.slice(1, cut);
    if (middle.length === 0) return { compacted: false, freed: 0 };

    try {
      const summary = await summarizeRange(
        client,
        config.model.model,
        middle,
        signal
      );
      if (!summary || summary.length < COMPACT_MIN_SUMMARY_CHARS) {
        compactFailures += 1;
        if (compactFailures >= COMPACT_MAX_FAILURES) compactDisabled = true;
        return { compacted: false, freed: 0 };
      }
      messages.splice(1, cut - 1, {
        role: 'system',
        content: `[compact summary]\n${summary}`,
      });
      compactFailures = 0;
      const after = estimateTokens(messages);
      return { compacted: true, freed: Math.max(0, before - after) };
    } catch {
      compactFailures += 1;
      if (compactFailures >= COMPACT_MAX_FAILURES) compactDisabled = true;
      return { compacted: false, freed: 0 };
    }
  }

  function foldMessages(anchor: number, taskId: string, summary: string): void {
    if (anchor < 0 || anchor > messages.length) return;
    const folded = messages.splice(anchor);
    taskArchive.set(taskId, folded);
    messages.push({
      role: 'system',
      content: `[stack:completed ${taskId}] Summary: ${summary}`,
    });
    persistedCount = messages.length;
  }

  async function* runTask(
    task: Task,
    rootUserMessage: ChatContent,
    signal?: AbortSignal
  ): AsyncGenerator<AgentEvent, { text: string; hitMaxLoops: boolean }, unknown> {
    let openingContent: ChatCompletionUserMessageParam['content'];
    if (task.parentId) {
      openingContent = `（子任务）${task.prompt}`;
    } else if (typeof rootUserMessage === 'string') {
      openingContent = rootUserMessage;
    } else {
      openingContent = rootUserMessage as unknown as ChatCompletionUserMessageParam['content'];
    }
    messages.push({ role: 'user', content: openingContent });
    persistPending();

    let finalText = '';

    for (let loop = 0; loop < maxLoops; loop++) {
      removeLastStackStateMessage(messages);

      const compactResult = await maybeCompact(signal);
      if (compactResult.compacted) {
        yield { type: 'compact:done', freed: compactResult.freed };
      }

      const stateStr = renderStackState(stack);
      if (stateStr) {
        messages.push({ role: 'system', content: stateStr });
      }

      const request: Parameters<typeof client.chat.completions.create>[0] = {
        model: config.model.model,
        messages,
        temperature: config.model.temperature ?? 0.6,
        frequency_penalty: config.model.frequencyPenalty ?? 1.1,
      };
      if (tools.length > 0) {
        request.tools = tools;
        request.tool_choice = 'auto';
      }

      const stream = await withRetry(() =>
        client.chat.completions.create(
          { ...request, stream: true },
          { signal }
        )
      );

      let contentBuf = '';
      const toolAcc = new Map<
        number,
        { id: string; name: string; argsBuf: string }
      >();

      let isThinking = false;
      let thinkingStartTime = 0;
      let thinkingBuf = '';

      for await (const chunk of stream as any) {
        const delta = chunk?.choices?.[0]?.delta;
        if (!delta) continue;

        // Handle reasoning_content (Qwen thinking mode)
        if (typeof (delta as any).reasoning_content === 'string') {
          if (!isThinking) {
            isThinking = true;
            thinkingStartTime = Date.now();
            yield { type: 'thinking:start' };
          }
          continue;
        }

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          // Detect thinking tokens (Gemma: <|channel>thought / <channel|>)
          const cleaned = delta.content
            .replace(/<\|channel>thought/g, '')
            .replace(/<channel\|>/g, '')
            .replace(/<\|channel>/g, '')
            .replace(/<think>/g, '')
            .replace(/<\/think>/g, '');

          // Check if we're entering/exiting thinking
          if (delta.content.includes('<|channel>thought') || delta.content.includes('<think>')) {
            if (!isThinking) {
              isThinking = true;
              thinkingStartTime = Date.now();
              yield { type: 'thinking:start' };
            }
            thinkingBuf += cleaned;
            continue;
          }

          if (delta.content.includes('<channel|>') || delta.content.includes('</think>')) {
            if (isThinking) {
              isThinking = false;
              yield { type: 'thinking:end', durationMs: Date.now() - thinkingStartTime };
            }
            // Output any remaining cleaned content
            if (cleaned.trim()) {
              contentBuf += cleaned;
              yield { type: 'token', text: cleaned };
            }
            continue;
          }

          // If currently thinking, don't output to user
          if (isThinking) {
            thinkingBuf += cleaned;
            continue;
          }

          // Normal content
          if (cleaned.length > 0) {
            contentBuf += cleaned;
            yield { type: 'token', text: cleaned };
          }
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
        persistPending();
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

        let toolResult = '';
        let isError = false;
        let skipExecute = false;

        if (DANGER_EXEC_TOOLS.has(fullName)) {
          const cmd = extractCommand(args);
          const mode = config.danger?.mode ?? 'confirm';
          if (cmd && mode !== 'off') {
            const allow = config.danger?.allow;
            const result = classifyCommand(cmd);
            if (result.dangerous && !isWhitelisted(cmd, allow)) {
              const reason = result.reason ?? 'dangerous command';
              if (mode === 'deny' || !isTtyInteractive()) {
                toolResult = `[blocked] ${reason}`;
                isError = true;
                skipExecute = true;
              } else {
                const requestId = nextConfirmId();
                yield {
                  type: 'tool:confirm',
                  requestId,
                  cmd,
                  reason,
                };
                const approved = await awaitConfirm(requestId, signal);
                if (!approved) {
                  toolResult = `[user denied] ${reason}`;
                  isError = true;
                  skipExecute = true;
                }
              }
            }
          }
        }

        if (!skipExecute) {
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
        }

        const short =
          toolResult.length > 400 ? toolResult.slice(0, 400) + '...' : toolResult;
        yield { type: 'tool:result', ok: !isError, content: short };
        const compacted = compactToolResult(toolResult);
        if (compacted.startsWith('data:image/')) {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: [{ type: 'image_url', image_url: { url: compacted } }] as any,
          });
        } else {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: compacted,
          });
        }
      }
      persistPending();
    }

    const stop = `[agent] task [${task.id}] reached max loop count (${maxLoops}), aborting`;
    messages.push({ role: 'assistant', content: stop });
    persistPending();
    yield { type: 'text', content: stop };
    finalText = stop;
    return { text: finalText, hitMaxLoops: true };
  }

  async function* chat(
    userMessage: ChatContent,
    signal?: AbortSignal
  ): AsyncGenerator<AgentEvent, void, unknown> {
    const rootPromptText =
      typeof userMessage === 'string'
        ? userMessage
        : (userMessage.find((p) => p.type === 'text') as
            | { type: 'text'; text: string }
            | undefined)?.text || '[图片]';
    try {
      stack.push({
        prompt: rootPromptText,
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
        const gen = runTask(task, userMessage, signal);
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
        const cleanError = cleanErrorMessage(failMessage);
        stack.markFailed(task.id, cleanError);
        foldMessages(
          task.messageAnchor,
          task.id,
          `FAILED: ${cleanError}`
        );
        yield { type: 'task:failed', taskId: task.id, error: cleanError };
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
    persistedCount = messages.length;
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

  return { chat, reset, getTaskStack, getArchive, abortAll, respondConfirm };
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
