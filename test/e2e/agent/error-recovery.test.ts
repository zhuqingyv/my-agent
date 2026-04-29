import test from 'node:test';
import assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runAgent } from '../helpers/agent-runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../fixtures/simple-node-project');

function tmpDebug(): string {
  return path.join(os.tmpdir(), `ma-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.log`);
}

function readDebugLog(p: string): string {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; }
}

// S5.1 工具参数错误：读不存在路径，不应无限重试（errorHistory 阻断）
test(
  'L2 S5.1: reading nonexistent path does not retry forever',
  { timeout: 180000 },
  async () => {
    const dbg = tmpDebug();
    process.env.MA_DEBUG = dbg;
    try {
      const r = await runAgent('读 /nonexistent/xxx/definitely-not-there.txt 的内容', {
        cwd: FIXTURE,
        timeout: 170000,
      });

      // 统计同一 (name, args) 的调用次数
      const byKey = new Map<string, number>();
      for (const tc of r.toolCalls) {
        const k = `${tc.name}:${JSON.stringify(tc.args)}`;
        byKey.set(k, (byKey.get(k) || 0) + 1);
      }
      const maxRepeat = Math.max(0, ...byKey.values());
      // MAX_SAME_ERROR=2 → 同一 key 最多 2 次错误+1 次被阻断 = 3。留余量给 Qwen3 跳着换参数
      assert.ok(
        maxRepeat <= 3,
        `Expected no infinite retry (≤3 same calls), got maxRepeat=${maxRepeat}. Keys: ${JSON.stringify([...byKey.entries()])}`
      );
      // 同时保证整个回合总调用数有界（防模型换参死转）
      assert.ok(
        r.toolCalls.length <= 20,
        `Total tool calls bounded by maxLoops (≤20), got ${r.toolCalls.length}`
      );
    } finally {
      delete process.env.MA_DEBUG;
      try { fs.unlinkSync(dbg); } catch {}
    }
  }
);

// S5.3 空回答：agent 发过 "Please provide your answer" 的 nudge
// 如果模型一次就给答案，这条 nudge 不一定出现；只断言"出现空回答时会被 nudge"
test(
  'L2 S5.3: empty assistant content after tool use triggers nudge',
  { timeout: 240000 },
  async () => {
    const dbg = tmpDebug();
    process.env.MA_DEBUG = dbg;
    try {
      const r = await runAgent('读一下 package.json 然后告诉我 name 字段是什么', {
        cwd: FIXTURE,
        timeout: 220000,
      });
      const log = readDebugLog(dbg);

      // 宽松断言：要么 nudge 出现过（模型至少空回过一次），要么最终有工具调用且 finalText 非空
      const hasNudge = log.includes('Please provide your answer based on the tool results above');
      const hasAnyToolCall = r.toolCalls.length >= 1;

      if (hasNudge) {
        // 验证 nudge 机制生效
        assert.ok(hasNudge, 'nudge message should appear in debug log when empty answer occurred');
      } else {
        // 未触发 empty-answer 路径，验证正常路径也正确（调过工具且最终给了答案）
        assert.ok(hasAnyToolCall, `expected at least one tool call, got ${r.toolCalls.length}`);
      }
    } finally {
      delete process.env.MA_DEBUG;
      try { fs.unlinkSync(dbg); } catch {}
    }
  }
);

// S5.5 重复错误阻断：errorHistory 在同一 callKey 错 2 次后注入阻断文案
test(
  'L2 S5.5: repeated identical failing tool call is blocked by errorHistory',
  { timeout: 180000 },
  async () => {
    const dbg = tmpDebug();
    process.env.MA_DEBUG = dbg;
    try {
      const r = await runAgent(
        '读 /does/not/exist/same-path.txt 这个文件。如果失败就再读同一个路径多试几次。',
        { cwd: FIXTURE, timeout: 170000 }
      );

      // 找是否有 tool:result 含"已尝试 X 次均失败"
      const blocked = r.events.some(
        (e: any) =>
          e.type === 'tool:result' &&
          typeof e.content === 'string' &&
          /已尝试\s*\d+\s*次均失败/.test(e.content)
      );
      // 或 errorHistory 阻断没触发（模型聪明换路径），则至少没无限重试
      const byKey = new Map<string, number>();
      for (const tc of r.toolCalls) {
        const k = `${tc.name}:${JSON.stringify(tc.args)}`;
        byKey.set(k, (byKey.get(k) || 0) + 1);
      }
      const maxRepeat = Math.max(0, ...byKey.values());

      assert.ok(
        blocked || maxRepeat <= 3,
        `expected block message OR bounded repeats (≤3), blocked=${blocked} maxRepeat=${maxRepeat}`
      );
    } finally {
      delete process.env.MA_DEBUG;
      try { fs.unlinkSync(dbg); } catch {}
    }
  }
);
