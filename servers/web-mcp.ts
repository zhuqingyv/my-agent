#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'web-mcp', version: '1.0.0' };
const DEFAULT_MAX_LENGTH = 10000;
const FETCH_TIMEOUT_MS = 15000;
const SEARCH_TIMEOUT_MS = 10000;
const UA = 'Mozilla/5.0 (compatible; web-mcp/1.0; +node)';

type Id = string | number | null;
interface Req { jsonrpc: '2.0'; id?: Id; method: string; params?: unknown }
interface Res { jsonrpc: '2.0'; id: Id; result?: unknown; error?: { code: number; message: string } }
export interface WebResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  transport?: 'node_fetch' | 'curl';
}

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
const execFileAsync = promisify(execFile);

function responseFromFetch(resp: Response): WebResponseLike {
  return {
    ok: resp.ok,
    status: resp.status,
    statusText: resp.statusText,
    headers: { get: (name: string) => resp.headers.get(name) },
    text: () => resp.text(),
    transport: 'node_fetch',
  };
}

async function fetchWithCurl(url: string, timeoutMs: number): Promise<WebResponseLike> {
  const marker = '\n__WEB_MCP_CURL_META__';
  const { stdout } = await execFileAsync(
    'curl',
    [
      '-L',
      '--silent',
      '--show-error',
      '--max-time',
      String(Math.ceil(timeoutMs / 1000)),
      '-A',
      UA,
      '-H',
      'Accept: text/html,text/plain,*/*',
      '-w',
      `${marker}%{http_code}\t%{content_type}`,
      url,
    ],
    { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
  );
  const idx = stdout.lastIndexOf(marker);
  const body = idx >= 0 ? stdout.slice(0, idx) : stdout;
  const meta = idx >= 0 ? stdout.slice(idx + marker.length) : '';
  const [statusRaw, contentType = ''] = meta.split('\t');
  const status = Number(statusRaw) || 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status ? `curl HTTP ${status}` : 'curl',
    headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? contentType : null },
    text: async () => body,
    transport: 'curl',
  };
}

function jsonResult(value: unknown, isError = false) {
  return ok(JSON.stringify(value, null, 2), isError);
}

function errorDetails(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = (e as Error & { cause?: unknown }).cause;
  const causeText = cause instanceof Error ? `${cause.message} ${(cause as any).code ?? ''}` : '';
  return `${e.message} ${causeText}`.trim();
}

function classifyError(e: unknown): string {
  const text = errorDetails(e).toUpperCase();
  if (text.includes('CERT') || text.includes('TLS') || text.includes('SSL')) return 'tls';
  if (text.includes('ENOTFOUND') || text.includes('ECONN') || text.includes('NETWORK') || text.includes('FETCH FAILED')) return 'network';
  return 'unknown';
}

export async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
  curlImpl: (url: string, timeoutMs: number) => Promise<WebResponseLike> = fetchWithCurl
): Promise<WebResponseLike> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const resp = await fetchImpl(url, { signal: ctl.signal, headers: { 'User-Agent': UA, 'Accept': 'text/html,text/plain,*/*' }, redirect: 'follow' });
    return responseFromFetch(resp);
  } catch (e) {
    if ((e as { name?: string }).name === 'AbortError') throw e;
    try {
      return await curlImpl(url, timeoutMs);
    } catch (curlError) {
      throw new Error(`Node fetch failed: ${errMsg(e)}; curl fallback failed: ${errMsg(curlError)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export function stripHtml(html: string): string {
  const noScript = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const noTags = noScript.replace(/<[^>]*>/g, ' ');
  const decoded = noTags
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ' '; } });
  return decoded.replace(/\s+/g, ' ').trim();
}

function extractTitle(htmlOrText: string): string | undefined {
  const m = htmlOrText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = m ? stripHtml(m[1]) : '';
  return title || undefined;
}

async function handleWebFetch(args: Record<string, unknown>) {
  const url = args.url;
  if (typeof url !== 'string' || !url) {
    return jsonResult({
      tool: 'web_fetch',
      status: 'error',
      error: { kind: 'invalid_args', message: '"url" must be a non-empty string' },
      suggested_next_action: 'Call web_fetch with a full http(s) URL.',
    }, true);
  }
  const maxLength = typeof args.maxLength === 'number' && args.maxLength > 0 ? Math.floor(args.maxLength) : DEFAULT_MAX_LENGTH;
  try {
    new URL(url);
  } catch {
    return jsonResult({
      tool: 'web_fetch',
      status: 'error',
      url,
      error: { kind: 'invalid_url', message: `Invalid URL: ${url}` },
      suggested_next_action: 'Use a complete URL copied from web_search results.',
    }, true);
  }
  try {
    const resp = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!resp.ok) {
      const kind = resp.status === 404 ? 'not_found' : 'http';
      return jsonResult({
        tool: 'web_fetch',
        status: 'error',
        url,
        transport: resp.transport ?? 'unknown',
        error: { kind, http_status: resp.status, message: `HTTP ${resp.status} ${resp.statusText}` },
        suggested_next_action: kind === 'not_found'
          ? 'Do not retry this URL. Choose another search result or use local tools if the answer may be in the workspace.'
          : 'Try another source URL, or use web_search with a more specific query.',
      }, true);
    }
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html') && !ct.includes('text/plain') && ct !== '') {
      return jsonResult({
        tool: 'web_fetch',
        status: 'error',
        url,
        transport: resp.transport ?? 'unknown',
        content_type: ct,
        error: { kind: 'unsupported_content_type', message: `Unsupported content-type: ${ct}` },
        suggested_next_action: 'Use a browser-readable HTML/text source, or a local command suited to this content type.',
      }, true);
    }
    const raw = await resp.text();
    const text = ct.includes('text/html') || (!ct && /<html/i.test(raw)) ? stripHtml(raw) : raw.replace(/\s+/g, ' ').trim();
    const truncated = text.length > maxLength;
    const body = truncated ? text.slice(0, maxLength) : text;
    return jsonResult({
      tool: 'web_fetch',
      status: 'ok',
      url,
      transport: resp.transport ?? 'unknown',
      content_type: ct || 'unknown',
      title: extractTitle(raw),
      content: body || '',
      truncated,
      original_length: text.length,
      max_length: maxLength,
      suggested_next_action: truncated
        ? 'If more detail is needed, call web_fetch again with a higher maxLength or a more specific source.'
        : 'Use this source content directly; avoid fetching the same URL again.',
    });
  } catch (e) {
    if ((e as { name?: string }).name === 'AbortError') {
      return jsonResult({
        tool: 'web_fetch',
        status: 'error',
        url,
        error: { kind: 'timeout', message: `Request timed out after ${FETCH_TIMEOUT_MS}ms` },
        suggested_next_action: 'Try another source URL or use local tools; do not immediately retry the same URL.',
      }, true);
    }
    return jsonResult({
      tool: 'web_fetch',
      status: 'error',
      url,
      error: { kind: classifyError(e), message: errorDetails(e) },
      suggested_next_action: 'Try another source URL, use web_search with a different query, or fall back to local tools.',
    }, true);
  }
}

export function parseDuckDuckGo(html: string, limit: number): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const blockRe = /<div[^>]*class="[^"]*result__body[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*result__body|$)/gi;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRe.exec(html)) !== null && results.length < limit) {
    const block = blockMatch[1];
    const linkMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    let href = linkMatch[1];
    const title = stripHtml(linkMatch[2]);
    const snippetMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const snippet = stripHtml(snippetMatch?.[1] ?? '');
    if (!title) continue;
    if (href.startsWith('//duckduckgo.com/l/') || href.startsWith('/l/')) {
      const u = href.startsWith('//') ? 'https:' + href : 'https://duckduckgo.com' + href;
      try {
        const parsed = new URL(u);
        const uddg = parsed.searchParams.get('uddg');
        if (uddg) href = decodeURIComponent(uddg);
      } catch { /* keep original */ }
    }
    results.push({ title, url: href, snippet });
  }
  return results;
}

async function handleWebSearch(args: Record<string, unknown>) {
  const query = args.query;
  if (typeof query !== 'string' || !query.trim()) {
    return jsonResult({
      tool: 'web_search',
      status: 'error',
      error: { kind: 'invalid_args', message: '"query" must be a non-empty string' },
      suggested_next_action: 'Call web_search with a concise search query.',
    }, true);
  }
  const rawLimit = typeof args.limit === 'number' ? Math.floor(args.limit) : 5;
  const limit = Math.max(1, Math.min(10, rawLimit));
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const resp = await fetchWithTimeout(url, SEARCH_TIMEOUT_MS);
    if (!resp.ok) {
      return jsonResult({
        tool: 'web_search',
        status: 'error',
        provider: 'duckduckgo_html',
        query,
        transport: resp.transport ?? 'unknown',
        error: { kind: 'http', http_status: resp.status, message: `HTTP ${resp.status} ${resp.statusText}` },
        suggested_next_action: 'Use a different query, or fall back to local tools such as grep, npm, gh, or package manager commands.',
      }, true);
    }
    const html = await resp.text();
    const results = parseDuckDuckGo(html, limit);
    if (results.length === 0) {
      return jsonResult({
        tool: 'web_search',
        status: 'ok',
        provider: 'duckduckgo_html',
        query,
        transport: resp.transport ?? 'unknown',
        results: [],
        suggested_next_action: 'No results. Try a more specific query or use local tools if this is a code/package question.',
      });
    }
    return jsonResult({
      tool: 'web_search',
      status: 'ok',
      provider: 'duckduckgo_html',
      query,
      transport: resp.transport ?? 'unknown',
      results,
      suggested_next_action: 'Choose the most relevant URL and call web_fetch once. Do not repeat the same query; refine it if needed.',
    });
  } catch (e) {
    if ((e as { name?: string }).name === 'AbortError') {
      return jsonResult({
        tool: 'web_search',
        status: 'error',
        provider: 'duckduckgo_html',
        query,
        error: { kind: 'timeout', message: `Search timed out after ${SEARCH_TIMEOUT_MS}ms` },
        suggested_next_action: 'Do not immediately retry the same query. Refine it or use local tools.',
      }, true);
    }
    return jsonResult({
      tool: 'web_search',
      status: 'error',
      provider: 'duckduckgo_html',
      query,
      error: { kind: classifyError(e), message: errorDetails(e) },
      suggested_next_action: 'Try one refined query, then fall back to local tools such as grep, npm, gh, or package manager commands.',
    }, true);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
