import type { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';

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

export function normalizeArguments(raw: unknown): Record<string, any> {
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
export function ensureToolCallId(id: string | undefined | null): string {
  if (id && typeof id === 'string' && id.trim()) return id;
  callIdCounter += 1;
  return `call_${Date.now().toString(36)}_${callIdCounter}`;
}

export function normalizeToolCalls(
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
          typeof fn.arguments === 'string' && fn.arguments.trim()
            ? fn.arguments
            : JSON.stringify(fn.arguments ?? {}),
      },
    });
  }
  return out.length > 0 ? out : null;
}
