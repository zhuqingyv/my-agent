import test from 'node:test';
import assert from 'node:assert';
import { spawnMa, sendLine, waitFor, stripAnsi, killMa } from '../helpers/pty.js';

const SUPERCELL = '/Users/zhuqingyu/project/supercell';

async function waitReady(proc: ReturnType<typeof spawnMa>): Promise<void> {
  await waitFor(proc, (out) => stripAnsi(out).includes('session'), 20000);
  await new Promise((r) => setTimeout(r, 12000));
}

test('L3 smoke: banner shows session/MA/exec/fs', { timeout: 60000 }, async () => {
  const proc = spawnMa(SUPERCELL);
  try {
    const banner = await waitFor(
      proc,
      (out) => {
        const clean = stripAnsi(out);
        return clean.includes('session') && clean.includes('MA');
      },
      20000
    );
    await new Promise((r) => setTimeout(r, 12000));
    const clean = stripAnsi(banner);
    assert.ok(clean.includes('session'), `banner missing 'session'. Tail: ${clean.slice(-300)}`);
    assert.ok(clean.includes('MA'), `banner missing 'MA'. Tail: ${clean.slice(-300)}`);
    assert.ok(
      clean.includes('exec') || clean.includes('fs'),
      `banner missing exec/fs MCP. Tail: ${clean.slice(-300)}`
    );
  } finally {
    await killMa(proc);
  }
  await new Promise((r) => setTimeout(r, 3000));
});

test('L3 smoke: /tools lists tools', { timeout: 60000 }, async () => {
  const proc = spawnMa(SUPERCELL);
  try {
    await waitReady(proc);
    await sendLine(proc, '/tools');
    const out = await waitFor(
      proc,
      (o) => {
        const c = stripAnsi(o);
        return /fs__|exec__|grep__|web__/.test(c);
      },
      20000
    );
    const clean = stripAnsi(out);
    assert.ok(
      /fs__|exec__|grep__|web__/.test(clean),
      `no tool names listed. Tail: ${clean.slice(-400)}`
    );
  } finally {
    await killMa(proc);
  }
  await new Promise((r) => setTimeout(r, 3000));
});

test('L3 smoke: /quit exits cleanly', { timeout: 60000 }, async () => {
  const proc = spawnMa(SUPERCELL);
  let exited = false;
  let exitCode: number | undefined;
  proc.onExit((e) => {
    exited = true;
    exitCode = e.exitCode;
  });
  try {
    await waitReady(proc);
    await sendLine(proc, '/quit');
    const start = Date.now();
    while (!exited && Date.now() - start < 15000) {
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.ok(exited, '/quit did not exit within 15s');
    assert.ok(
      exitCode === 0 || exitCode === undefined,
      `/quit should exit 0, got ${exitCode}`
    );
  } finally {
    if (!exited) {
      try {
        proc.kill();
      } catch {}
    }
  }
  await new Promise((r) => setTimeout(r, 3000));
});
