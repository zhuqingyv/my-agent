import test from 'node:test';
import assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runAgent } from '../helpers/agent-runner.js';
import { assertChineseMin } from '../helpers/assertions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../fixtures/simple-node-project');

function tmpDebug(): string {
  const f = path.join(os.tmpdir(), `ma-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.log`);
  return f;
}

function collectText(events: any[]): string {
  return events
    .filter((e) => e.type === 'token' && typeof e.text === 'string')
    .map((e) => e.text)
    .join('');
}

// S1.1 简单问（单轮、预期调工具）
test(
  'L2 S1.1: simple question triggers tools and returns Chinese answer',
  { timeout: 180000 },
  async () => {
    const dbg = tmpDebug();
    process.env.MA_DEBUG = dbg;
    try {
      const r = await runAgent('这个项目是干什么的', {
        cwd: FIXTURE,
        timeout: 170000,
      });
      const finalText = collectText(r.events);
      assert.ok(
        r.toolCalls.length >= 1,
        `Expected >=1 tool call, got ${r.toolCalls.length}. Tools: ${JSON.stringify(r.toolCalls.map((t) => t.name))}`
      );
      assertChineseMin(finalText, 30);
    } finally {
      delete process.env.MA_DEBUG;
      try { fs.unlinkSync(dbg); } catch {}
    }
  }
);

// S1.2 追问（多轮、不重复相同参数的工具调用）
test(
  'L2 S1.2: follow-up question does not repeat identical tool calls',
  { timeout: 300000 },
  async () => {
    const dbg = tmpDebug();
    process.env.MA_DEBUG = dbg;
    try {
      const r1 = await runAgent('这个项目用了什么技术栈', {
        cwd: FIXTURE,
        timeout: 150000,
      });
      assert.ok(r1.toolCalls.length >= 1, `round1 expected tool calls, got ${r1.toolCalls.length}`);

      const firstCalls = new Set(
        r1.toolCalls.map((t) => `${t.name}:${JSON.stringify(t.args)}`)
      );

      const r2 = await runAgent('详细说说', {
        cwd: FIXTURE,
        timeout: 150000,
      });
      const repeated = r2.toolCalls.filter((t) =>
        firstCalls.has(`${t.name}:${JSON.stringify(t.args)}`)
      );
      assert.ok(
        repeated.length === 0,
        `round2 should not repeat round1 identical tool calls, got: ${JSON.stringify(repeated.map((t) => t.name))}`
      );
    } finally {
      delete process.env.MA_DEBUG;
      try { fs.unlinkSync(dbg); } catch {}
    }
  }
);
