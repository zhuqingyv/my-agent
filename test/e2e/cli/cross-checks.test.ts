import test from 'node:test';
import assert from 'node:assert';
import { spawnMa, sendLine, waitFor, stripAnsi, killMa } from '../helpers/pty.js';

const SUPERCELL = '/Users/zhuqingyu/project/supercell';

async function waitReady(proc: ReturnType<typeof spawnMa>): Promise<void> {
  await waitFor(proc, (out) => stripAnsi(out).includes('session'), 20000);
  await new Promise((r) => setTimeout(r, 12000));
}

const HTML_TAGS = ['<p>', '<pre>', '<code>', '<h1>', '<h2>', '<h3>', '<div>', '<span>'];

function findHtmlLeak(clean: string): string | null {
  for (const tag of HTML_TAGS) {
    if (clean.includes(tag)) return tag;
  }
  return null;
}

async function runSessionAndCollect(question: string): Promise<string> {
  const proc = spawnMa(SUPERCELL);
  let fullOutput = '';
  const sub = proc.onData((d) => {
    fullOutput += d;
  });
  try {
    await waitReady(proc);
    await sendLine(proc, question);
    try {
      await waitFor(
        proc,
        (out) => stripAnsi(out).includes('完成'),
        180000
      );
    } catch {
      // even if no 完成, we collect output for leak detection
    }
  } finally {
    sub.dispose();
    await killMa(proc);
  }
  return fullOutput;
}

test('L3 cross: no HTML tag leak in output', { timeout: 240000 }, async () => {
  const raw = await runSessionAndCollect('这个项目用了什么技术栈');
  const clean = stripAnsi(raw);
  const leaked = findHtmlLeak(clean);
  assert.strictEqual(
    leaked,
    null,
    `HTML tag leaked into output: ${leaked}. Tail: ${clean.slice(-500)}`
  );
  await new Promise((r) => setTimeout(r, 3000));
});

test('L3 cross: no MaxListenersExceededWarning', { timeout: 240000 }, async () => {
  const raw = await runSessionAndCollect('这个项目是干什么的');
  const clean = stripAnsi(raw);
  assert.ok(
    !clean.includes('MaxListenersExceededWarning'),
    `MaxListenersExceededWarning appeared in output. Tail: ${clean.slice(-500)}`
  );
  await new Promise((r) => setTimeout(r, 3000));
});
