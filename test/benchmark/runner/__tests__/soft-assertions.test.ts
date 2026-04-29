import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSoft } from '../assertions/soft.js';
import type { RunTrace, SoftAssertion, ToolCallRecord } from '../types.js';

function makeTrace(overrides: Partial<RunTrace> = {}): RunTrace {
  return {
    taskId: 't1',
    runIndex: 0,
    events: [],
    toolCalls: [],
    finalText: '',
    messagesCount: 0,
    thinkingMs: 0,
    apiCalls: 0,
    startedAt: 0,
    elapsedMs: 0,
    hitMaxLoops: false,
    aborted: false,
    crashed: false,
    ...overrides,
  };
}

function makeToolCall(name = 'readFile'): ToolCallRecord {
  return { name, args: {}, ok: true, resultPreview: '' };
}

// ─── final_text_min_len ───

test('final_text_min_len: 恰好达到阈值 score = 1', () => {
  const trace = makeTrace({ finalText: 'x'.repeat(100) });
  const assertions: SoftAssertion[] = [{ type: 'final_text_min_len', chars: 100, weight: 1 }];
  const [r] = evaluateSoft(assertions, trace);
  assert.equal(r.score, 1);
  assert.equal(r.weight, 1);
});

test('final_text_min_len: 一半长度 score = 0.5', () => {
  const trace = makeTrace({ finalText: 'x'.repeat(50) });
  const assertions: SoftAssertion[] = [{ type: 'final_text_min_len', chars: 100, weight: 2 }];
  const [r] = evaluateSoft(assertions, trace);
  assert.equal(r.score, 0.5);
  assert.equal(r.weight, 2);
});

test('final_text_min_len: 超过阈值 score 封顶 1', () => {
  const trace = makeTrace({ finalText: 'x'.repeat(300) });
  const assertions: SoftAssertion[] = [{ type: 'final_text_min_len', chars: 100, weight: 1 }];
  const [r] = evaluateSoft(assertions, trace);
  assert.equal(r.score, 1);
});

// ─── tool_call_count_max ───

test('tool_call_count_max: 调用数 = max score = 1', () => {
  const trace = makeTrace({ toolCalls: [makeToolCall(), makeToolCall(), makeToolCall()] });
  const assertions: SoftAssertion[] = [{ type: 'tool_call_count_max', max: 3, weight: 1 }];
  const [r] = evaluateSoft(assertions, trace);
  assert.equal(r.score, 1);
});

test('tool_call_count_max: 调用数是 max 两倍 score = 0.5', () => {
  const trace = makeTrace({ toolCalls: Array.from({ length: 10 }, () => makeToolCall()) });
  const assertions: SoftAssertion[] = [{ type: 'tool_call_count_max', max: 5, weight: 1 }];
  const [r] = evaluateSoft(assertions, trace);
  assert.equal(r.score, 0.5);
});

test('tool_call_count_max: 零调用且 max>0 score = 1', () => {
  const trace = makeTrace({ toolCalls: [] });
  const assertions: SoftAssertion[] = [{ type: 'tool_call_count_max', max: 2, weight: 1 }];
  const [r] = evaluateSoft(assertions, trace);
  assert.equal(r.score, 1);
});

// ─── duration_max ───

test('duration_max: 耗时 = ms score = 1', () => {
  const trace = makeTrace({ elapsedMs: 1000 });
  const assertions: SoftAssertion[] = [{ type: 'duration_max', ms: 1000, weight: 1 }];
  const [r] = evaluateSoft(assertions, trace);
  assert.equal(r.score, 1);
});

test('duration_max: 耗时是 ms 两倍 score = 0.5', () => {
  const trace = makeTrace({ elapsedMs: 2000 });
  const assertions: SoftAssertion[] = [{ type: 'duration_max', ms: 1000, weight: 1 }];
  const [r] = evaluateSoft(assertions, trace);
  assert.equal(r.score, 0.5);
});

test('duration_max: 比 ms 更快 score 封顶 1', () => {
  const trace = makeTrace({ elapsedMs: 500 });
  const assertions: SoftAssertion[] = [{ type: 'duration_max', ms: 2000, weight: 1 }];
  const [r] = evaluateSoft(assertions, trace);
  assert.equal(r.score, 1);
});

// ─── 未实现类型返回 null ───

test('llm_judge: M1 未实现 score = null', () => {
  const trace = makeTrace({ finalText: 'whatever' });
  const assertions: SoftAssertion[] = [{ type: 'llm_judge', rubric: 'any', weight: 3 }];
  const [r] = evaluateSoft(assertions, trace);
  assert.equal(r.score, null);
  assert.equal(r.weight, 3);
});

test('reference_match_ratio: M1 未实现 score = null', () => {
  const trace = makeTrace();
  const assertions: SoftAssertion[] = [{ type: 'reference_match_ratio', ref: 'x', weight: 2 }];
  const [r] = evaluateSoft(assertions, trace);
  assert.equal(r.score, null);
  assert.equal(r.weight, 2);
});

test('token_usage_max: M1 未实现 score = null', () => {
  const trace = makeTrace();
  const assertions: SoftAssertion[] = [{ type: 'token_usage_max', max: 1000, weight: 1 }];
  const [r] = evaluateSoft(assertions, trace);
  assert.equal(r.score, null);
  assert.equal(r.weight, 1);
});

// ─── 混合场景 ───

test('混合断言: 按顺序返回各自结果', () => {
  const trace = makeTrace({
    finalText: 'x'.repeat(80),
    toolCalls: [makeToolCall(), makeToolCall()],
    elapsedMs: 1000,
  });
  const assertions: SoftAssertion[] = [
    { type: 'final_text_min_len', chars: 100, weight: 1 },
    { type: 'tool_call_count_max', max: 4, weight: 1 },
    { type: 'duration_max', ms: 500, weight: 1 },
    { type: 'llm_judge', rubric: 'skip', weight: 1 },
  ];
  const results = evaluateSoft(assertions, trace);
  assert.equal(results.length, 4);
  assert.equal(results[0].score, 0.8);
  assert.equal(results[1].score, 1);
  assert.equal(results[2].score, 0.5);
  assert.equal(results[3].score, null);
});
