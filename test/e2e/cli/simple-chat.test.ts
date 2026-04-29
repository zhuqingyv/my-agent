import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnMa, sendLine, waitFor, stripAnsi, killMa } from '../helpers/pty.js';

const SUPERCELL = '/Users/zhuqingyu/project/supercell';
const API_LOG = path.join(process.env.HOME!, '.my-agent', 'api-debug.log');

async function waitReady(proc: ReturnType<typeof spawnMa>): Promise<void> {
  await waitFor(proc, (out) => stripAnsi(out).includes('session'), 20000);
  await new Promise((r) => setTimeout(r, 12000));
}

function hasLlmError(clean: string): boolean {
  return /\[error\]|Internal Server Error|5\d\d\s+Error/.test(clean);
}

test(
  'L3 S1.1: ask what is this project in supercell',
  { timeout: 240000 },
  async () => {
    try {
      fs.rmSync(API_LOG, { force: true });
    } catch {}

    const proc = spawnMa(SUPERCELL);
    try {
      await waitReady(proc);

      await sendLine(proc, '这个项目是干什么的');

      const finalOutput = await waitFor(
        proc,
        (out) => stripAnsi(out).includes('完成'),
        180000
      );
      const clean = stripAnsi(finalOutput);

      assert.ok(
        !hasLlmError(clean),
        `should not have 500/LLM error. Tail: ${clean.slice(-400)}`
      );
      assert.ok(
        clean.includes('✓'),
        `should have at least one tool ✓. Tail: ${clean.slice(-400)}`
      );

      const chineseMatches = clean.match(/[一-鿿]+/g) || [];
      const totalChinese = chineseMatches.join('').length;
      assert.ok(
        totalChinese >= 30,
        `answer should contain >=30 Chinese chars, got ${totalChinese}. Tail: ${clean.slice(-400)}`
      );
    } finally {
      await killMa(proc);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
);
