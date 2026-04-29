import test from 'node:test';
import assert from 'node:assert';
import { chatCompletion } from '../helpers/fetch-llm.js';

// S1.1 单轮 tool call
test('L1: model calls tool when asked to list files', { timeout: 30000 }, async () => {
  const r = await chatCompletion(
    [
      { role: 'system', content: 'You are an assistant with tools. Use the provided tools to answer.' },
      { role: 'user', content: 'List files in current directory' },
    ],
    {
      tools: [
        {
          type: 'function',
          function: {
            name: 'list_directory',
            description: 'List files in a directory',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
        },
      ],
    }
  );
  assert.ok(r.toolCalls.length >= 1, `Should call at least one tool, got ${r.toolCalls.length}`);
});

// S1.2 多轮 tool result 回填
test('L1: model answers after receiving tool results', { timeout: 30000 }, async () => {
  const r = await chatCompletion([
    { role: 'system', content: 'You are an assistant.' },
    { role: 'user', content: 'What is this project?' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'list_dir', arguments: '{"path":"."}' },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'c1', content: '[file] package.json\n[dir] src/' },
  ]);
  assert.ok(
    r.content.length > 20,
    `Should give substantive answer, got ${r.content.length} chars: ${r.content.slice(0, 120)}`
  );
});

// S5.4 thinking filter
test('L1: thinking content stays in reasoning_content, not content', { timeout: 30000 }, async () => {
  const r = await chatCompletion([
    { role: 'system', content: 'You are an assistant.' },
    { role: 'user', content: '1+1=?' },
  ]);
  assert.ok(!r.content.includes('<think>'), `content should not contain <think>: ${r.content.slice(0, 200)}`);
  assert.ok(!r.content.includes('</think>'), `content should not contain </think>: ${r.content.slice(0, 200)}`);
  assert.ok(!r.content.includes('<|channel>'), `content should not contain <|channel>: ${r.content.slice(0, 200)}`);
  assert.ok(!r.content.includes('<|channel|>'), `content should not contain <|channel|>: ${r.content.slice(0, 200)}`);
});

// foldMessages equivalence
test('L1: model answers with folded history summary', { timeout: 30000 }, async () => {
  const r = await chatCompletion([
    { role: 'system', content: 'You are an assistant.' },
    {
      role: 'system',
      content: '[conversation] User asked: "What framework?" → React 19 + Vite 7',
    },
    { role: 'user', content: 'What are the advantages of that framework?' },
  ]);
  assert.ok(
    r.content.length > 10,
    `Should answer based on folded context, got ${r.content.length} chars`
  );
});
