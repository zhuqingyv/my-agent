#!/usr/bin/env node
import { spawn, execSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const RTK_COMMANDS = ['git', 'ls', 'tree', 'find', 'grep', 'cat', 'head', 'tail',
  'npm', 'cargo', 'pip', 'docker', 'kubectl', 'ps', 'df', 'du'];
const MAX_OUTPUT = 30000;
const TRUNCATE_NOTICE = '\n\n[...输出过长，已截断。建议用 head/tail/grep 筛选]';
const SIGKILL_DELAY_MS = 5000;
const DEFAULT_TIMEOUT_MS = 30000;
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'exec-mcp', version: '2.0.0' };

const RTK_AVAILABLE = (() => {
  try { execSync('which rtk', { stdio: 'ignore' }); return true; } catch { return false; }
})();

function wrapWithRtk(command: string): string {
  if (!RTK_AVAILABLE) return command;
  const first = command.trim().split(/\s/)[0];
  return RTK_COMMANDS.includes(first) ? `rtk ${command}` : command;
}

interface JsonRpcRequest { jsonrpc: '2.0'; id?: number | string; method: string; params?: any; }
interface JsonRpcResponse { jsonrpc: '2.0'; id: number | string; result?: any; error?: { code: number; message: string; data?: any }; }

const EXECUTE_COMMAND_TOOL = {
  name: 'execute_command',
  description: 'Execute a shell command and return combined stdout/stderr output',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      cwd: { type: 'string', description: 'Working directory (optional)' },
      timeout: { type: 'number', description: 'Timeout in ms (default 30000)' },
    },
    required: ['command'],
  },
};

function logErr(...args: unknown[]): void {
  process.stderr.write(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n');
}
function send(msg: JsonRpcResponse): void { process.stdout.write(JSON.stringify(msg) + '\n'); }
function sendError(id: number | string, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

interface ExecArgs { command: string; cwd?: string; timeout?: number; }
interface RunResult { text: string; isError: boolean; }

function runCommand(args: ExecArgs): Promise<RunResult> {
  return new Promise((resolve) => {
    const timeout = typeof args.timeout === 'number' && args.timeout > 0 ? args.timeout : DEFAULT_TIMEOUT_MS;
    const cwd = args.cwd || process.cwd();
    const actualCommand = wrapWithRtk(args.command);

    let output = '';
    let truncated = false;
    let timedOut = false;
    let sigkilled = false;

    const proc = spawn('bash', ['-c', actualCommand], {
      cwd,
      env: { ...process.env, LANG: 'en_US.UTF-8' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const append = (chunk: Buffer | string) => {
      if (output.length >= MAX_OUTPUT) { truncated = true; return; }
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const remaining = MAX_OUTPUT - output.length;
      if (s.length > remaining) { output += s.slice(0, remaining); truncated = true; }
      else { output += s; }
    };

    proc.stdout?.on('data', append);
    proc.stderr?.on('data', append);

    let killTimer: NodeJS.Timeout | null = null;
    const termTimer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (!proc.killed) { sigkilled = true; proc.kill('SIGKILL'); }
      }, SIGKILL_DELAY_MS);
    }, timeout);

    proc.on('error', (err) => {
      clearTimeout(termTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ text: `命令启动失败: ${err.message}`, isError: true });
    });

    proc.on('close', (code, signal) => {
      clearTimeout(termTimer);
      if (killTimer) clearTimeout(killTimer);
      const finalText = truncated ? output + TRUNCATE_NOTICE : output;

      if (timedOut) {
        const msg = sigkilled
          ? `命令被强制终止（超时 ${timeout}ms 后未响应 SIGTERM）`
          : `命令执行超时（${timeout}ms）。建议缩小命令范围或增加超时时间。`;
        resolve({ text: finalText.length > 0 ? `${msg}\n\n${finalText}` : msg, isError: true });
        return;
      }
      if (code !== 0 && code !== null) {
        const snippet = finalText.slice(0, 200);
        resolve({
          text: `命令失败（退出码 ${code}）\n${snippet}${finalText.length > 200 ? '\n...' : ''}`,
          isError: true,
        });
        return;
      }
      if (signal) { resolve({ text: `命令被信号终止: ${signal}\n${finalText}`, isError: true }); return; }
      resolve({ text: finalText, isError: false });
    });
  });
}

async function handleToolsCall(params: any): Promise<any> {
  const name = params?.name;
  const args = params?.arguments || {};
  if (name !== 'execute_command') {
    return { content: [{ type: 'text', text: `Error: unknown tool "${name}"` }], isError: true };
  }
  if (!args.command || typeof args.command !== 'string' || args.command.trim().length === 0) {
    return {
      content: [{ type: 'text', text: '请提供要执行的命令，例如: execute_command(command: "ls -la")' }],
      isError: true,
    };
  }
  const { text, isError } = await runCommand({
    command: args.command,
    cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
    timeout: typeof args.timeout === 'number' ? args.timeout : undefined,
  });
  return { content: [{ type: 'text', text: text || '(no output)' }], isError };
}

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  if (req.method === 'notifications/initialized') return;
  if (req.id === undefined) return;
  try {
    switch (req.method) {
      case 'initialize':
        send({ jsonrpc: '2.0', id: req.id, result: {
          protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO,
        }});
        return;
      case 'tools/list':
        send({ jsonrpc: '2.0', id: req.id, result: { tools: [EXECUTE_COMMAND_TOOL] } });
        return;
      case 'tools/call': {
        const result = await handleToolsCall(req.params);
        send({ jsonrpc: '2.0', id: req.id, result });
        return;
      }
      default:
        sendError(req.id, -32601, `Method not found: ${req.method}`);
    }
  } catch (e) {
    sendError(req.id, -32603, `Internal error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function main(): void {
  if (!RTK_AVAILABLE) logErr('[exec-mcp] rtk not found, running commands without compression');
  const rl = createInterface({ input: process.stdin });
  let pending = 0;
  let stdinClosed = false;
  const maybeExit = () => { if (stdinClosed && pending === 0) process.exit(0); };

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: JsonRpcRequest;
    try { req = JSON.parse(trimmed); }
    catch (e) { logErr('parse error:', (e as Error).message); return; }
    pending++;
    handleRequest(req)
      .catch((e) => logErr('unhandled error:', e instanceof Error ? e.message : String(e)))
      .finally(() => { pending--; maybeExit(); });
  });
  rl.on('close', () => { stdinClosed = true; maybeExit(); });
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}

main();
