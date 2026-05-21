import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolExecutor } from '../src/agent/tool-executor.js';
import type { AgentConfig, McpConnection } from '../src/mcp/types.js';

const config: AgentConfig = {
  model: { baseURL: 'http://localhost:1234/v1', model: 'm', apiKey: 'k' },
  mcpServers: {},
};

function toolCall(name: string, args: Record<string, unknown>, id = 'tc_1'): any {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

async function runTool(executor: ToolExecutor, name: string, args: Record<string, unknown>) {
  const events: any[] = [];
  const gen = executor.execute(
    toolCall(name, args),
    { stack: {} as any, currentTask: {} as any, todoList: {} as any }
  );
  let next = await gen.next();
  while (!next.done) {
    events.push(next.value);
    next = await gen.next();
  }
  return { events, result: next.value };
}

test('tool executor: blocks duplicate web_search query in the same task', async () => {
  let calls = 0;
  const conn: McpConnection = {
    name: 'web',
    process: {} as any,
    tools: [{ name: 'web_search', description: '', inputSchema: { type: 'object', properties: {}, required: ['query'] } }],
    call: async () => {
      calls++;
      return { content: '{"status":"ok"}', isError: false };
    },
    close: async () => {},
  };
  const executor = new ToolExecutor(config, [conn], new Map(), { nextId: () => 'cf_1', awaitApproval: async () => true });

  await runTool(executor, 'web__web_search', { query: 'nova-dom' });
  const second = await runTool(executor, 'web__web_search', { query: ' nova-dom ' });

  assert.equal(calls, 1);
  assert.equal(second.result.isError, true);
  assert.match(second.result.result, /duplicate_query/);
});

test('tool executor: enforces web_fetch budget per task', async () => {
  let calls = 0;
  const conn: McpConnection = {
    name: 'web',
    process: {} as any,
    tools: [{ name: 'web_fetch', description: '', inputSchema: { type: 'object', properties: {}, required: ['url'] } }],
    call: async () => {
      calls++;
      return { content: '{"status":"ok"}', isError: false };
    },
    close: async () => {},
  };
  const executor = new ToolExecutor(config, [conn], new Map(), { nextId: () => 'cf_1', awaitApproval: async () => true });

  await runTool(executor, 'web__web_fetch', { url: 'https://example.com/1' });
  await runTool(executor, 'web__web_fetch', { url: 'https://example.com/2' });
  await runTool(executor, 'web__web_fetch', { url: 'https://example.com/3' });
  const fourth = await runTool(executor, 'web__web_fetch', { url: 'https://example.com/4' });

  assert.equal(calls, 3);
  assert.equal(fourth.result.isError, true);
  assert.match(fourth.result.result, /budget_exceeded/);
});
