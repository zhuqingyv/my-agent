#!/usr/bin/env node
import { createInterface } from 'node:readline';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'web-mcp', version: '1.0.0' };
const DEFAULT_MAX_LENGTH = 10000;
const FETCH_TIMEOUT_MS = 15000;
const SEARCH_TIMEOUT_MS = 10000;
const UA = 'Mozilla/5.0 (compatible; web-mcp/1.0; +node)';

type Id = string | number | null;
interface Req { jsonrpc: '2.0'; id?: Id; method: string; params?: unknown }
interface Res { jsonrpc: '2.0'; id: Id; result?: unknown; error?: { code: number; message: string } }

const TOOLS = [
  {
    name: 'web_fetch',
    description: '抓取网页内容，返回纯文本。用于查文档、读 API 参考等。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要抓取的 URL' },
        maxLength: { type: 'number', description: '最大返回字符数（默认 10000）' },
      },
      required: ['url'],
    },
  },
  {
    name: 'web_search',
    description: '使用 DuckDuckGo 搜索，返回前 5 条结果的标题和 URL。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        limit: { type: 'number', description: '结果数量（默认 5，最多 10）' },
      },
      required: ['query'],
    },
  },
];

const send = (r: Res) => process.stdout.write(JSON.stringify(r) + '\n');
const log = (...a: unknown[]) => process.stderr.write('[web-mcp] ' + a.map(String).join(' ') + '\n');
const ok = (text: string, isError = false) => ({ content: [{ type: 'text', text }], isError });
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v)) ? v as Record<string, unknown> : {};
const errMsg = (e: unknown) => e instanceof Error ? e.message : String(e);

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, 'Accept': 'text/html,text/plain,*/*' }, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(html: string): string {
  const noScript = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const noTags = noScript.replace(/<[^>]*>/g, ' ');
  const decoded = noTags
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ' '; } });
  return decoded.replace(/\s+/g, ' ').trim();
}

async function handleWebFetch(args: Record<string, unknown>) {
  const url = args.url;
  if (typeof url !== 'string' || !url) return ok('web_fetch: "url" must be a non-empty string', true);
  const maxLength = typeof args.maxLength === 'number' && args.maxLength > 0 ? Math.floor(args.maxLength) : DEFAULT_MAX_LENGTH;
  try {
    new URL(url);
  } catch {
    return ok(`web_fetch: 无效 URL: ${url}`, true);
  }
  try {
    const resp = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!resp.ok) return ok(`web_fetch: HTTP ${resp.status} ${resp.statusText}`, true);
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html') && !ct.includes('text/plain') && ct !== '') {
      return ok(`web_fetch: 不支持的 content-type: ${ct}（仅支持 text/html 和 text/plain）`, true);
    }
    const raw = await resp.text();
    const text = ct.includes('text/html') || (!ct && /<html/i.test(raw)) ? stripHtml(raw) : raw.replace(/\s+/g, ' ').trim();
    const truncated = text.length > maxLength;
    const body = truncated ? text.slice(0, maxLength) + `\n\n[...已截断，原长 ${text.length} 字符，当前上限 ${maxLength}]` : text;
    return ok(body || '（空白内容）');
  } catch (e) {
    if ((e as { name?: string }).name === 'AbortError') return ok(`web_fetch: 请求超时（${FETCH_TIMEOUT_MS}ms）`, true);
    return ok(`web_fetch failed: ${errMsg(e)}`, true);
  }
}

function parseDuckDuckGo(html: string, limit: number): Array<{ title: string; url: string }> {
  const results: Array<{ title: string; url: string }> = [];
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && results.length < limit) {
    let href = m[1];
    const title = stripHtml(m[2]);
    if (!title) continue;
    if (href.startsWith('//duckduckgo.com/l/') || href.startsWith('/l/')) {
      const u = href.startsWith('//') ? 'https:' + href : 'https://duckduckgo.com' + href;
      try {
        const parsed = new URL(u);
        const uddg = parsed.searchParams.get('uddg');
        if (uddg) href = decodeURIComponent(uddg);
      } catch { /* keep original */ }
    }
    results.push({ title, url: href });
  }
  return results;
}

async function handleWebSearch(args: Record<string, unknown>) {
  const query = args.query;
  if (typeof query !== 'string' || !query.trim()) return ok('web_search: "query" must be a non-empty string', true);
  const rawLimit = typeof args.limit === 'number' ? Math.floor(args.limit) : 5;
  const limit = Math.max(1, Math.min(10, rawLimit));
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const resp = await fetchWithTimeout(url, SEARCH_TIMEOUT_MS);
    if (!resp.ok) return ok(`web_search: HTTP ${resp.status} ${resp.statusText}`, true);
    const html = await resp.text();
    const results = parseDuckDuckGo(html, limit);
    if (results.length === 0) return ok(`web_search: 无结果（query: ${query}）`);
    const body = results.map((r, i) => `${i + 1}. [${r.title}](${r.url})`).join('\n');
    return ok(body);
  } catch (e) {
    if ((e as { name?: string }).name === 'AbortError') return ok(`web_search: 搜索超时（${SEARCH_TIMEOUT_MS}ms）`, true);
    return ok(`web_search failed: ${errMsg(e)}`, true);
  }
}

async function handleRequest(req: Req): Promise<void> {
  if (req.method === 'notifications/initialized') return;
  const id = req.id ?? null;
  try {
    if (req.method === 'initialize') {
      send({ jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO } });
      return;
    }
    if (req.method === 'tools/list') { send({ jsonrpc: '2.0', id, result: { tools: TOOLS } }); return; }
    if (req.method === 'tools/call') {
      const p = rec(req.params);
      const name = typeof p.name === 'string' ? p.name : '';
      const args = rec(p.arguments);
      let result;
      if (name === 'web_fetch') result = await handleWebFetch(args);
      else if (name === 'web_search') result = await handleWebSearch(args);
      else result = ok(`unknown tool: ${name}`, true);
      send({ jsonrpc: '2.0', id, result });
      return;
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${req.method}` } });
  } catch (e) {
    log('request handler error:', errMsg(e));
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: errMsg(e) } });
  }
}

function main(): void {
  const rl = createInterface({ input: process.stdin });
  let pending = 0;
  let stdinClosed = false;
  const maybeExit = () => { if (stdinClosed && pending === 0) process.exit(0); };

  rl.on('line', (line) => {
    const t = line.trim();
    if (!t) return;
    let msg: Req;
    try { msg = JSON.parse(t) as Req; }
    catch (e) { log('parse error:', errMsg(e), 'line:', t); return; }
    pending++;
    handleRequest(msg)
      .catch((e) => log('unhandled error:', errMsg(e)))
      .finally(() => { pending--; maybeExit(); });
  });
  rl.on('close', () => { stdinClosed = true; maybeExit(); });
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}

main();
