import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
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
        path: { type: 'string', description: '绝对或相对文件路径（必填，不能为空）。例如: ./package.json 或 src/index.ts' },
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
    description:
      'List entries under a directory. Skips node_modules/.git/dist by default. Set recursive=true to walk subdirectories.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径（必填，不能为空）。用 . 表示当前目录。例如: . 或 ./src' },
        recursive: {
          type: 'boolean',
          description: 'Recurse into subdirectories (default false).',
          default: false,
        },
        maxEntries: {
          type: 'number',
          description: 'Max entries to return (default 200).',
          default: 200,
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_image',
    description: '读取图片文件并返回 base64 data URL，用于图片分析。最大支持 5MB。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '图片文件路径（必填）。' },
      },
      required: ['path'],
    },
  },
];

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function imageMime(ext: string): string {
  if (ext === '.jpg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.ico') return 'image/x-icon';
  return `image/${ext.slice(1)}`;
}

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
    return textResult('请提供文件路径，例如: read_file(path: "./package.json")', true);
  }
  const ext = extname(path).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) {
    try {
      const st = statSync(path);
      const mime = imageMime(ext);
      return textResult(
        `[图片文件] ${path}\n` +
          `格式: ${mime}\n` +
          `大小: ${Math.round(st.size / 1024)}KB\n` +
          `提示: 这是一个图片文件，无法以文本形式读取。如需分析图片内容，请使用 read_image 获取 base64 data URL，或让用户通过剪贴板粘贴图片。`,
      );
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        return textResult(`文件不存在: ${path}`, true);
      }
      const msg = err instanceof Error ? err.message : String(err);
      return textResult(`read_file failed: ${msg}`, true);
    }
  }
  try {
    const content = readFileSync(path, { encoding: encoding as BufferEncoding });
    return textResult(content);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return textResult(`文件不存在: ${path}`, true);
    }
    if (code === 'EISDIR') {
      return textResult(`不是文件（是目录）: ${path}`, true);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return textResult(`read_file failed: ${msg}`, true);
  }
}

function handleReadImage(args: Record<string, unknown>) {
  const path = args.path;
  if (typeof path !== 'string' || path.length === 0) {
    return textResult('请提供图片文件路径', true);
  }
  const ext = extname(path).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) {
    return textResult(`不是图片文件: ${path}`, true);
  }
  try {
    const buf = readFileSync(path);
    if (buf.length > MAX_IMAGE_BYTES) {
      return textResult(
        `图片太大（${Math.round(buf.length / 1024 / 1024)}MB），最大支持 5MB`,
        true,
      );
    }
    const mime = imageMime(ext);
    return textResult(`data:${mime};base64,${buf.toString('base64')}`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return textResult(`文件不存在: ${path}`, true);
    }
    if (code === 'EISDIR') {
      return textResult(`不是文件（是目录）: ${path}`, true);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return textResult(`read_image failed: ${msg}`, true);
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

interface WalkResult {
  lines: string[];
  truncated: boolean;
  total: number;
}

function walk(root: string, recursive: boolean, maxEntries: number): WalkResult {
  const lines: string[] = [];
  let total = 0;
  let truncated = false;

  const visit = (dir: string) => {
    if (truncated) return;
    const entries = readdirSync(dir);
    for (const name of entries) {
      if (truncated) return;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      const rel = relative(root, full) || name;
      if (st.isDirectory()) {
        total += 1;
        if (IGNORED_DIRS.has(name)) {
          if (lines.length < maxEntries) lines.push(`[dir] ${rel}/ (skipped)`);
          else truncated = true;
          continue;
        }
        if (lines.length < maxEntries) lines.push(`[dir] ${rel}/`);
        else {
          truncated = true;
          continue;
        }
        if (recursive) visit(full);
      } else if (st.isFile()) {
        total += 1;
        if (lines.length < maxEntries) lines.push(`[file] ${rel}`);
        else truncated = true;
      }
    }
  };
  visit(root);
  return { lines, truncated, total };
}

function handleListDirectory(args: Record<string, unknown>) {
  const path = (typeof args.path === 'string' && args.path.length > 0) ? args.path : '.';
  const recursive = args.recursive === true;
  const maxEntries =
    typeof args.maxEntries === 'number' && args.maxEntries > 0
      ? Math.floor(args.maxEntries)
      : 200;
  try {
    const st = statSync(path);
    if (!st.isDirectory()) {
      return textResult(`不是目录（是文件）: ${path}`, true);
    }
    const { lines, truncated, total } = walk(path, recursive, maxEntries);
    if (truncated) {
      const remaining = total - lines.length;
      lines.push(`[...truncated, ${remaining} more entries]`);
    }
    return textResult(lines.join('\n'));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return textResult(`目录不存在: ${path}`, true);
    }
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
    case 'read_image':
      return handleReadImage(args);
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
