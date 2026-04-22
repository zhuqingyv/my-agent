import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { createInterface } from 'node:readline';

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a file from disk and return its contents.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to read.' },
        encoding: {
          type: 'string',
          description: 'Text encoding (default "utf-8").',
          default: 'utf-8',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file, creating parent directories if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to write.' },
        content: { type: 'string', description: 'Content to write.' },
        encoding: {
          type: 'string',
          description: 'Text encoding (default "utf-8").',
          default: 'utf-8',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description: 'List entries under a directory. Set recursive=true to walk subdirectories.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list.' },
        recursive: {
          type: 'boolean',
          description: 'Recurse into subdirectories (default false).',
          default: false,
        },
      },
      required: ['path'],
    },
  },
];

function send(response: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(response) + '\n');
}

function log(...args: unknown[]): void {
  process.stderr.write('[fs-mcp] ' + args.map(String).join(' ') + '\n');
}

function textResult(text: string, isError = false) {
  return {
    content: [{ type: 'text', text }],
    isError,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function handleReadFile(args: Record<string, unknown>) {
  const path = args.path;
  const encoding = typeof args.encoding === 'string' ? args.encoding : 'utf-8';
  if (typeof path !== 'string' || path.length === 0) {
    return textResult('read_file: "path" must be a non-empty string', true);
  }
  try {
    const content = readFileSync(path, { encoding: encoding as BufferEncoding });
    return textResult(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return textResult(`read_file failed: ${msg}`, true);
  }
}

function handleWriteFile(args: Record<string, unknown>) {
  const path = args.path;
  const content = args.content;
  const encoding = typeof args.encoding === 'string' ? args.encoding : 'utf-8';
  if (typeof path !== 'string' || path.length === 0) {
    return textResult('write_file: "path" must be a non-empty string', true);
  }
  if (typeof content !== 'string') {
    return textResult('write_file: "content" must be a string', true);
  }
  try {
    const parent = dirname(path);
    if (parent && parent !== '.' && parent !== '/') {
      mkdirSync(parent, { recursive: true });
    }
    writeFileSync(path, content, { encoding: encoding as BufferEncoding });
    const bytes = Buffer.byteLength(content, encoding as BufferEncoding);
    return textResult(`wrote ${bytes} bytes to ${path}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return textResult(`write_file failed: ${msg}`, true);
  }
}

function walk(root: string, recursive: boolean): string[] {
  const lines: string[] = [];
  const visit = (dir: string) => {
    const entries = readdirSync(dir);
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      const rel = relative(root, full) || name;
      if (st.isDirectory()) {
        lines.push(`[dir] ${rel}/`);
        if (recursive) visit(full);
      } else if (st.isFile()) {
        lines.push(`[file] ${rel}`);
      }
    }
  };
  visit(root);
  return lines;
}

function handleListDirectory(args: Record<string, unknown>) {
  const path = args.path;
  const recursive = args.recursive === true;
  if (typeof path !== 'string' || path.length === 0) {
    return textResult('list_directory: "path" must be a non-empty string', true);
  }
  try {
    const st = statSync(path);
    if (!st.isDirectory()) {
      return textResult(`list_directory: not a directory: ${path}`, true);
    }
    const lines = walk(path, recursive);
    return textResult(lines.join('\n'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return textResult(`list_directory failed: ${msg}`, true);
  }
}

function dispatchToolCall(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'read_file':
      return handleReadFile(args);
    case 'write_file':
      return handleWriteFile(args);
    case 'list_directory':
      return handleListDirectory(args);
    default:
      return textResult(`unknown tool: ${name}`, true);
  }
}

function handleRequest(req: JsonRpcRequest): void {
  const id = req.id ?? null;
  try {
    switch (req.method) {
      case 'initialize':
        send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'fs-mcp', version: '1.0.0' },
          },
        });
        return;

      case 'notifications/initialized':
        return;

      case 'tools/list':
        send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
        return;

      case 'tools/call': {
        const params = asRecord(req.params);
        const name = typeof params.name === 'string' ? params.name : '';
        const args = asRecord(params.arguments);
        const result = dispatchToolCall(name, args);
        send({ jsonrpc: '2.0', id, result });
        return;
      }

      default:
        send({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `method not found: ${req.method}` },
        });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('request handler error:', msg);
    send({
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: msg },
    });
  }
}

function main(): void {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: JsonRpcRequest;
    try {
      msg = JSON.parse(trimmed) as JsonRpcRequest;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log('parse error:', errMsg, 'line:', trimmed);
      send({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: `parse error: ${errMsg}` },
      });
      return;
    }
    handleRequest(msg);
  });
  rl.on('close', () => {
    process.exit(0);
  });
}

main();
