import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { McpClient } from '../src/mcp/client.js';

function fakeProc() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const proc = new EventEmitter() as any;
  proc.stdin = stdin;
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.exitCode = null;
  proc.signalCode = null;
  proc.kill = () => true;
  return proc;
}

function readSentLines(stdin: PassThrough): Promise<string[]> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    stdin.on('data', (chunk) => {
      const s = chunk.toString('utf-8');
      for (const line of s.split('\n')) {
        if (line.trim()) lines.push(line);
      }
    });
    setTimeout(() => resolve(lines), 20);
  });
}

test('McpClient.request: round-trip via id matching', async () => {
  const proc = fakeProc();
  const client = new McpClient('exec', proc);

  const sentPromise = readSentLines(proc.stdin);
  const pending = client.request('ping', { hello: 1 });

  const sent = await sentPromise;
  assert.equal(sent.length, 1);
  const msg = JSON.parse(sent[0]);
  assert.equal(msg.method, 'ping');
  assert.deepEqual(msg.params, { hello: 1 });
  assert.equal(msg.jsonrpc, '2.0');
  assert.equal(typeof msg.id, 'number');

  proc.stdout.write(
    JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { pong: true } }) + '\n'
  );

  const result = await pending;
  assert.deepEqual(result, { pong: true });
});

test('McpClient.request: error response rejects', async () => {
  const proc = fakeProc();
  const client = new McpClient('exec', proc);

  const sentPromise = readSentLines(proc.stdin);
  const pending = client.request('bad', {});

  const sent = await sentPromise;
  const msg = JSON.parse(sent[0]);
  proc.stdout.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -1, message: 'nope' },
    }) + '\n'
  );

  await assert.rejects(pending, /nope/);
});

test('McpClient: buffers partial chunks by newline', async () => {
  const proc = fakeProc();
  const client = new McpClient('exec', proc);

  const sentPromise = readSentLines(proc.stdin);
  const p1 = client.request('a');
  const p2 = client.request('b');
  const sent = await sentPromise;
  const [m1, m2] = sent.map((s) => JSON.parse(s));

  const payload =
    JSON.stringify({ jsonrpc: '2.0', id: m1.id, result: 1 }) +
    '\n' +
    JSON.stringify({ jsonrpc: '2.0', id: m2.id, result: 2 }).slice(0, 10);
  proc.stdout.write(payload);

  const rest =
    JSON.stringify({ jsonrpc: '2.0', id: m2.id, result: 2 }).slice(10) + '\n';
  proc.stdout.write(rest);

  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, 1);
  assert.equal(r2, 2);
});

test('McpClient.listTools: populates tools from tools/list', async () => {
  const proc = fakeProc();
  const client = new McpClient('exec', proc);

  proc.stdout.on('data', () => {});

  const sentListener = new Promise<void>((resolve) => {
    proc.stdin.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf-8').split('\n')) {
        if (!line.trim()) continue;
        const m = JSON.parse(line);
        if (m.method === 'tools/list') {
          proc.stdout.write(
            JSON.stringify({
              jsonrpc: '2.0',
              id: m.id,
              result: {
                tools: [
                  { name: 'run', description: 'run cmd', inputSchema: { type: 'object' } },
                ],
              },
            }) + '\n'
          );
          resolve();
        }
      }
    });
  });

  const p = client.listTools();
  await sentListener;
  const tools = await p;
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'run');
  assert.equal(client.tools.length, 1);
});

test('McpClient.call: parses content array into joined text', async () => {
  const proc = fakeProc();
  const client = new McpClient('exec', proc);

  proc.stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf-8').split('\n')) {
      if (!line.trim()) continue;
      const m = JSON.parse(line);
      if (m.method === 'tools/call') {
        proc.stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: m.id,
            result: {
              content: [
                { type: 'text', text: 'line1' },
                { type: 'text', text: 'line2' },
              ],
              isError: false,
            },
          }) + '\n'
        );
      }
    }
  });

  const r = await client.call('run', { cmd: 'ls' });
  assert.equal(r.content, 'line1\nline2');
  assert.equal(r.isError, false);
});

test('McpClient: exit rejects pending requests', async () => {
  const proc = fakeProc();
  const client = new McpClient('exec', proc);
  const p = client.request('a', {});
  proc.emit('exit', 1, null);
  await assert.rejects(p, /exited/);
});
