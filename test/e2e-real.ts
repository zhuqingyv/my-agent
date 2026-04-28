import test from 'node:test';
import assert from 'node:assert';
import * as pty from 'node-pty';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TSX = '/Users/zhuqingyu/project/my-agent/node_modules/.bin/tsx';
const CLI = '/Users/zhuqingyu/project/my-agent/src/cli/index.tsx';
const SUPERCELL = '/Users/zhuqingyu/project/supercell';
const API_LOG = path.join(process.env.HOME!, '.my-agent', 'api-debug.log');

function spawnMa(cwd: string): pty.IPty {
  try {
    fs.chmodSync(
      '/Users/zhuqingyu/project/my-agent/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
      0o755,
    );
  } catch {}
  return pty.spawn(TSX, [CLI], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd,
    env: { ...process.env },
  });
}

function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b[78]/g, '')
    .replace(/\x1b\[\?[0-9]+[hl]/g, '');
}

function waitFor(
  proc: pty.IPty,
  predicate: (output: string) => boolean,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timeout after ${timeoutMs}ms. Output so far: ${stripAnsi(output).slice(-400)}`,
        ),
      );
    }, timeoutMs);
    proc.onData((data) => {
      output += data;
      if (predicate(output)) {
        clearTimeout(timer);
        resolve(output);
      }
    });
  });
}

async function sendLine(proc: pty.IPty, text: string): Promise<void> {
  proc.write(text);
  await new Promise((r) => setTimeout(r, 800));
  proc.write('\r');
}

async function waitReady(proc: pty.IPty): Promise<void> {
  await waitFor(proc, (out) => out.includes('session'), 20000);
  await new Promise((r) => setTimeout(r, 12000));
}

function countDone(clean: string): number {
  return (clean.match(/完成/g) || []).length;
}

function hasLlmError(clean: string): boolean {
  return /\[error\]|Internal Server Error|5\d\d\s+Error/.test(clean);
}

async function cleanupProc(proc: pty.IPty): Promise<void> {
  try {
    proc.write('/quit\r');
  } catch {}
  await new Promise((r) => setTimeout(r, 2000));
  try {
    proc.kill();
  } catch {}
  await new Promise((r) => setTimeout(r, 3000));
}

test('e2e: 这个项目是干什么的', { timeout: 240000 }, async () => {
  fs.rmSync(API_LOG, { force: true });
  const proc = spawnMa(SUPERCELL);
  try {
    await waitReady(proc);

    await sendLine(proc, '这个项目是干什么的');

    const finalOutput = await waitFor(
      proc,
      (out) => stripAnsi(out).includes('完成'),
      180000,
    );
    const clean = stripAnsi(finalOutput);

    assert.ok(!hasLlmError(clean), `Should not have LLM error. Tail: ${clean.slice(-300)}`);
    assert.ok(clean.includes('✓'), 'Should have at least one tool success');

    const log = fs.readFileSync(API_LOG, 'utf-8');
    const apiCalls = (log.match(/API REQUEST/g) || []).length;
    assert.ok(apiCalls >= 2, `Should have >=2 API calls, got ${apiCalls}`);

    const chinese = clean.match(/[一-鿿]+/g) || [];
    const totalChinese = chinese.join('').length;
    assert.ok(
      totalChinese > 30,
      `Should have >30 Chinese chars in answer, got ${totalChinese}`,
    );
  } finally {
    await cleanupProc(proc);
  }
});

test('e2e: 这个项目怎么样', { timeout: 240000 }, async () => {
  fs.rmSync(API_LOG, { force: true });
  const proc = spawnMa(SUPERCELL);
  try {
    await waitReady(proc);

    await sendLine(proc, '这个项目怎么样');
    const finalOutput = await waitFor(
      proc,
      (out) => stripAnsi(out).includes('完成'),
      180000,
    );
    const clean = stripAnsi(finalOutput);

    assert.ok(!hasLlmError(clean), `No LLM error. Tail: ${clean.slice(-300)}`);
    assert.ok(clean.includes('✓'), 'Tool success');

    const log = fs.readFileSync(API_LOG, 'utf-8');
    const apiCalls = (log.match(/API REQUEST/g) || []).length;
    assert.ok(apiCalls >= 2, `>=2 API calls, got ${apiCalls}`);
  } finally {
    await cleanupProc(proc);
  }
});

test('e2e: 追问深度对话', { timeout: 420000 }, async () => {
  fs.rmSync(API_LOG, { force: true });
  const proc = spawnMa(SUPERCELL);
  try {
    await waitReady(proc);

    await sendLine(proc, '这个项目用了什么技术栈');
    await waitFor(proc, (out) => countDone(stripAnsi(out)) >= 1, 180000);

    await new Promise((r) => setTimeout(r, 2000));
    await sendLine(proc, '详细说说');
    const finalOutput = await waitFor(
      proc,
      (out) => countDone(stripAnsi(out)) >= 2,
      180000,
    );

    const clean = stripAnsi(finalOutput);
    assert.ok(!hasLlmError(clean), `No LLM error. Tail: ${clean.slice(-300)}`);

    const log = fs.readFileSync(API_LOG, 'utf-8');
    const apiCalls = (log.match(/API REQUEST/g) || []).length;
    assert.ok(
      apiCalls >= 3,
      `>=3 API calls for 2-round chat, got ${apiCalls}`,
    );
  } finally {
    await cleanupProc(proc);
  }
});
