import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions';
import type { Agent, AgentConfig, McpConnection } from './mcp/types.js';

const TOOL_NAME_SEP = '__';
const DEFAULT_MAX_LOOPS = 20;

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

export async function createAgent(
  config: AgentConfig,
  connections: McpConnection[]
): Promise<Agent> {
  const client = new OpenAI({
    baseURL: config.model.baseURL,
    apiKey: config.model.apiKey,
  });

  const tools = mcpToolsToOpenAI(connections);
  const maxLoops = config.maxLoops ?? DEFAULT_MAX_LOOPS;
  const systemPrompt =
    config.systemPrompt ??
    'You are a helpful CLI agent. Use the provided tools when they help. Keep answers concise.';

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ];

  async function* chat(userMessage: string): AsyncGenerator<string, void, unknown> {
    messages.push({ role: 'user', content: userMessage });

    for (let loop = 0; loop < maxLoops; loop++) {
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
        return;
      }
      const msg = choice.message ?? {};
      const toolCalls = normalizeToolCalls((msg as any).tool_calls);

      if (!toolCalls) {
        const content = typeof msg.content === 'string' ? msg.content : '';
        messages.push({ role: 'assistant', content });
        if (content) yield content;
        return;
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

        const route = routeToolCall(connections, fullName);
        let toolResult: string;
        let isError = false;
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

        const short =
          toolResult.length > 400 ? toolResult.slice(0, 400) + '...' : toolResult;
        yield `[tool:${isError ? 'err' : 'ok'}] ${short}\n`;
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: toolResult,
        });
      }
    }

    const stop = `[agent] reached max loop count (${maxLoops}), aborting`;
    messages.push({ role: 'assistant', content: stop });
    yield stop;
  }

  function reset(): void {
    messages.length = 0;
    messages.push({ role: 'system', content: systemPrompt });
  }

  return { chat, reset };
}

export const __internal__ = {
  mcpToolsToOpenAI,
  routeToolCall,
  normalizeArguments,
  ensureToolCallId,
  normalizeToolCalls,
};
