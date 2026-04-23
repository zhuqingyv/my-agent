#!/usr/bin/env node
import { exec, execSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const RTK_COMMANDS = [
  'git',
  'ls',
  'tree',
  'find',
  'grep',
  'cat',
  'head',
  'tail',
  'npm',
  'cargo',
  'pip',
  'docker',
  'kubectl',
  'ps',
  'df',
  'du',
];

function detectRtk(): boolean {
  try {
    execSync('which rtk', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const RTK_AVAILABLE = detectRtk();

function wrapWithRtk(command: string): string {
  if (!RTK_AVAILABLE) return command;
  const firstWord = command.trim().split(/\s/)[0];
  if (RTK_COMMANDS.includes(firstWord)) {
    return `rtk ${command}`;
  }
  return command;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

const SERVER_INFO = { name: 'exec-mcp', version: '1.0.0' };
const PROTOCOL_VERSION = '2024-11-05';

const EXECUTE_COMMAND_TOOL = {
  name: 'execute_command',
  description: 'Execute a shell command and return output',
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

function send(msg: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function sendError(id: number | string, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

interface ExecArgs {
  command: string;
  cwd?: string;
  timeout?: number;
}

function runCommand(args: ExecArgs): Promise<{ text: string; isError: boolean }> {
  return new Promise((resolve) => {
    const timeout = typeof args.timeout === 'number' && args.timeout > 0 ? args.timeout : 30000;
    const cwd = args.cwd || process.cwd();

    const actualCommand = wrapWithRtk(args.command);

    exec(
      actualCommand,
      { cwd, timeout, maxBuffer: 128 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const out = (stdout || '').toString();
        const errOut = (stderr || '').toString();
        const combined = [out, errOut].filter((s) => s.length > 0).join(out && errOut ? '\n' : '');

        if (err) {
          const killed = (err as NodeJS.ErrnoException & { killed?: boolean }).killed;
          const signal = (err as NodeJS.ErrnoException & { signal?: string }).signal;
          const code = (err as NodeJS.ErrnoException & { code?: number | string }).code;
          let text: string;
          if (killed && signal === 'SIGTERM') {
            text = `命令执行超时（${timeout}ms）。建议：使用更精确的命令或增加超时时间。`;
          } else {
            const stderrSnippet = errOut.slice(0, 200);
            text = `命令失败（退出码 ${code}）: ${stderrSnippet}`;
          }
          resolve({ text, isError: true });
          return;
        }

        resolve({ text: combined, isError: false });
      },
    );
  });
}

async function handleToolsCall(params: any): Promise<any> {
  const name = params?.name;
  const args = params?.arguments || {};

  if (name !== 'execute_command') {
    return {
      content: [{ type: 'text', text: `Error: unknown tool "${name}"` }],
      isError: true,
    };
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

  return {
    content: [{ type: 'text', text: text || '(no output)' }],
    isError,
  };
}

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  if (req.method === 'notifications/initialized') {
    return;
  }

  if (req.id === undefined) {
    return;
  }

  try {
    switch (req.method) {
      case 'initialize':
        send({
          jsonrpc: '2.0',
          id: req.id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          },
        });
        return;

      case 'tools/list':
        send({
          jsonrpc: '2.0',
          id: req.id,
          result: { tools: [EXECUTE_COMMAND_TOOL] },
        });
        return;

      case 'tools/call': {
        const result = await handleToolsCall(req.params);
        send({ jsonrpc: '2.0', id: req.id, result });
        return;
      }

      default:
        sendError(req.id, -32601, `Method not found: ${req.method}`);
        return;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    sendError(req.id, -32603, `Internal error: ${message}`);
  }
}

function main(): void {
  if (!RTK_AVAILABLE) {
    logErr('[exec-mcp] rtk not found, running commands without compression');
  }

  const rl = createInterface({ input: process.stdin });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed);
    } catch (e) {
      logErr('parse error:', (e as Error).message);
      return;
    }

    handleRequest(req).catch((e) => {
      logErr('unhandled error:', e instanceof Error ? e.message : String(e));
    });
  });

  rl.on('close', () => {
    process.exit(0);
  });

  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}

main();
