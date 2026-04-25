import type OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

const COMPACT_INSTRUCTION = `你是对话压缩器。把下面的对话压成 ≤300 字的中文摘要，必须覆盖 4 点：
1) 用户关键需求（做什么、边界是什么）
2) 已完成结论（已确认的事实、决定）
3) 悬挂问题（未完成、待决、有争议的点）
4) 工具调用重要产出（路径、关键数据、错误）
不要客套、不要解释、只输出摘要正文。`;

const SNIPPET_LIMIT = 500;

function roleLabel(role: string): string {
  switch (role) {
    case 'system':
      return 'SYS';
    case 'user':
      return 'USER';
    case 'assistant':
      return 'ASSISTANT';
    case 'tool':
      return 'TOOL';
    default:
      return role.toUpperCase();
  }
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const p of content) {
      if (!p || typeof p !== 'object') continue;
      const part = p as any;
      if (part.type === 'text' && typeof part.text === 'string') {
        parts.push(part.text);
      } else if (part.type === 'image_url') {
        parts.push('[image]');
      }
    }
    return parts.join('\n');
  }
  return '';
}

function renderMessage(msg: ChatCompletionMessageParam): string {
  const role = roleLabel((msg as any).role);
  let body = stringifyContent((msg as any).content);
  const toolCalls = (msg as any).tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    const calls = toolCalls
      .map((tc: any) => {
        const name = tc?.function?.name ?? '?';
        const args = tc?.function?.arguments ?? '';
        return `${name}(${String(args).slice(0, 120)})`;
      })
      .join('; ');
    body = body ? `${body}\n[tool_calls] ${calls}` : `[tool_calls] ${calls}`;
  }
  const snippet = body.slice(0, SNIPPET_LIMIT);
  return `${role}: ${snippet}`;
}

export async function summarizeRange(
  client: OpenAI,
  model: string,
  msgs: ChatCompletionMessageParam[],
  signal?: AbortSignal
): Promise<string> {
  if (msgs.length === 0) return '';

  const joined = msgs.map(renderMessage).join('\n\n');
  const payload: ChatCompletionMessageParam[] = [
    { role: 'system', content: COMPACT_INSTRUCTION },
    { role: 'user', content: joined },
  ];

  const resp = await client.chat.completions.create(
    {
      model,
      messages: payload,
      temperature: 0.2,
      stream: false,
    },
    signal ? { signal } : undefined
  );

  const choice = (resp as any)?.choices?.[0]?.message?.content;
  if (typeof choice !== 'string') return '';
  return choice.trim();
}
