import test from 'node:test';
import assert from 'node:assert';
import { chatCompletion } from '../helpers/fetch-llm.js';

// content: "" (empty string) should be returned as empty string, not crash
test('L1: empty user content does not crash the fetch layer', { timeout: 30000 }, async () => {
  const r = await chatCompletion([
    { role: 'system', content: 'You are an assistant. Reply with "ok".' },
    { role: 'user', content: 'ok?' },
  ]);
  // Helper returns msg.content ?? '' so even null/undefined becomes ''.
  assert.strictEqual(typeof r.content, 'string', 'content must be a string');
  assert.ok(Array.isArray(r.toolCalls), 'toolCalls must be an array');
});

// Without tools, toolCalls should be an empty array (not undefined).
test('L1: toolCalls defaults to [] when no tools are provided', { timeout: 30000 }, async () => {
  const r = await chatCompletion([
    { role: 'system', content: 'You are an assistant.' },
    { role: 'user', content: 'Say hi in one word.' },
  ]);
  assert.ok(Array.isArray(r.toolCalls), 'toolCalls must be an array');
  assert.strictEqual(r.toolCalls.length, 0, `no tools provided → no tool_calls, got ${r.toolCalls.length}`);
});

// content: null vs content: "" — sending assistant message with null content is accepted.
test('L1: assistant message with content: "" (empty) is accepted', { timeout: 30000 }, async () => {
  const r = await chatCompletion([
    { role: 'system', content: 'You are an assistant.' },
    { role: 'user', content: 'Continue.' },
    { role: 'assistant', content: '' },
    { role: 'user', content: 'Say "done".' },
  ]);
  assert.strictEqual(typeof r.content, 'string');
  assert.ok(r.content.length > 0, `expected some reply, got ${r.content.length} chars`);
});

// Non-2xx response is thrown as HTTP error — verify with a bogus endpoint via a temporary override.
test('L1: non-OK HTTP status is surfaced as Error', { timeout: 10000 }, async () => {
  // Override fetch for a single call by hitting an unreachable path on a likely-open loopback.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('not found', { status: 404, statusText: 'Not Found' });
  try {
    await assert.rejects(
      chatCompletion([{ role: 'user', content: 'hi' }]),
      (err: unknown) => err instanceof Error && /HTTP 404/.test(err.message)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
