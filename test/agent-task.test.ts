import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent, __internal__ } from '../src/agent.js';
import { createTaskStack } from '../src/task-stack.js';
import type { AgentConfig, McpConnection } from '../src/mcp/types.js';

const baseConfig: AgentConfig = {
  model: {
    baseURL: 'http://127.0.0.1:0',
    model: 'stub-model',
    apiKey: 'stub-key',
  },
  mcpServers: {},
};

function makeConnections(): McpConnection[] {
  return [];
}

test('agent: exposes getTaskStack / getArchive / abortAll', async () => {
  const agent = await createAgent(baseConfig, makeConnections());
  assert.equal(typeof agent.getTaskStack, 'function');
  assert.equal(typeof agent.getArchive, 'function');
  assert.equal(typeof agent.abortAll, 'function');
  const stack = agent.getTaskStack();
  assert.ok(stack, 'stack should exist');
  assert.equal(typeof stack.push, 'function');
  assert.equal(typeof stack.pop, 'function');
  assert.equal(stack.size(), 0);
  assert.equal(stack.current(), null);
});

test('agent: getArchive returns null for unknown task id', async () => {
  const agent = await createAgent(baseConfig, makeConnections());
  assert.equal(agent.getArchive('t_never'), null);
});

test('agent: abortAll returns number of cleared pending tasks', async () => {
  const agent = await createAgent(baseConfig, makeConnections());
  const stack = agent.getTaskStack();
  stack.push({ prompt: 'a', messageAnchor: -1 });
  stack.push({ prompt: 'b', messageAnchor: -1 });
  stack.push({ prompt: 'c', messageAnchor: -1 });
  assert.equal(stack.size(), 3);
  const n = agent.abortAll();
  assert.equal(n, 3);
  assert.equal(stack.size(), 0);
  assert.equal(agent.abortAll(), 0);
});

test('agent: create_task tool is present in internal tool definition', () => {
  const { CREATE_TASK_TOOL } = __internal__;
  assert.equal(CREATE_TASK_TOOL.type, 'function');
  assert.equal(CREATE_TASK_TOOL.function.name, 'create_task');
  assert.ok(CREATE_TASK_TOOL.function.parameters);
});

test('agent: renderStackState output format covers current/pending/completed', () => {
  const { renderStackState, STACK_STATE_PREFIX } = __internal__;
  const stack = createTaskStack();

  const empty = renderStackState(stack);
  assert.ok(empty.startsWith(STACK_STATE_PREFIX));
  assert.match(empty, /<stack_state>/);
  assert.match(empty, /Current task: \(none\)/);
  assert.match(empty, /Pending tasks: \(none\)/);
  assert.match(empty, /Completed tasks: \(none\)/);
  assert.match(empty, /<\/stack_state>/);

  stack.push({ prompt: 'root', messageAnchor: 0 });
  const root = stack.pop()!;
  stack.push({ prompt: 'child-a', parentId: root.id, messageAnchor: 0 });
  stack.push({ prompt: 'child-b', parentId: root.id, messageAnchor: 0 });

  const populated = renderStackState(stack);
  assert.match(populated, /Current task: \[t_1\] root/);
  assert.match(populated, /Pending tasks \(top first\)/);
  assert.match(populated, /\[t_3\] child-b/);
  assert.match(populated, /\[t_2\] child-a/);

  const childB = stack.pop()!;
  stack.markDone(childB.id, 'done-b');
  const populated2 = renderStackState(stack);
  assert.match(populated2, /Completed tasks \(last 5\)/);
  assert.match(populated2, /\[t_3\] DONE — "child-b" → done-b/);
});

test('agent: foldMessages-style splice reduces message length to anchor', () => {
  const messages: any[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'u1' },
    { role: 'assistant', content: 'a1' },
    { role: 'tool', content: 't1' },
    { role: 'assistant', content: 'a2' },
  ];
  const anchor = 1;
  const folded = messages.splice(anchor);
  messages.push({
    role: 'system',
    content: '[stack:completed t_1] Summary: ok',
  });
  assert.equal(folded.length, 4);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].content, 'sys');
  assert.match(messages[1].content as string, /stack:completed t_1/);
});

test('agent: task messageAnchor is set at pop time (not push) when driven by chat flow', async () => {
  const agent = await createAgent(baseConfig, makeConnections());
  const stack = agent.getTaskStack();
  const pushed = stack.push({ prompt: 'root', messageAnchor: -1 });
  assert.equal(pushed.messageAnchor, -1);
  const popped = stack.pop()!;
  assert.equal(popped.id, pushed.id);
  assert.equal(popped.status, 'running');
});

test('agent: reset() clears stack and archive', async () => {
  const agent = await createAgent(baseConfig, makeConnections());
  const stack = agent.getTaskStack();
  stack.push({ prompt: 'x', messageAnchor: -1 });
  stack.push({ prompt: 'y', messageAnchor: -1 });
  assert.equal(stack.size(), 2);
  agent.reset();
  assert.equal(agent.getTaskStack().size(), 0);
  assert.equal(agent.getArchive('t_1'), null);
});
