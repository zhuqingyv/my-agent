import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface ChatOptions {
  tools?: any[];
  timeout?: number;
  temperature?: number;
}

export interface ChatResult {
  content: string;
  toolCalls: any[];
  finishReason: string;
  reasoning: string;
}

function loadModel(): { baseURL: string; model: string; apiKey: string } {
  const p = path.join(os.homedir(), '.my-agent', 'config.json');
  const m = (JSON.parse(fs.readFileSync(p, 'utf-8')).model ?? {}) as any;
  if (!m.baseURL || !m.model) throw new Error(`bad model in ${p}`);
  return { baseURL: m.baseURL, model: m.model, apiKey: m.apiKey ?? 'lm-studio' };
}

export async function chatCompletion(
  messages: any[],
  opts: ChatOptions = {}
): Promise<ChatResult> {
  const { baseURL, model, apiKey } = loadModel();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeout ?? 60000);
  const body: Record<string, any> = { model, messages, stream: false };
  if (opts.tools?.length) body.tools = opts.tools;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as any;
    const choice = data.choices?.[0] ?? {};
    const msg = choice.message ?? {};
    return {
      content: msg.content ?? '',
      toolCalls: msg.tool_calls ?? [],
      finishReason: choice.finish_reason ?? '',
      reasoning: msg.reasoning_content ?? '',
    };
  } finally {
    clearTimeout(timer);
  }
}
