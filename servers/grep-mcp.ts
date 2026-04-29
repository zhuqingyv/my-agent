import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';

type Id = string | number | null;
interface Req { jsonrpc: '2.0'; id?: Id; method: string; params?: unknown }
interface Res { jsonrpc: '2.0'; id: Id; result?: unknown; error?: { code: number; message: string } }

const MAX_LINES = 100;

const TOOLS = [
  { name: 'grep',
    description: '在文件中搜索文本模式，返回匹配行和行号。调用系统 grep（默认递归），截断前 100 行。',
    inputSchema: { type: 'object', required: ['pattern', 'path'], properties: {
      pattern: { type: 'string', description: '搜索模式（正则或纯文本）' },
      path: { type: 'string', description: '文件或目录路径' },
      recursive: { type: 'boolean', description: '是否递归搜索子目录（默认 true；保留参数向后兼容）', default: true },
    } } },
];

const send = (r: Res) => process.stdout.write(JSON.stringify(r) + '\n');
const log = (...a: unknown[]) => process.stderr.write('[grep-mcp] ' + a.map(String).join(' ') + '\n');
const ok = (text: string, isError = false) => ({ content: [{ type: 'text', text }], isError });
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v)) ? v as Record<string, unknown> : {};
const errMsg = (e: unknown) => e instanceof Error ? e.message : String(e);

function handleGrep(args: Record<string, unknown>) {
  const pattern = args.pattern;
  const path = args.path;
  if (typeof pattern !== 'string' || !pattern) return ok('grep: "pattern" must be a non-empty string', true);
  if (typeof path !== 'string' || !path) return ok('grep: "path" must be a non-empty string', true);
  const flags = ['-rn', '-E', '--'];
  try {
    const out = execFileSync('grep', [...flags, pattern, path], {
      encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024, timeout: 20000,
    });
    const lines = out.split('\n').filter((l) => l.length > 0);
    const head = lines.slice(0, MAX_LINES);
    const truncated = lines.length > MAX_LINES;
    const body = head.join('\n');
    return ok(truncated ? `${body}\n[...truncated, ${lines.length - MAX_LINES} more matches]` : (body || '（无匹配）'));
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 1) return ok('（无匹配）');
    return ok(`grep failed: ${errMsg(e)}`, true);
  }
}

function handleRequest(req: Req): void {
  const id = req.id ?? null;
  try {
    if (req.method === 'initialize') {
      send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'grep-mcp', version: '1.0.0' } } });
      return;
    }
    if (req.method === 'notifications/initialized') return;
    if (req.method === 'tools/list') { send({ jsonrpc: '2.0', id, result: { tools: TOOLS } }); return; }
    if (req.method === 'tools/call') {
      const p = rec(req.params);
      const name = typeof p.name === 'string' ? p.name : '';
      const result = name === 'grep' ? handleGrep(rec(p.arguments)) : ok(`unknown tool: ${name}`, true);
      send({ jsonrpc: '2.0', id, result });
      return;
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${req.method}` } });
  } catch (e) {
    log('request handler error:', errMsg(e));
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: errMsg(e) } });
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  let msg: Req;
  try { msg = JSON.parse(t) as Req; }
  catch (e) {
    log('parse error:', errMsg(e), 'line:', t);
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: `parse error: ${errMsg(e)}` } });
    return;
  }
  handleRequest(msg);
});
rl.on('close', () => process.exit(0));
