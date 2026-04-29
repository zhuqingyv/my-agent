import test from 'node:test';
import assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { bootstrap, shutdown } from '../../../src/index.js';
import type { AgentEvent } from '../../../src/agent/events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../fixtures/simple-node-project');

function tmpDebug(): string {
  return path.join(os.tmpdir(), `ma-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.log`);
}

function readLog(p: string): string {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; }
}

function collectTokens(events: AgentEvent[]): string {
  return events
    .filter((e): e is Extract<AgentEvent, { type: 'token' }> => e.type === 'token')
    .map((e) => e.text)
    .join('');
}

async function runTurn(agent: any, prompt: string, timeoutMs: number): Promise<{ events: AgentEvent[]; text: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const events: AgentEvent[] = [];
  try {
    for await (const ev of agent.chat(prompt, ac.signal) as AsyncGenerator<AgentEvent>) {
      events.push(ev);
    }
  } finally {
    clearTimeout(timer);
  }
  return { events, text: collectTokens(events) };
}

// S6.1 foldMessages 后不丢用户问题：第二轮 request 里能看到 "[conversation] User asked"
test(
  'L2 S6.1: foldMessages preserves user question in subsequent turns',
  { timeout: 360000 },
  async () => {
    const dbg = tmpDebug();
    process.env.MA_DEBUG = dbg;
    const originalCwd = process.cwd();
    process.chdir(FIXTURE);
    let connections: any = null;
    try {
      const boot = await bootstrap();
      connections = boot.connections;
      const agent = boot.agent;

      // 第一轮
      const r1 = await runTurn(agent, '这个项目用了什么框架', 160000);
      assert.ok(r1.events.some((e) => e.type === 'task:done'), 'round1 should complete');

      // 清掉第一轮的日志部分（保留文件继续 append）
      const logAfterR1 = readLog(dbg);

      // 第二轮
      await runTurn(agent, '刚才那个框架有什么优势', 160000);

      const fullLog = readLog(dbg);
      const logR2 = fullLog.slice(logAfterR1.length);

      // 断言：第二轮的 API 请求日志里应含 "[conversation] User asked"（foldMessages 后的 summary 注入 system）
      assert.ok(
        logR2.includes('[conversation] User asked'),
        `round2 messages should contain fold summary "[conversation] User asked". Log tail:\n${logR2.slice(-1500)}`
      );
    } finally {
      delete process.env.MA_DEBUG;
      process.chdir(originalCwd);
      if (connections) { try { await shutdown(connections); } catch {} }
      try { fs.unlinkSync(dbg); } catch {}
    }
  }
);

// S6.2 多轮连续：第 3 轮能引用第 1 轮的事实
test(
  'L2 S6.2: three-round conversation references round-1 fact',
  { timeout: 540000 },
  async () => {
    const dbg = tmpDebug();
    process.env.MA_DEBUG = dbg;
    const originalCwd = process.cwd();
    process.chdir(FIXTURE);
    let connections: any = null;
    try {
      const boot = await bootstrap();
      connections = boot.connections;
      const agent = boot.agent;

      // Round 1: 建立一个明确事实
      await runTurn(agent, '读 package.json，告诉我项目的 name 字段', 160000);

      // Round 2: 无关追问，迫使 foldMessages 发生
      await runTurn(agent, '项目里有哪些源文件', 160000);

      // Round 3: 引用 round1 事实
      const r3 = await runTurn(agent, '我最开始问你的那个 name 字段值，再重复一次', 160000);
      const lowered = r3.text.toLowerCase();

      // fixture package.json 里 name 是 "test-project"
      assert.ok(
        lowered.includes('test-project') || lowered.includes('test_project'),
        `round3 should reference round1 fact "test-project", got: ${r3.text.slice(-400)}`
      );
    } finally {
      delete process.env.MA_DEBUG;
      process.chdir(originalCwd);
      if (connections) { try { await shutdown(connections); } catch {} }
      try { fs.unlinkSync(dbg); } catch {}
    }
  }
);
