import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import {
  estimateTokens,
  CHARS_PER_TOKEN,
  IMAGE_TOKEN_COST,
} from '../src/agent/tokenCount.js';

test('estimateTokens: English string content uses length / 3.5 ceiled', () => {
  const msgs: ChatCompletionMessageParam[] = [
    { role: 'user', content: 'hello world' },
  ];
  assert.equal(estimateTokens(msgs), Math.ceil('hello world'.length / CHARS_PER_TOKEN));
});

test('estimateTokens: Chinese string content counts by char length', () => {
  const text = '你好，世界！这是一段中文消息。';
  const msgs: ChatCompletionMessageParam[] = [
    { role: 'assistant', content: text },
  ];
  assert.equal(estimateTokens(msgs), Math.ceil(text.length / CHARS_PER_TOKEN));
});

test('estimateTokens: image_url part counts as fixed IMAGE_TOKEN_COST tokens', () => {
  const msgs: ChatCompletionMessageParam[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'ok' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    },
  ];
  const expectedChars = 'ok'.length + IMAGE_TOKEN_COST * CHARS_PER_TOKEN;
  assert.equal(estimateTokens(msgs), Math.ceil(expectedChars / CHARS_PER_TOKEN));
});

test('estimateTokens: tool_calls contribute JSON.stringify length', () => {
  const toolCalls = [
    {
      id: 'c1',
      type: 'function' as const,
      function: { name: 'read_file', arguments: '{"path":"./x.txt"}' },
    },
  ];
  const msgs: ChatCompletionMessageParam[] = [
    { role: 'assistant', content: '', tool_calls: toolCalls as any },
  ];
  const expected = Math.ceil(JSON.stringify(toolCalls).length / CHARS_PER_TOKEN);
  assert.equal(estimateTokens(msgs), expected);
});

test('estimateTokens: empty list yields 0', () => {
  assert.equal(estimateTokens([]), 0);
});
